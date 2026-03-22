#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Auto-Egress Version
Using LiveKit auto-egress for recordings instead of manual egress calls
"""

import asyncio
import json
import logging
import os
import aiohttp
from datetime import datetime
from typing import Optional
from pathlib import Path

# Global variables for room context (workaround for AWS plugin taking over)
global_room = None
global_session_id = None
global_room_name = None

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

# Server configuration for conversation persistence
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

class TranscriptSaver:
    """Save conversation transcript only - recording handled by auto-egress"""
    
    def __init__(self, session_id: str, room_name: str):
        self.session_id = session_id
        self.room_name = room_name
        self.environment = ENVIRONMENT
        
        # Configure recording output based on environment
        if self.environment == "development":
            # For development - save to local temp directory
            self.recording_dir = Path(f"./recordings/{session_id}")
            self.recording_dir.mkdir(parents=True, exist_ok=True)
        else:
            # For production - save to S3
            self.s3_bucket = os.getenv("S3_BUCKET", "spashtai-recordings")
            self.s3_region = os.getenv("AWS_REGION", "us-east-1")

    async def save_transcript(self, session_history) -> Optional[str]:
        """Save conversation transcript to file only (recording handled by auto-egress)"""
        try:
            current_date = datetime.now().strftime("%Y%m%d_%H%M%S")
            
            if self.environment == "development":
                filename = self.recording_dir / f"transcript_{current_date}.json"
            else:
                filename = f"sessions/{self.session_id}/transcript_{current_date}.json"
            
            transcript_data = {
                "session_id": self.session_id,
                "room_name": self.room_name,
                "timestamp": datetime.now().isoformat(),
                "conversation": session_history,
                "recording_method": "auto-egress"
            }
            
            # Save to file/S3 only
            if self.environment == "development":
                with open(filename, 'w') as f:
                    json.dump(transcript_data, f, indent=2)
                logger.info(f"📄 Transcript saved to: {filename}")
                return str(filename)
            else:
                # Save to S3 in production
                import boto3
                s3_client = boto3.client('s3')
                s3_client.put_object(
                    Bucket=self.s3_bucket,
                    Key=filename,
                    Body=json.dumps(transcript_data, indent=2),
                    ContentType="application/json"
                )
                s3_url = f"s3://{self.s3_bucket}/{filename}"
                logger.info(f"📄 Transcript saved to S3: {s3_url}")
                return s3_url
                
        except Exception as e:
            logger.warning(f"⚠️ Failed to save transcript: {e}")
            return None

class ConversationLogger:
    """Minimal conversation logging to server API - no manual recording"""
    
    def __init__(self, server_url: str, session_id: str):
        self.server_url = server_url
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None

    async def log_message(self, role: str, content: str, audio_url: str = None) -> None:
        """Log conversation message to server with optional audio URL"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            payload = {
                "role": role,
                "content": content,
                "timestamp": datetime.now().isoformat()
            }
            
            if audio_url:
                payload["audioUrl"] = audio_url
            
            async with self.session.post(
                f"{self.server_url}/sessions/{self.session_id}/messages",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5.0)
            ) as response:
                if response.status == 201:
                    logger.info("✅ Successfully saved %s message to database", role)
                else:
                    logger.warning("⚠️ Failed to save message: HTTP %d", response.status)
        except Exception as e:
            logger.warning("⚠️ Failed to save message to database: %s", e)

    async def close(self):
        """Close HTTP session"""
        if self.session:
            await self.session.close()

def prewarm(proc: JobContext):
    """Preload models - official LiveKit pattern"""
    proc.wait_for_participant = True

