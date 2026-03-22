#!/usr/bin/env python3

import asyncio
import logging
import os
import json
import random
from contextlib import suppress
from typing import AsyncIterable

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    ModelSettings,
)
from livekit.agents.voice import Agent
from livekit.agents.voice.agent_session import AgentSession
from livekit.plugins import aws

load_dotenv()

logger = logging.getLogger("nova-sonic-agent")
logger.setLevel(logging.DEBUG)

# Import exceptions with fallbacks
try:
    from livekit.agents._exceptions import APIStatusError
except ImportError:
    APIStatusError = Exception

try:
    from livekit.plugins.aws.experimental.realtime.exceptions import ModelStreamErrorException
except ImportError:
    ModelStreamErrorException = Exception

# Global connection semaphore to limit concurrent AWS connections
AWS_CONNECTION_SEMAPHORE = asyncio.Semaphore(1)  # Max 1 concurrent connection to prevent rate limiting

# Global state tracker to prevent duplicate messages
LAST_PUBLISHED_STATE = {}

# Connection debouncing
LAST_CONNECTION_ATTEMPT = 0
CONNECTION_DEBOUNCE_SECONDS = 10


async def publish_message(
    room,
    msg_type: str,
    content: str,
    *,
    message_id: str | None = None,
    replace: bool = False,
    topic: str = "lk.transcription",
):
    """Publish message using official LiveKit data patterns for realtime models"""
    global LAST_PUBLISHED_STATE
    
    # Prevent duplicate status messages
    state_key = f"{topic}:{message_id}:{msg_type}"
    if state_key in LAST_PUBLISHED_STATE and LAST_PUBLISHED_STATE[state_key] == content:
        logger.debug("🔇 Skipping duplicate message: %s", content[:30])
        return
    
    try:
        payload = json.dumps({
            "type": msg_type,
            "text": content,
            "final": True,
            "replace": replace,
            "id": message_id,
            "timestamp": asyncio.get_event_loop().time()
        })
        
        logger.info(
            "📡 Publishing %s (%s): %s...",
            msg_type,
            "update" if replace else "new",
            content[:50],
        )
        
        await room.local_participant.publish_data(
            payload.encode('utf-8'),
            reliable=True,
            topic=topic,
        )
        
        # Track this message to prevent duplicates
        LAST_PUBLISHED_STATE[state_key] = content
        
    except Exception as e:
        logger.error(f"❌ Publishing error: {e}")


def prewarm(proc: JobContext):
    """Preload models and resources before the agent starts."""
    proc.wait_for_participant = True


