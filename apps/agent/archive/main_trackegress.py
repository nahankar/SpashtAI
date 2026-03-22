#!/usr/bin/env python3

"""
SpashtAI Voice Agent - Track Egress Version
Using individual track recording instead of room composite egress
Based on livekit-whisper-transcribe approach from the references
"""

import asyncio
import json
import logging
import os
import aiohttp
from datetime import datetime
from typing import Optional
from pathlib import Path

from dotenv import load_dotenv
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents import AgentSession, Agent
from livekit.plugins import aws
from livekit import api, rtc

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

# Server configuration for conversation persistence
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

class TrackRecorder:
    """Record individual audio tracks instead of room composite"""
    
    def __init__(self, session_id: str, room_name: str):
        self.session_id = session_id
        self.room_name = room_name
        self.environment = ENVIRONMENT
        self.recording_ids = []
        
        # Configure recording output based on environment
        if self.environment == "development":
            self.recording_dir = Path(f"./recordings/{session_id}")
            self.recording_dir.mkdir(parents=True, exist_ok=True)
        else:
            self.s3_bucket = os.getenv("S3_BUCKET", "spashtai-recordings")
            self.s3_region = os.getenv("AWS_REGION", "us-east-1")
    
    async def start_track_recording(self, track_sid: str, participant_identity: str) -> bool:
        """Start recording individual audio track"""
        try:
            # Initialize LiveKit API
            lkapi = api.LiveKitAPI(
                url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
                api_key=os.getenv("LIVEKIT_API_KEY", "devkey"),
                api_secret=os.getenv("LIVEKIT_API_SECRET", "devsecret"),
            )
            
            if self.environment == "development":
                # Development: Record to local file
                filename = f"track_{participant_identity}_{track_sid}_{int(datetime.now().timestamp())}.ogg"
                filepath = str(self.recording_dir / filename)
                
                req = api.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=track_sid,
                    file=api.DirectFileOutput(
                        filepath=filepath,
                        file_type=api.EncodedFileType.OGG,
                    )
                )
            else:
                # Production: Record to S3
                filename = f"tracks/{self.session_id}/{participant_identity}_{track_sid}_{int(datetime.now().timestamp())}.ogg"
                
                req = api.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=track_sid,
                    file=api.DirectFileOutput(
                        filepath=filename,
                        file_type=api.EncodedFileType.OGG,
                        s3=api.S3Upload(
                            bucket=self.s3_bucket,
                            region=self.s3_region,
                            access_key=os.getenv("AWS_ACCESS_KEY_ID"),
                            secret=os.getenv("AWS_SECRET_ACCESS_KEY"),
                        ),
                    )
                )
            
            # Start the track recording
            res = await lkapi.egress.start_track_egress(req)
            await lkapi.aclose()
            
            self.recording_ids.append(res.egress_id)
            
            if self.environment == "development":
                logger.info(f"🎥 Started track recording to: {filepath}")
            else:
                logger.info(f"🎥 Started track recording to S3: s3://{self.s3_bucket}/{filename}")
            
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to start track recording: {type(e).__name__}: {e}")
            return False
    
    async def stop_all_recordings(self) -> list:
        """Stop all track recordings"""
        stopped_recordings = []
        
        for recording_id in self.recording_ids:
            try:
                lkapi = api.LiveKitAPI(
                    url=os.getenv("LIVEKIT_URL", "ws://localhost:7880"),
                    api_key=os.getenv("LIVEKIT_API_KEY", "devkey"),
                    api_secret=os.getenv("LIVEKIT_API_SECRET", "devsecret"),
                )
                await lkapi.egress.stop_egress(recording_id)
                await lkapi.aclose()
                
                stopped_recordings.append(recording_id)
                logger.info(f"🎥 Stopped track recording: {recording_id}")
                
            except Exception as e:
                logger.warning(f"⚠️ Failed to stop recording {recording_id}: {e}")
        
        return stopped_recordings

    async def save_transcript(self, session_history) -> Optional[str]:
        """Save conversation transcript"""
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
                "recording_method": "track-egress",
                "recording_ids": self.recording_ids
            }
            
            if self.environment == "development":
                with open(filename, 'w') as f:
                    json.dump(transcript_data, f, indent=2)
                logger.info(f"📄 Transcript saved to: {filename}")
                return str(filename)
            else:
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
    """Minimal conversation logging to server API"""
    
    def __init__(self, server_url: str, session_id: str):
        self.server_url = server_url
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None

    async def log_message(self, role: str, content: str, audio_url: str = None) -> None:
        """Log conversation message to server"""
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
    Track egress version - records individual participant tracks
    More reliable than room composite egress
    """
    logger.info("🚀 ENTRYPOINT CALLED - TRACK EGRESS VERSION")
    
    environment = os.getenv("ENVIRONMENT", "development")
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Starting SpashtAI agent [{environment.upper()}] with AWS Nova Sonic")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Room: {ctx.room.name}")
    logger.info(f"🎥 Recording: TRACK EGRESS (individual audio tracks)")
    
    # Initialize session ID
    session_id = None
    try:
        if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata'):
            import json
            metadata = json.loads(ctx.job.metadata) if ctx.job.metadata else {}
            session_id = metadata.get('sessionId')
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    if not session_id:
        session_id = f"session_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
    
    logger.info(f"📋 Session ID: {session_id}")
    
    # Initialize conversation logging and track recording
    conversation_logger = ConversationLogger(SERVER_URL, session_id)
    track_recorder = TrackRecorder(session_id, ctx.room.name)
    
    try:
        await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
        logger.info("✅ Connected to room with auto-subscribe audio only")
        
        # Set up track recording for new participants
        async def on_participant_connected(participant: rtc.RemoteParticipant):
            """Start recording when participant publishes audio track"""
            logger.info(f"👤 Participant connected: {participant.identity}")
            
            async def on_track_published(publication: rtc.RemoteTrackPublication):
                if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track:
                    logger.info(f"🎵 Audio track published by {participant.identity}")
                    await track_recorder.start_track_recording(
                        publication.track.sid, 
                        participant.identity
                    )
            
            participant.on("track_published", on_track_published)
            
            # Handle already published tracks
            for track_sid, publication in participant.track_publications.items():
                if publication.kind == rtc.TrackKind.KIND_AUDIO and publication.track:
                    logger.info(f"🎵 Existing audio track found for {participant.identity}")
                    await track_recorder.start_track_recording(
                        publication.track.sid, 
                        participant.identity
                    )
        
        ctx.room.on("participant_connected", on_participant_connected)
        
        # Handle already connected participants
        for participant in ctx.room.remote_participants.values():
            await on_participant_connected(participant)
        
        # Create AWS Nova Sonic VoiceAssistant
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
                max_response_output_tokens="inf",
                temperature=0.7,
            )
        )
        
        agent = Agent(session)
        
        # Enhanced conversation tracking
        async def log_user_speech(event: aws.realtime.ConversationItemAdded):
            """Log user speech to database"""
            try:
                if event.item.type == "message" and event.item.role == "user":
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
            """Log assistant speech to database"""
            try:
                if event.item.type == "message" and event.item.role == "assistant":
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
        
        # Set up event handlers
        session.on("conversation_item_added", log_user_speech)
        session.on("conversation_item_added", log_assistant_speech)
        
        # Set up cleanup on shutdown
        async def save_transcript_and_stop_recordings():
            try:
                # Save transcript
                if hasattr(session, 'history'):
                    await track_recorder.save_transcript(session.history.to_dict())
                else:
                    logger.warning("⚠️ No session history available for transcript")
                
                # Stop all track recordings
                stopped = await track_recorder.stop_all_recordings()
                logger.info(f"✅ Stopped {len(stopped)} track recordings")
                    
            except Exception as e:
                logger.warning(f"⚠️ Failed to save transcript/stop recordings: {e}")
        
        ctx.add_shutdown_callback(save_transcript_and_stop_recordings)
        
        logger.info("✅ Track egress recording and transcript system initialized")
        
        # Send agent ready state
        try:
            await asyncio.sleep(1)
            
            agent_info = {
                "type": "session_state", 
                "text": "ready",
                "agent_name": "AWS Nova Sonic Agent",
                "agent_model": "AWS Nova Sonic",
                "agent_voice": "tiffany",
                "recording_method": "track-egress",
                "timestamp": datetime.now().isoformat()
            }
            
            await ctx.room.local_participant.publish_data(
                json.dumps(agent_info).encode(), 
                topic="lk.control"
            )
            logger.info(f"✅ Sent ready state with track egress info: {agent_info}")
        except Exception as e:
            logger.warning("⚠️ Failed to send ready state: %s", e)
        
        # Start the AgentSession
        logger.info("🎯 Starting AgentSession with track egress recording...")
        
        await session.start(room=ctx.room, agent=agent)
        
        logger.info("🎉 AgentSession completed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e)
        raise
    finally:
        # Cleanup
        await conversation_logger.close()
        logger.info("🧹 Agent cleanup completed")

if __name__ == "__main__":
    # Official LiveKit CLI runner
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            agent_name="spashtai-assistant",
        )
    )