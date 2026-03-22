#!/usr/bin/env python3

import asyncio
import logging
import os
import json
import aiohttp
from contextlib import suppress
from typing import Optional

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents.voice import Agent
from livekit.agents.voice.agent_session import AgentSession
from livekit.plugins import aws

load_dotenv()

logger = logging.getLogger("nova-sonic-agent")
logger.setLevel(logging.DEBUG)

# Server configuration for persistent storage
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")

class ConversationPersistence:
    """Handle conversation persistence to server API"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session = None
    
    async def save_message(self, role: str, content: str) -> bool:
        """Save conversation message to server"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            async with self.session.post(
                f"{SERVER_URL}/sessions/{self.session_id}/messages",
                json={
                    "role": role,
                    "content": content,
                    "timestamp": asyncio.get_event_loop().time()
                }
            ) as response:
                if response.status == 201:
                    logger.info("✅ Saved %s message to database", role)
                    return True
                else:
                    logger.error("❌ Failed to save message: %s", await response.text())
                    return False
        except Exception as e:
            logger.error("❌ Error saving message to server: %s", e)
            return False
    
    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()

# Import exceptions with fallbacks
try:
    from livekit.agents._exceptions import APIStatusError
except ImportError:
    APIStatusError = Exception

try:
    from livekit.plugins.aws.experimental.realtime.exceptions import ModelStreamErrorException
except ImportError:
    ModelStreamErrorException = Exception


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
        
    except Exception as e:
        logger.error(f"❌ Publishing error: {e}")


def prewarm(proc: JobContext):
    """Preload models and resources before the agent starts."""
    proc.wait_for_participant = True


def setup_nova_sonic_event_handlers(room, realtime_model):
    """Set up event handlers to capture Nova Sonic's text generation events."""
    logger.info("🎧 Setting up Nova Sonic event handlers...")
    
    # Track published messages to avoid duplicates
    published_messages = {}
    
    @realtime_model.on("generation_event")
    async def on_generation_event(event):
        """Handle Nova Sonic generation events."""
        try:
            # Check if this is a text generation event
            if hasattr(event, 'text') and event.text:
                text = event.text.strip()
                if text:
                    # Create unique message ID
                    msg_id = f"assistant_{hash(text)}_{asyncio.get_event_loop().time()}"
                    
                    # Check if we've already published this message
                    if msg_id not in published_messages:
                        published_messages[msg_id] = text
                        
                        # Publish to UI
                        await publish_message(
                            room,
                            "assistant",
                            text,
                            message_id=msg_id,
                            replace=False,
                        )
                        
                        logger.info(f"📤 Published assistant message: {text[:50]}...")
                        
        except Exception as e:
            logger.debug(f"Error in generation event handler: {e}")
    
    logger.info("✅ Nova Sonic event handlers set up")


async def entrypoint(ctx: JobContext):
    """Official Nova Sonic realtime model pattern with persistent storage."""
    # Connect to room and wait for participant
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    environment = os.getenv("ENVIRONMENT", "development")
    storage_type = "S3" if environment == "production" and not os.getenv("FORCE_LOCAL_STORAGE", "false").lower() == "true" else "Local"
    
    logger.info(f"🚀 Starting Nova Sonic agent [{environment.upper()}] with {storage_type} audio storage...")
    
    # Initialize conversation persistence
    session_id = ctx.room.name
    persistence = ConversationPersistence(session_id)
    
    region = os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION", "us-east-1")
    retry_delay = 1.0
    attempt = 0

    while True:
        conversation_task = None
        session = None
        realtime_model = None
        session_task = None
        attempt += 1
        graceful_shutdown = False

        try:
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

            logger.info("🌱 Initializing Nova Sonic session attempt (retry %.1fs)", retry_delay)
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

            # Set up event handlers to capture Nova Sonic's text output
            setup_nova_sonic_event_handlers(ctx.room, realtime_model)
            
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

            await session_task
            graceful_shutdown = True
            logger.info("🎉 Nova Sonic session completed gracefully")

            retry_delay = 1.0
            attempt = 0

        except (APIStatusError, ModelStreamErrorException) as e:
            logger.error("⚠️ Nova Sonic session error (%s): %s", e.__class__.__name__, e)
            retry_delay = 1.0
            try:
                await publish_message(
                    ctx.room,
                    "session_state",
                    "Assistant recovering",
                    message_id="assistant-state",
                    replace=True,
                    topic="lk.control",
                )
            except Exception:
                logger.debug("Unable to publish recovery notice; room may not be ready yet")

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
    last_debug_time = 0
    
    while True:
        try:
            await asyncio.sleep(0.5)  # Check more frequently
            
            current_time = asyncio.get_event_loop().time()
            
            # Debug every 5 seconds to avoid spam
            if current_time - last_debug_time > 5:
                if hasattr(session, '_llm') and hasattr(session._llm, '_sessions'):
                    for i, aws_session in enumerate(session._llm._sessions):
                        if hasattr(aws_session, '_chat_ctx') and hasattr(aws_session._chat_ctx, 'items'):
                            logger.debug(f"🔍 Chat context has {len(aws_session._chat_ctx.items)} items")
                            # Try to access the actual chat context
                            try:
                                for j, item in enumerate(aws_session._chat_ctx.items):
                                    logger.debug(f"🔍 Item {j}: role={getattr(item, 'role', 'unknown')}, content_type={type(getattr(item, 'content', None))}")
                            except Exception as e:
                                logger.debug(f"🔍 Error accessing chat items: {e}")
                last_debug_time = current_time
            
            # Try multiple approaches to access chat context
            found_messages = False
            
            # Approach 1: Direct chat context access
            if hasattr(session, '_llm') and hasattr(session._llm, '_sessions'):
                for aws_session in session._llm._sessions:
                    if hasattr(aws_session, '_chat_ctx') and hasattr(aws_session._chat_ctx, 'items'):
                        for item in aws_session._chat_ctx.items:
                            found_messages = True
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
            
            # Approach 2: Try accessing the realtime model's sessions directly
            if not found_messages and hasattr(realtime_model, '_sessions'):
                for aws_session in realtime_model._sessions:
                    if hasattr(aws_session, '_chat_ctx') and hasattr(aws_session._chat_ctx, 'items'):
                        logger.debug(f"🔍 Found chat context via realtime_model with {len(aws_session._chat_ctx.items)} items")
                        # Process items here similar to approach 1
                                
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
