#!/usr/bin/env python3

import asyncio
import json
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
    """Correct Nova Sonic implementation using LiveKit's built-in event handlers"""
    
    logger.info("🚀 Starting Nova Sonic agent with CORRECT LiveKit event handlers...")
    
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
        
        # Set up LiveKit's built-in event handlers for transcript publishing
        @session.on("user_speech_committed")
        async def on_user_speech(event):
            transcript = event.transcript
            logger.info(f"👤 User said: {transcript}")
            
            # Publish transcript to UI using LiveKit's official pattern
            await ctx.room.local_participant.publish_data(
                json.dumps({
                    "type": "user_transcript",
                    "text": transcript,
                    "final": True,
                    "timestamp": asyncio.get_event_loop().time()
                }).encode('utf-8'),
                reliable=True,
                topic="lk.transcription"
            )
        
        @session.on("agent_speech_committed") 
        async def on_agent_speech(event):
            response = event.text
            logger.info(f"🤖 Assistant said: {response}")
            
            # Publish response to UI using LiveKit's official pattern
            await ctx.room.local_participant.publish_data(
                json.dumps({
                    "type": "assistant",
                    "text": response,
                    "final": True,
                    "timestamp": asyncio.get_event_loop().time()
                }).encode('utf-8'),
                reliable=True,
                topic="lk.transcription"
            )
        
        @session.on("llm_response_started")
        async def on_llm_start(event):
            logger.info("🧠 LLM started generating response...")
            
        @session.on("llm_response_finished")
        async def on_llm_finish(event):
            logger.info("✅ LLM finished generating response")
        
        # Publish ready state
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "Assistant ready"
            }).encode('utf-8'),
            reliable=True,
            topic="lk.control"
        )
        
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

