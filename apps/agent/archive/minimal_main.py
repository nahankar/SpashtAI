#!/usr/bin/env python3

import asyncio
import logging
import os
from dotenv import load_dotenv

from livekit.agents import AutoSubscribe, JobContext, WorkerOptions, cli
from livekit.agents.voice import Agent, AgentSession
from livekit.plugins import aws

# Load environment variables
load_dotenv('../server/.env')

logger = logging.getLogger("minimal-nova-sonic-agent")

async def entrypoint(ctx: JobContext):
    """Minimal Nova Sonic agent without advanced analytics"""
    
    logger.info("🚀 Starting MINIMAL Nova Sonic agent...")
    
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    # Get AWS credentials
    region = os.getenv("AWS_REGION", "us-east-1")
    
    logger.info(f"🌍 Using AWS region: {region}")
    
    try:
        # Create Nova Sonic realtime model
        realtime_model = aws.realtime.RealtimeModel(
            region=region,
        )
        
        logger.info("✅ Nova Sonic model created")
        
        # Create agent with minimal configuration
        agent = Agent(
            instructions="You are a helpful AI assistant. Have a natural conversation with the user.",
            llm=realtime_model,
            tts=realtime_model,
        )
        
        logger.info("✅ Agent created")
        
        # Create session
        session = AgentSession(
            llm=realtime_model,
            tts=realtime_model,
        )
        
        logger.info("✅ Session created")
        
        # Start session
        logger.info("🎯 Starting Nova Sonic session...")
        await session.start(agent=agent, room=ctx.room)
        
        logger.info("🎉 Nova Sonic session completed")
        
    except Exception as e:
        logger.error(f"❌ Error in Nova Sonic session: {e}")
        logger.error(f"   Error type: {type(e).__name__}")
        import traceback
        logger.error(f"   Traceback: {traceback.format_exc()}")

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
