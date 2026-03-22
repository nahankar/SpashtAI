#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Clean AWS Nova Sonic with working Agent pattern
"""

import asyncio
import json
import logging
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentSession,
    WorkerOptions,
    cli,
)
from livekit.plugins import aws

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("spashtai-agent")

# Load environment variables
load_dotenv()

def prewarm():
    """Prewarm function for worker process"""
    logger.info("🔥 Prewarming agent worker")


async def entrypoint(ctx):
    """Main entrypoint for the agent"""
    try:
        logger.info(f"🚀 Connected to room: {ctx.room.name}")
        
        # Create AWS Nova Sonic LLM
        llm = aws.LLM(
            model="amazon.nova-sonic-v1",
            region="us-east-1",
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
        )
        logger.info("✅ AWS Nova Sonic model created")
        
        # Create agent with Nova Sonic
        agent = Agent(
            llm=llm,
            tts=llm,  # Use Nova Sonic for both LLM and TTS
        )
        logger.info("✅ Agent created")
        
        # Create session 
        session = AgentSession(
            llm=llm,
            use_tts_aligned_transcript=True
        )
        logger.info("✅ Session created")
        
        # Send ready state to frontend
        try:
            await ctx.room.local_participant.publish_data(
                json.dumps({
                    "type": "agent_ready",
                    "agent_name": "SpashtAI Assistant",
                    "timestamp": datetime.now().isoformat()
                }).encode(), 
                topic="lk.control"
            )
            logger.info("✅ Sent ready state to frontend")
            
            # Send a test conversation message
            await ctx.room.local_participant.publish_data(
                json.dumps({
                    "type": "assistant",
                    "text": "Hello! I'm your SpashtAI Assistant. I can hear you through voice - let's start our conversation!",
                    "final": True,
                    "id": f"assistant_{int(datetime.now().timestamp() * 1000)}",
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }).encode(),
                topic="lk.conversation"
            )
            logger.info("✅ Sent test conversation message")
            
        except Exception as e:
            logger.warning("⚠️ Failed to send ready state: %s", e)
        
        # Start the session - this should be stable and not restart
        logger.info("🎯 Starting session...")
        await session.start(room=ctx.room, agent=agent)
        
        logger.info("🎉 Session completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e)
        raise


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="spashtai-assistant",
        )
    )