async def entrypoint(ctx: JobContext):
    """Official Nova Sonic realtime model pattern - simple and correct."""
    # Connect to room and wait for participant
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    logger.info("🚀 Starting Nova Sonic agent with OFFICIAL realtime model pattern...")
    
    # Add a random startup delay to prevent thundering herd
    startup_delay = random.uniform(2.0, 10.0)  # Increased delay range
    logger.info("⏰ Adding startup delay of %.1fs to prevent concurrent connections", startup_delay)
    await asyncio.sleep(startup_delay)
    
    region = os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION", "us-east-1")
    retry_delay = 5.0  # Start with longer delay
    attempt = 0

    while True:
        conversation_task = None
        session = None
        realtime_model = None
        session_task = None
        attempt += 1
        graceful_shutdown = False

        # Connection debouncing to prevent rapid retries
        global LAST_CONNECTION_ATTEMPT
        time_since_last = asyncio.get_event_loop().time() - LAST_CONNECTION_ATTEMPT
        if time_since_last < CONNECTION_DEBOUNCE_SECONDS:
            wait_time = CONNECTION_DEBOUNCE_SECONDS - time_since_last
            logger.info("🕐 Debouncing connection attempt. Waiting %.1fs", wait_time)
            await asyncio.sleep(wait_time)
        
        LAST_CONNECTION_ATTEMPT = asyncio.get_event_loop().time()

        try:
            # Acquire connection semaphore to limit concurrent AWS connections
            async with AWS_CONNECTION_SEMAPHORE:
                try:
                    await publish_message(
                        ctx.room,
                        "session_state",
                        "Assistant restarting",
                        message_id="assistant-state",
                        replace=True,
                        topic="lk.control",
                    )
                except Exception:
                    logger.debug("Unable to publish restart notice; room may not be ready yet")

                logger.info("🌱 Initializing Nova Sonic session attempt (retry %.1fs) - acquired connection slot", retry_delay)
                realtime_model = aws.realtime.RealtimeModel(
                    region=region,
                    voice="tiffany"
                )

            agent = Agent(
                instructions=(
                    "You are a voice assistant for SpashtAI, a platform for voice AI interviews and practice. "
                    "Your interface with users will be voice. You should use short and concise responses, "
                    "and avoid usage of unpronounceable punctuation. Be helpful, encouraging, and professional. "
                    "You are powered by Amazon Nova Sonic for natural speech synthesis."
                ),
                llm=realtime_model,
                tts=realtime_model,
            )

            session = AgentSession(
                llm=realtime_model,
            )

            logger.info("✅ Nova Sonic agent and session instantiated")

            conversation_task = asyncio.create_task(
                monitor_nova_sonic_conversation(ctx.room, session, realtime_model)
            )

            logger.info("🎯 Starting Nova Sonic session with agent...")
            session_task = asyncio.create_task(session.start(agent, room=ctx.room))

            try:
                await publish_message(
                    ctx.room,
                    "session_state",
                    "Assistant ready",
                    message_id="assistant-state",
                    replace=True,
                    topic="lk.control",
                )
            except Exception:
                logger.debug("Unable to publish ready notice; room may not be ready yet")

            # Wait for session to complete - this should run indefinitely until interrupted
            await session_task
            graceful_shutdown = True
            logger.info("🎉 Nova Sonic session completed gracefully")

            # Only reset retry logic if we had actual conversation
            # Check if we had any conversation turns before resetting
            if hasattr(session, '_llm') and hasattr(session._llm, '_sessions'):
                had_conversation = False
                for aws_session in session._llm._sessions:
                    if hasattr(aws_session, '_chat_ctx') and hasattr(aws_session._chat_ctx, 'items'):
                        if len(aws_session._chat_ctx.items) > 0:
                            had_conversation = True
                            break
                
                if had_conversation:
                    retry_delay = 1.0
                    attempt = 0
                    logger.info("✅ Session completed after conversation - resetting retry logic")
                else:
                    logger.warning("⚠️ Session completed without conversation - continuing with current retry logic")
            else:
                retry_delay = 1.0
                attempt = 0

        except (APIStatusError, ModelStreamErrorException) as e:
            err_msg = str(e)
            logger.error("⚠️ Nova Sonic session error (%s): %s", e.__class__.__name__, err_msg)

            # Handle rate limiting with exponential backoff
            if "Too many connections" in err_msg or "Timed out waiting for input events" in err_msg:
                # Exponential backoff with jitter for rate limits
                base_delay = min(retry_delay * 2, 300.0)  # Max 5 minutes
                jitter = random.uniform(0.1, 0.3) * base_delay  # Add 10-30% jitter
                retry_delay = base_delay + jitter
                
                logger.warning("⏳ AWS Bedrock rate limit/timeout. Backing off for %.1fs (attempt %d)", retry_delay, attempt)
                
                try:
                    await publish_message(
                        ctx.room,
                        "session_state",
                        f"Assistant recovering from AWS rate limit (attempt {attempt})",
                        message_id="assistant-state",
                        replace=True,
                        topic="lk.control",
                    )
                except Exception:
                    pass
                
                # If we've been retrying for too long, give up temporarily
                if attempt > 10:  # After 10 attempts, pause longer
                    logger.warning("🚫 Too many rate limit attempts. Pausing for 10 minutes.")
                    await asyncio.sleep(600)  # 10 minute pause
                    attempt = 0  # Reset attempt counter
                    retry_delay = 30.0  # Reset delay
                else:
                    await asyncio.sleep(retry_delay)
                    
            else:
                # Other errors - shorter backoff
                retry_delay = min(retry_delay * 1.5 if retry_delay > 1.0 else 5.0, 60.0)
                logger.warning("⚠️ Other Nova Sonic error. Retrying in %.1fs", retry_delay)
                
                try:
                    await publish_message(
                        ctx.room,
                        "session_state",
                        f"Assistant recovering in {retry_delay:.0f}s",
                        message_id="assistant-state",
                        replace=True,
                        topic="lk.control",
                    )
                except Exception:
                    logger.debug("Unable to publish recovery notice")

                await asyncio.sleep(retry_delay)

        except Exception as e:
            logger.error("⚠️ Nova Sonic session error: %s", e)
            try:
                await publish_message(
                    ctx.room,
                    "session_state",
                    f"Assistant recovering in {retry_delay:.0f}s",
                    message_id="assistant-state",
                    replace=True,
                    topic="lk.control",
                )
            except Exception:
                logger.debug("Unable to publish recovery notice; room may not be ready yet")

            retry_delay = min(retry_delay * 2, 30.0)
            await asyncio.sleep(retry_delay)

        finally:
            if conversation_task:
                conversation_task.cancel()
                with suppress(asyncio.CancelledError):
                    await conversation_task

            if session_task and not session_task.done():
                session_task.cancel()
                with suppress(asyncio.CancelledError):
                    await session_task

            if session:
                with suppress(Exception):
                    await session.close()

        if graceful_shutdown:
            # Keep agent warm; restart after a brief pause so next participant can join instantly
            await asyncio.sleep(0.5)


