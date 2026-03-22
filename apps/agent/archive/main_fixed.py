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

logger = logging.getLogger("nova-sonic-agent")
logger.setLevel(logging.INFO)

def prewarm(proc: JobContext):
    """Preload models and resources before the agent starts."""
    proc.wait_for_participant = True

async def entrypoint(ctx: JobContext):
    """Official Nova Sonic realtime model pattern - using LiveKit framework properly"""
    
    logger.info("🚀 Starting Nova Sonic agent with OFFICIAL LiveKit pattern...")
    
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    
    # Get AWS credentials
    region = os.getenv("AWS_REGION", "us-east-1")
    
    # Check AWS credentials
    has_credentials = bool(os.getenv('AWS_ACCESS_KEY_ID')) and bool(os.getenv('AWS_SECRET_ACCESS_KEY'))
    
    if not has_credentials:
        logger.error("❌ AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.")
        logger.info("💡 For development, you can use AWS CLI: aws configure")
        return
    
    logger.info(f"🌍 Using AWS region: {region}")
    
    try:
        # Create Nova Sonic realtime model - this handles STT + LLM + TTS internally
        realtime_model = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024
        )
        
        logger.info("✅ Nova Sonic model created")
        
        # Create agent with proper instructions
        agent = Agent(
            instructions=(
                "You are a voice assistant for SpashtAI, a platform for voice AI interviews and practice. "
                "Your interface with users will be voice. You should use short and concise responses, "
                "and avoid usage of unpronounceable punctuation. Be helpful, encouraging, and professional. "
                "You are powered by Amazon Nova Sonic for natural speech synthesis. "
                "Wait for the user to speak first, then respond naturally to continue the conversation. "
                "Keep the conversation going by asking follow-up questions when appropriate. "
                "Stay engaged and maintain an active dialogue with the user."
            ),
            llm=realtime_model,
            tts=realtime_model,  # Nova Sonic handles TTS internally
        )
        
        logger.info("✅ Agent created")
        
        # Create session - this is where the magic happens
        session = AgentSession(
            llm=realtime_model,
        )
        
        logger.info("✅ Session created")
        
        # Start session - this will block until the session ends naturally
        logger.info("🎯 Starting Nova Sonic session...")
        logger.info("🎤 Waiting for user to speak...")
        
        await session.start(agent=agent, room=ctx.room)
        
        logger.info("🎉 Nova Sonic session completed naturally")
        
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

