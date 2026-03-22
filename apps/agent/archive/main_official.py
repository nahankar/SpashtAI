#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Official LiveKit Agent Framework Implementation
Following official LiveKit patterns from https://docs.livekit.io/agents/
"""

import asyncio
import logging
import os
from typing import Dict, Any

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
    AgentSession,
    Agent,
    RoomInputOptions,
)
from livekit.plugins import aws, noise_cancellation

# Load environment variables
load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)


class SpashtAIAssistant(Agent):
    """
    SpashtAI Interview Assistant Agent
    Extends the official LiveKit Agent class
    """
    
    def __init__(self):
        super().__init__(
            instructions=(
                "You are a voice assistant for SpashtAI, a platform for voice AI interviews and practice. "
                "Your interface with users will be voice. You should use short and concise responses, "
                "and avoid usage of unpronounceable punctuation. Be helpful, encouraging, and professional. "
                "When conducting interview practice, ask thoughtful questions and provide constructive feedback. "
                "You are powered by Amazon Nova Sonic for natural speech synthesis."
            )
        )


def prewarm(proc: JobContext):
    """
    Preload models and resources before the agent starts.
    Official LiveKit pattern for optimization.
    """
    proc.wait_for_participant = True


async def entrypoint(ctx: JobContext):
    """
    Main entrypoint following official LiveKit Agent patterns.
    Uses AgentSession for proper orchestration instead of manual handling.
    """
    # Connect to room and wait for participant (official pattern)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    logger.info("🚀 Starting SpashtAI agent with official LiveKit patterns...")
    
    # Get AWS configuration
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    try:
        # Create AgentSession with AWS Nova Sonic (official pattern)
        session = AgentSession(
            # Use AWS Nova Sonic Realtime Model (official plugin)
            llm=aws.realtime.RealtimeModel(
                region=region,
                voice="tiffany",  # AWS Nova Sonic voice
                temperature=0.7,
                top_p=0.9,
                max_tokens=1024,
            ),
            # Optional: Add other providers for STT/TTS if needed
            # stt=...,  # Can add other STT providers
            # tts=...,  # Can add other TTS providers
            # vad=...,  # Can add VAD
        )
        
        logger.info("✅ AgentSession created with AWS Nova Sonic")
        
        # Start the session (official pattern)
        await session.start(
            room=ctx.room,
            agent=SpashtAIAssistant(),
            room_input_options=RoomInputOptions(
                # Enhanced noise cancellation for better audio quality
                noise_cancellation=noise_cancellation.BVC(),
            ),
        )
        
        logger.info("🎯 AgentSession started successfully")
        
        # Generate initial greeting (official pattern)
        await session.generate_reply(
            instructions=(
                "Greet the user warmly and introduce yourself as their SpashtAI interview practice assistant. "
                "Ask what type of interview practice they'd like to do today - job interview, VC pitch, or language fluency practice."
            )
        )
        
        logger.info("🎉 SpashtAI agent is ready and has greeted the user")
        
    except Exception as e:
        logger.error("❌ Failed to start SpashtAI agent: %s", e)
        raise


async def request_handler(req: agents.JobRequest) -> None:
    """
    Optional: Handle job requests with custom logic
    This is the official way to add custom behavior
    """
    logger.info("📋 Job request received: %s", req)
    
    # Add custom logic here if needed
    # For example, you could customize behavior based on room metadata
    room_metadata = req.room.metadata or {}
    if "interview_type" in room_metadata:
        logger.info("🎯 Interview type: %s", room_metadata["interview_type"])


if __name__ == "__main__":
    # Official LiveKit CLI runner pattern
    cli.run_app(
        WorkerOptions(
            # Main entrypoint function
            entrypoint_fnc=entrypoint,
            # Optional: Prewarming function for optimization
            prewarm_fnc=prewarm,
            # Optional: Request handler for custom logic
            request_fnc=request_handler,
        )
    )