async def monitor_nova_sonic_conversation(room, session, realtime_model):
    """Monitor Nova Sonic's internal chat context and publish messages to frontend."""
    logger.info("👂 Starting Nova Sonic conversation monitor...")
    
    published_messages: dict[str, str] = {}
    
    while True:
        try:
            await asyncio.sleep(1)  # Check every second
            
            # Access Nova Sonic's internal chat context
            # Based on the corrected path from previous debugging
            if hasattr(session, '_llm') and hasattr(session._llm, '_sessions'):
                for aws_session in session._llm._sessions:
                    if hasattr(aws_session, '_chat_ctx') and hasattr(aws_session._chat_ctx, 'items'):
                        for item in aws_session._chat_ctx.items:
                            content = getattr(item, 'content', '')

                            # Nova Sonic returns content as list of text fragments
                            if isinstance(content, list):
                                fragments = []
                                for fragment in content:
                                    if isinstance(fragment, str):
                                        fragments.append(fragment)
                                    elif hasattr(fragment, 'text'):
                                        fragments.append(getattr(fragment, 'text') or '')
                                    else:
                                        fragments.append(str(fragment))
                                text = ''.join(fragments)
                            elif isinstance(content, str):
                                text = content
                            else:
                                text = str(content)

                            text = text.strip()
                            if not text:
                                continue

                            msg_id = getattr(item, 'id', None) or f"{item.role}:{hash(text)}"

                            previous_text = published_messages.get(msg_id)
                            if previous_text == text:
                                continue

                            is_update = previous_text is not None
                            published_messages[msg_id] = text

                            # Publish to frontend
                            if item.role == "user":
                                await publish_message(
                                    room,
                                    "user_transcript",
                                    text,
                                    message_id=msg_id,
                                    replace=is_update,
                                )
                            elif item.role == "assistant":
                                await publish_message(
                                    room,
                                    "assistant",
                                    text,
                                    message_id=msg_id,
                                    replace=is_update,
                                )

                            logger.info(
                                "📤 Published %s (%s): %s...",
                                item.role,
                                "update" if is_update else "new",
                                text[:50],
                            )
                                
        except Exception as e:
            logger.debug(f"Monitor conversation error: {e}")
            continue


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )