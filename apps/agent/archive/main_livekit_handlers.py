#!/usr/bin/env python3

import asyncio
import logging
import os
import json
from contextlib import suppress

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
logger.setLevel(logging.INFO)


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


async def entrypoint(ctx: JobContext):
    """LiveKit event handlers approach - testing official patterns"""
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    logger.info("🚀 Starting Nova Sonic agent with LiveKit EVENT HANDLERS...")
    
    region = os.getenv("BEDROCK_REGION") or os.getenv("AWS_REGION", "us-east-1")
    
    # Check AWS credentials
    has_credentials = bool(os.getenv('AWS_ACCESS_KEY_ID')) and bool(os.getenv('AWS_SECRET_ACCESS_KEY'))
    
    if not has_credentials:
        logger.error("❌ AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.")
        return

    try:
        # Create Nova Sonic realtime model
        realtime_model = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany"
        )

        # Create agent
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

        # Create session
        session = AgentSession(
            llm=realtime_model,
        )

        logger.info("✅ Nova Sonic agent and session instantiated")

        # Set up LiveKit's built-in event handlers
        @session.on("user_speech_committed")
        async def on_user_speech(event):
            transcript = event.transcript
            logger.info(f"👤 USER SPEECH EVENT: {transcript}")
            
            await publish_message(
                ctx.room,
                "user_transcript",
                transcript,
                message_id=f"user_{asyncio.get_event_loop().time()}",
                replace=False,
                topic="lk.transcription"
            )
        
        @session.on("agent_speech_committed") 
        async def on_agent_speech(event):
            response = event.text
            logger.info(f"🤖 AGENT SPEECH EVENT: {response}")
            
            await publish_message(
                ctx.room,
                "assistant",
                response,
                message_id=f"assistant_{asyncio.get_event_loop().time()}",
                replace=False,
                topic="lk.transcription"
            )

        @session.on("llm_response_started")
        async def on_llm_start(event):
            logger.info("🧠 LLM RESPONSE STARTED EVENT")
            
        @session.on("llm_response_finished")
        async def on_llm_finish(event):
            logger.info("✅ LLM RESPONSE FINISHED EVENT")

        # Publish ready state
        await publish_message(
            ctx.room,
            "session_state",
            "Assistant ready",
            message_id="assistant-state",
            replace=True,
            topic="lk.control",
        )

        logger.info("🎯 Starting Nova Sonic session with LiveKit event handlers...")
        logger.info("🎤 Waiting for user to speak...")

        # Start the session - this should trigger the event handlers
        await session.start(agent=agent, room=ctx.room)
        
        logger.info("🎉 Nova Sonic session completed")

    except Exception as e:
        logger.error(f"❌ Error in Nova Sonic session: {e}")
        logger.error(f"   Error type: {type(e).__name__}")
        import traceback
        logger.error(f"   Traceback: {traceback.format_exc()}")


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
        ),
    )