async def entrypoint(ctx: JobContext):
    """
    Pure LiveKit AgentFramework + AWS Nova Sonic entrypoint with auto-egress
    Recording is handled automatically by room creation in livekit.ts
    """
    logger.info("🚀 ENTRYPOINT CALLED - AUTO-EGRESS VERSION")
    
    environment = os.getenv("ENVIRONMENT", "development")
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Starting SpashtAI agent [{environment.upper()}] with AWS Nova Sonic")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Room: {ctx.room.name}")
    logger.info(f"🎥 Recording: AUTO-EGRESS ENABLED (no manual recording needed)")
    
    # Initialize conversation logger with session ID from job metadata
    session_id = None
    try:
        # Extract session ID from job metadata (passed from LiveKit token)
        if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata'):
            import json
            metadata = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
            session_id = metadata.get('sessionId')
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    # Fallback to generating session ID if not found in metadata
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
    
    logger.info(f"📋 Session ID: {session_id}")
    
    # Store globally for potential use (AWS plugin needs this)
    global global_session_id, global_room_name, global_room
    global_session_id = session_id
    global_room_name = ctx.room.name
    global_room = ctx.room
    
    # Initialize conversation logging and transcript saving (no recording)
    conversation_logger = ConversationLogger(SERVER_URL, session_id)
    transcript_saver = TranscriptSaver(session_id, ctx.room.name)
    
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info("✅ Connected to room with auto-subscribe audio only")
        
        # Create AWS Nova Sonic VoiceAssistant using official LiveKit plugin
        # Using Bedrock for AWS Nova Sonic integration
        logger.info("🤖 Initializing AWS Nova Sonic RealtimeModel...")
        
        session = aws.realtime.RealtimeSession(
            model=aws.RealtimeModel(
                model="amazon.nova-sonic-v1:0",
                voice="tiffany",
                region=region,
                instructions=(
                    "You are a professional speech coach and communication expert named Spashtai. "
                    "Your role is to help users improve their public speaking, communication skills, and confidence. "
                    "Provide supportive, actionable feedback on speech patterns, clarity, pace, and delivery. "
                    "Be encouraging while offering specific improvement suggestions. "
                    "Keep responses concise and conversational. "
                    "Focus on helping users become better speakers and communicators."
                ),
                turn_detection=aws.realtime.ServerVadOptions(
                    threshold=0.6,
                    prefix_padding_ms=200,
                    silence_duration_ms=500,
                ),
                # Session configuration
                max_response_output_tokens="inf",
                temperature=0.7,
            )
        )
        
        agent = Agent(session)
        
        # Enhanced conversation tracking for database logging
        async def log_user_speech(event: aws.realtime.ConversationItemAdded):
            """Log user speech to database when detected"""
            try:
                if event.item.type == "message" and event.item.role == "user":
                    # Get transcript content from the user's audio
                    content = ""
                    for content_part in event.item.content:
                        if content_part.type == "input_text":
                            content += content_part.text
                        elif content_part.type == "input_audio" and hasattr(content_part, 'transcript'):
                            content += content_part.transcript
                    
                    if content.strip():
                        await conversation_logger.log_message("user", content.strip())
                        logger.info("✅ Logged user speech: %s", content.strip()[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log user speech: %s", e)
        
        async def log_assistant_speech(event: aws.realtime.ConversationItemAdded):
            """Log assistant speech to database when generated"""
            try:
                if event.item.type == "message" and event.item.role == "assistant":
                    # Get response content
                    content = ""
                    for content_part in event.item.content:
                        if content_part.type == "text":
                            content += content_part.text
                        elif hasattr(content_part, 'transcript'):
                            content += content_part.transcript
                    
                    if content.strip():
                        await conversation_logger.log_message("assistant", content.strip())
                        logger.info("✅ Logged assistant speech: %s", content.strip()[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log assistant speech: %s", e)
        
        # Set up event handlers for conversation logging
        session.on("conversation_item_added", log_user_speech)
        session.on("conversation_item_added", log_assistant_speech)
        
        # Enhanced fallback speech detection (backup system)
        @agent.on("agent_speech_interrupted")
        async def on_speech_interrupted(event):
            try:
                # Log interruption event
                await conversation_logger.log_message("system", f"Speech interrupted: {event}")
                logger.info("📞 Agent speech interrupted")
            except Exception as e:
                logger.warning("⚠️ Failed to log interruption: %s", e)
        
        @agent.on("agent_speech_committed")
        async def on_speech_committed(event):
            try:
                # This is a backup handler - conversation_item_added should handle most cases
                # Only log if we get useful text content
                text = str(event) if hasattr(event, '__str__') and str(event) not in ['<class', 'object'] else None
                if text and len(text) > 10:  # Only process meaningful text
                    asyncio.create_task(conversation_logger.log_message("assistant", text))
                    logger.info("✅ Backup logged assistant speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log agent speech: %s", e)
        
        # Set up transcript saving on shutdown (recording handled by auto-egress)
        async def save_transcript_on_shutdown():
            try:
                # Get the conversation history from the session
                if hasattr(session, 'history'):
                    await transcript_saver.save_transcript(session.history.to_dict())
                else:
                    logger.warning("⚠️ No session history available for transcript")
                    
                logger.info("✅ Transcript saved - recording handled by auto-egress")
                    
            except Exception as e:
                logger.warning(f"⚠️ Failed to save transcript on shutdown: {e}")
        
        # Register shutdown callback for saving transcript only
        ctx.add_shutdown_callback(save_transcript_on_shutdown)
        
        logger.info("✅ Auto-egress recording and transcript system initialized")
        
        # Send agent ready state to frontend with enhanced metadata
        try:
            # Use data channel to send state information to frontend
            await asyncio.sleep(1)  # Wait for connection to be established
            
            # Send detailed agent information
            agent_info = {
                "type": "session_state", 
                "text": "ready",
                "agent_name": "AWS Nova Sonic Agent",
                "agent_model": "AWS Nova Sonic",
                "agent_voice": "tiffany",
                "recording_method": "auto-egress",
                "timestamp": datetime.now().isoformat()
            }
            
            await ctx.room.local_participant.publish_data(
                json.dumps(agent_info).encode(), 
                topic="lk.control"
            )
            logger.info(f"✅ Sent enhanced ready state to frontend: {agent_info}")
        except Exception as e:
            logger.warning("⚠️ Failed to send ready state: %s", e)
        
        # Start the AgentSession using the official pattern (from docs)
        logger.info("🎯 Starting AgentSession with AWS Nova Sonic and auto-egress recording...")
        
        # AWS Nova Sonic RealtimeModel doesn't have _chat_ctx like other LLMs
        # The conversation tracking is handled via the conversation_item_added event handler above
        
        await session.start(room=ctx.room, agent=agent)
        
        logger.info("🎉 AgentSession completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e)
        raise
    finally:
        # Cleanup
        await conversation_logger.close()
        # Recording cleanup is handled automatically by auto-egress
        logger.info("🧹 Agent cleanup completed")

if __name__ == "__main__":
    # Official LiveKit CLI runner
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            # Agent name for explicit dispatch
            agent_name="spashtai-assistant",
        )
    )