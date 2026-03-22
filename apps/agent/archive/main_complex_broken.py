#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Pure LiveKit AgentFramework + AWS Nova Sonic
Official LiveKit patterns only, minimal custom code
"""

import asyncio
import json
import logging
import os
import aiohttp
import boto3
import base64
import wave
import struct
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
from livekit import api

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

# Server configuration for conversation persistence
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

class LiveKitRecorder:
    """Official LiveKit recording using Egress API"""
    
    def __init__(self, session_id: str, room_name: str):
        self.session_id = session_id
        self.room_name = room_name
        self.environment = ENVIRONMENT
        self.recording_id = None
        
        # Configure recording output based on environment
        if self.environment == "development":
            # For development - save to local temp directory
            self.recording_dir = Path(f"./recordings/{session_id}")
            self.recording_dir.mkdir(parents=True, exist_ok=True)
        else:
            # For production - save to S3
            self.s3_bucket = os.getenv("S3_BUCKET", "spashtai-recordings")
            self.s3_region = os.getenv("AWS_REGION", "us-east-1")
    
    async def start_recording(self, room_name: str = None) -> bool:
        """Start room composite recording using LiveKit Egress API"""
        # Use provided room_name or fall back to stored room_name
        room_to_record = room_name or self.room_name
        try:
            # Debug log environment variables
            livekit_url = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
            livekit_key = os.getenv("LIVEKIT_API_KEY", "devkey")
            livekit_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
            
            logger.info(f"🔧 Starting recording with URL: {livekit_url}, Key: {livekit_key[:5]}...")
            
            # Initialize LiveKit API with explicit credentials
            lkapi = api.LiveKitAPI(
                url=livekit_url,
                api_key=livekit_key,
                api_secret=livekit_secret,
            )
            
            if self.environment == "development":
                # Development: Record to local file
                filename = f"session_{self.session_id}_{int(datetime.now().timestamp())}.ogg"
                filepath = str(self.recording_dir / filename)
                
                req = api.RoomCompositeEgressRequest(
                    room_name=room_to_record,
                    audio_only=True,  # Audio only recording
                    file_outputs=[api.EncodedFileOutput(
                        file_type=api.EncodedFileType.OGG,
                        filepath=filepath,
                    )],
                )
            else:
                # Production: Record to S3
                filename = f"sessions/{self.session_id}/audio_{int(datetime.now().timestamp())}.ogg"
                
                req = api.RoomCompositeEgressRequest(
                    room_name=room_to_record,
                    audio_only=True,  # Audio only recording
                    file_outputs=[api.EncodedFileOutput(
                        file_type=api.EncodedFileType.OGG,
                        filepath=filename,
                        s3=api.S3Upload(
                            bucket=self.s3_bucket,
                            region=self.s3_region,
                            access_key=os.getenv("AWS_ACCESS_KEY_ID"),
                            secret=os.getenv("AWS_SECRET_ACCESS_KEY"),
                        ),
                    )],
                )
            
            # Start the recording
            res = await lkapi.egress.start_room_composite_egress(req)
            await lkapi.aclose()
            
            self.recording_id = res.egress_id
            
            if self.environment == "development":
                logger.info(f"🎥 Started recording to local file: {filepath}")
            else:
                logger.info(f"� Started recording to S3: s3://{self.s3_bucket}/{filename}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to start recording: {type(e).__name__}: {e}")
            import traceback
            logger.error(f"❌ Full traceback: {traceback.format_exc()}")
            return False
    
    async def stop_recording(self) -> Optional[str]:
        """Stop the room recording and return the file path/URL"""
        if not self.recording_id:
            return None
            
        try:
            # Initialize LiveKit API with explicit credentials
            lkapi = api.LiveKitAPI(
                url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
                api_key=os.getenv("LIVEKIT_API_KEY", "devkey"),
                api_secret=os.getenv("LIVEKIT_API_SECRET", "devsecret"),
            )
            await lkapi.egress.stop_egress(self.recording_id)
            await lkapi.aclose()
            
            logger.info(f"🎥 Stopped recording: {self.recording_id}")
            
            # Return the recording location based on environment
            if self.environment == "development":
                return str(self.recording_dir)
            else:
                return f"s3://{self.s3_bucket}/sessions/{self.session_id}/"
                
        except Exception as e:
            logger.warning(f"⚠️ Failed to stop recording: {e}")
            return None
    
    async def save_transcript(self, session_history) -> Optional[str]:
        """Save conversation transcript to file only (database handled separately)"""
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
                "conversation": session_history
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
    """Minimal conversation logging to server API with audio support"""
    
    def __init__(self, server_url: str, session_id: str):
        self.server_url = server_url
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None
        self.recorder = None
        self.recording_started = False
    
    async def start_recording_if_needed(self) -> None:
        """Start recording on first message if not already started"""
        if not self.recording_started:
            try:
                logger.info("🎬 Starting LiveKit recording for session: %s", self.session_id)
                # Try to get room name from global variables or session ID
                room_name = global_room_name or self.session_id.split('_')[-1] if '_' in self.session_id else None
                if room_name:
                    self.recorder = LiveKitRecorder(self.session_id, room_name)
                    recording_success = await self.recorder.start_recording()
                    if recording_success:
                        logger.info("✅ Recording started successfully")
                        self.recording_started = True
                    else:
                        logger.error("❌ Failed to start recording")
                else:
                    logger.error("❌ Could not determine room name for recording")
            except Exception as e:
                logger.error("❌ Error starting recording: %s", e)

    async def log_message(self, role: str, content: str, audio_url: str = None) -> None:
        """Log conversation message to server with optional audio URL"""
        try:
            # Start recording on first message if not already started
            if not self.recording_started:
                await self.start_recording_if_needed()
            
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
    Pure LiveKit AgentFramework + AWS Nova Sonic entrypoint
    Using official VoiceAssistant pattern
    """
    logger.info("🚀 ENTRYPOINT CALLED - DEBUG TRACE ACTIVE")
    
    environment = os.getenv("ENVIRONMENT", "development")
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Starting SpashtAI agent [{environment.upper()}] with AWS Nova Sonic")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Room: {ctx.room.name}")
    
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
    
    logger.info(f"📋 Using session ID: {session_id}")
    
    # Connect FIRST to ensure room is registered with LiveKit server
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    logger.info(f"✅ Connected to room: {ctx.room.name}")
    
    # Set global variables for other parts of the code
    global global_room, global_session_id, global_room_name
    global_room = ctx.room
    global_room_name = ctx.room.name
    logger.info(f"📋 Global variables set - Room: {global_room_name}")
    
    # Skip recording for now - focus on getting conversation working
    logger.info("⏭️ Skipping recording setup - focusing on conversation only")
    recording_started = False
    recording_id = None
    
    # Initialize conversation logger
    conversation_logger = ConversationLogger(SERVER_URL, session_id)
    
    try:
        # Create AWS Nova Sonic LLM (official pattern)
        llm = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
        )
        
        logger.info("✅ AWS Nova Sonic model created")
        
        # Create AgentSession with official LiveKit pattern (from docs example)
        session = AgentSession(
            llm=llm,  # AWS Nova Sonic RealtimeModel
            use_tts_aligned_transcript=True  # Enable TTS-aligned transcriptions (sentence-level for Nova Sonic)
        )
        
        logger.info("✅ AgentSession created with AWS Nova Sonic")
        
        # Create Agent with official LiveKit pattern
        agent = Agent(
            instructions=(
                "You are a voice assistant for SpashtAI, a platform for voice AI interviews and practice. "
                "Your interface with users will be voice. You should use short and concise responses, "
                "and avoid usage of unpronounceable punctuation. Be helpful, encouraging, and professional. "
                "When conducting interview practice, ask thoughtful questions and provide constructive feedback. "
                "You are powered by Amazon Nova Sonic for natural speech synthesis."
            )
        )
        
        logger.info("✅ Agent created with AWS Nova Sonic")
        
        # Set agent participant name and metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent name and metadata set for frontend identification")
        except Exception as e:
            logger.warning("⚠️ Failed to set agent metadata: %s", e)
        
        # Add conversation logging event handlers (using sync callbacks with asyncio.create_task)
        # For AWS Nova Sonic, we need to listen to the right events - let's try multiple approaches
        
        @session.on("conversation_item_added")
        def on_conversation_item_added(item):
            """Track conversation items and publish to frontend"""
            try:
                logger.info(f"🎯 Conversation item added event fired: type='{type(item).__name__}' item={item} created_at={getattr(item, 'created_at', 'unknown')}")
                
                # Extract role and content properly - handle different event types
                role = "unknown"
                content = ""
                
                # Check if it's a ChatMessage (from AWS Nova Sonic)
                if hasattr(item, 'item') and hasattr(item.item, 'role'):
                    # It's a conversation_item_added event with nested item
                    message_item = item.item
                    role = getattr(message_item, 'role', 'unknown')
                    content_attr = getattr(message_item, 'content', [])
                elif hasattr(item, 'role'):
                    # It's directly a ChatMessage
                    role = getattr(item, 'role', 'unknown')
                    content_attr = getattr(item, 'content', [])
                else:
                    logger.warning(f"🤔 Unknown item structure: {type(item)} - {item}")
                    return
                
                # Handle different content formats - AWS Nova Sonic uses content arrays
                if isinstance(content_attr, list) and len(content_attr) > 0:
                    # Join all content pieces if multiple
                    content = ' '.join(str(piece).strip() for piece in content_attr if str(piece).strip())
                elif isinstance(content_attr, str):
                    content = content_attr.strip()
                else:
                    content = str(content_attr).strip()
                
                # Debug content extraction with full details
                logger.info(f"🔍 Content extracted: role='{role}', content_attr='{content_attr}', final_content='{content}'")
                
                # Filter out empty, meaningless, or system-generated content
                if not content or content in ['[]', '', 'None', 'null'] or len(content) < 3:
                    logger.info(f"⏭️ Skipping empty/invalid conversation item: '{content}'")
                    return
                
                # Send in format expected by frontend processPayload
                message_data = {
                    "type": role,  # 'user' or 'assistant'
                    "text": content,
                    "final": True,  # Mark as final message
                    "id": getattr(item, 'id', f"{role}_{int(datetime.now().timestamp() * 1000)}"),
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }
                
                asyncio.create_task(ctx.room.local_participant.publish_data(
                    json.dumps(message_data).encode(),
                    topic="lk.conversation"
                ))
                
                # Log to conversation API (audio recording is handled by LiveKit Egress)
                asyncio.create_task(conversation_logger.log_message(role, content))
                
                logger.info(f"📝 Conversation item processed: {role}: {content[:100]}...")
            except Exception as e:
                logger.warning("⚠️ Failed to process conversation item: %s", e)
        
        @session.on("user_speech_committed")
        def on_user_speech(event):
            """Handle user speech events (backup - conversation_item_added should handle most cases)"""
            try:
                logger.info(f"🎯 User speech committed event fired: {event}")
                # This is a backup handler - conversation_item_added should handle most cases
                # Only log if we get useful text content
                text = str(event) if hasattr(event, '__str__') and str(event) not in ['<class', 'object'] else None
                if text and len(text) > 10:  # Only process meaningful text
                    asyncio.create_task(conversation_logger.log_message("user", text))
                    logger.info("✅ Backup logged user speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log user speech: %s", e)
        
        @session.on("agent_speech_committed") 
        def on_agent_speech(event):
            """Handle agent speech events (backup - conversation_item_added should handle most cases)"""
            try:
                logger.info(f"🎯 Agent speech committed event fired: {event}")
                # This is a backup handler - conversation_item_added should handle most cases
                # Only log if we get useful text content
                text = str(event) if hasattr(event, '__str__') and str(event) not in ['<class', 'object'] else None
                if text and len(text) > 10:  # Only process meaningful text
                    asyncio.create_task(conversation_logger.log_message("assistant", text))
                    logger.info("✅ Backup logged assistant speech: %s", text[:50])
            except Exception as e:
                logger.warning("⚠️ Failed to log agent speech: %s", e)
        
        # Set up transcript saving on shutdown
        async def save_transcript_on_shutdown():
            try:
                # Get the conversation history from the session
                if hasattr(session, 'history'):
                    await livekit_recorder.save_transcript(session.history.to_dict())
                else:
                    logger.warning("⚠️ No session history available for transcript")
                    
                # Stop the recording
                recording_location = await livekit_recorder.stop_recording()
                if recording_location:
                    logger.info(f"✅ Recording saved to: {recording_location}")
                    
            except Exception as e:
                logger.warning(f"⚠️ Failed to save transcript/recording on shutdown: {e}")
        
        # Register shutdown callback for saving transcript and stopping recording
        ctx.add_shutdown_callback(save_transcript_on_shutdown)
        
        logger.info("✅ LiveKit recording and transcript system initialized")
        
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
        logger.info("🎯 Starting AgentSession with AWS Nova Sonic...")
        
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
        # Recording cleanup is handled by shutdown callback
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