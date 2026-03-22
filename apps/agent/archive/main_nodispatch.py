#!/usr/bin/env python3

"""
SpashtAI Voice Agent - NO DISPATCH VERSION
Connect directly to rooms without agent dispatch
"""

import asyncio
import json
import logging
import os
from datetime import datetime

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents import AgentSession, Agent
from livekit.plugins import aws

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

def prewarm(proc: JobContext):
    """Preload models - official LiveKit pattern"""
    proc.wait_for_participant = True

async def entrypoint(ctx: JobContext):
    """
    NO DISPATCH - Connect to any room that gets a participant
    """
    logger.info("🚀 NO DISPATCH AGENT - CONNECTING TO ALL ROOMS")
    
    environment = os.getenv("ENVIRONMENT", "development")
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Starting SpashtAI agent [{environment.upper()}] with AWS Nova Sonic")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Room: {ctx.room.name}")
    logger.info("🎯 NO AGENT DISPATCH - Will connect to any room with participants")
    
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info("✅ Connected to room with auto-subscribe audio only")
        
        # Wait for participants to join
        logger.info("⏳ Waiting for participants to join...")
        
        # Create AWS Nova Sonic VoiceAssistant
        logger.info("🤖 Initializing AWS Nova Sonic RealtimeModel...")
        
        session = aws.realtime.RealtimeSession(
            model=aws.RealtimeModel(
                model="amazon.nova-sonic-v1:0",
                voice="tiffany",
                region=region,
                instructions=(
                    "You are a professional speech coach named Spashtai. "
                    "Help users improve their public speaking and communication skills. "
                    "Keep responses concise and encouraging. "
                    "Start by greeting the user and asking how you can help them today."
                ),
                turn_detection=aws.realtime.ServerVadOptions(
                    threshold=0.6,
                    prefix_padding_ms=200,
                    silence_duration_ms=500,
                ),
                max_response_output_tokens="inf",
                temperature=0.7,
            )
        )
        
        agent = Agent(session)
        
        # Send agent ready state
        try:
            await asyncio.sleep(1)
            
            agent_info = {
                "type": "session_state", 
                "text": "ready",
                "agent_name": "AWS Nova Sonic Agent",
                "agent_model": "AWS Nova Sonic",
                "agent_voice": "tiffany",
                "timestamp": datetime.now().isoformat()
            }
            
            await ctx.room.local_participant.publish_data(
                json.dumps(agent_info).encode(), 
                topic="lk.control"
            )
            logger.info(f"✅ Sent ready state: {agent_info}")
        except Exception as e:
            logger.warning("⚠️ Failed to send ready state: %s", e)
        
        # Start the AgentSession
        logger.info("🎯 Starting AgentSession...")
        
        await session.start(room=ctx.room, agent=agent)
        
        logger.info("🎉 AgentSession completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e)
        import traceback
        logger.error(f"❌ Full traceback: {traceback.format_exc()}")
        raise

if __name__ == "__main__":
    # Official LiveKit CLI runner
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # No agent name - will connect to any room
        )
    )