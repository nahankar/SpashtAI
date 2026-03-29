#!/usr/bin/env python3

"""
SpashtAI Voice Agent - AWS Nova Sonic with transcripts + database logging
Combines proven audio pattern with enhanced transcript handling
"""

import asyncio
import atexit
import json
import logging
import os
import signal
import time
import aiohttp
import subprocess
from datetime import datetime
from typing import Optional
import pytz

from dotenv import load_dotenv
from livekit import rtc, api
from livekit.agents import (
    AutoSubscribe,
    JobContext,
    WorkerOptions,
    cli,
)
from livekit.agents import AgentSession, Agent
from livekit.plugins import aws
from exercise_templates import get_exercise_instructions

# Import analytics components (includes basic + advanced metrics)
try:
    from advanced_metrics_collector import AdvancedMetricsCollector
    ADVANCED_ANALYTICS_AVAILABLE = True
    logger_init = logging.getLogger("main")
    logger_init.info("✅ Advanced analytics components available (spaCy, Praat, Gentle + basic metrics)")
except ImportError as e:
    ADVANCED_ANALYTICS_AVAILABLE = False
    logger_init = logging.getLogger("main")
    logger_init.warning(f"⚠️ Advanced analytics not available: {e}")
    logger_init.warning("⚠️ Install with: pip install spacy praat-parselmouth && python -m spacy download en_core_web_lg")

# Start the Signal Extraction API (Metrics Engine v2)
# Guard: only start in the main process (LiveKit dev mode spawns child processes via multiprocessing)
import multiprocessing as _mp
if _mp.current_process().name == "MainProcess":
    try:
        from analytics.signal_api import start_signal_api
        start_signal_api(blocking=False)
        logger_init = logging.getLogger("main")
        logger_init.info("✅ Signal extraction API started (spaCy + textstat)")
    except ImportError as e:
        logger_init = logging.getLogger("main")
        logger_init.warning(f"⚠️ Signal API not available: {e}")
        logger_init.warning("⚠️ Install with: pip install spacy textstat && python -m spacy download en_core_web_md")

load_dotenv()

logger = logging.getLogger("spashtai-agent")
logger.setLevel(logging.INFO)

# Server configuration
SERVER_URL = os.getenv("SERVER_URL", "http://localhost:4000")
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
INTERNAL_AGENT_TOKEN = os.getenv("INTERNAL_AGENT_TOKEN", "dev-internal-agent-token")

# Timezone configuration - Indian Standard Time
IST = pytz.timezone('Asia/Kolkata')

def get_ist_now():
    """Get current datetime in IST"""
    return datetime.now(IST)

def to_ist_isoformat(dt: datetime = None) -> str:
    """Convert datetime to IST ISO format string"""
    if dt is None:
        dt = datetime.now(IST)
    elif dt.tzinfo is None:
        # If naive datetime, assume UTC and convert to IST
        dt = pytz.utc.localize(dt).astimezone(IST)
    else:
        # If aware datetime, convert to IST
        dt = dt.astimezone(IST)
    return dt.isoformat()


async def fetch_session_history(session_id: str, max_messages: int = 12) -> list[dict]:
    """
    Fetch prior conversation messages for a session from server.
    Returns the most recent messages in chronological order.
    """
    url = f"{SERVER_URL}/internal/sessions/{session_id}/conversation"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                timeout=aiohttp.ClientTimeout(total=5.0),
            ) as response:
                if response.status != 200:
                    logger.warning("⚠️ History lookup failed for %s: HTTP %s", session_id, response.status)
                    return []
                payload = await response.json()
                messages = payload.get("messages", [])
                if not isinstance(messages, list):
                    return []
                if max_messages > 0:
                    return messages[-max_messages:]
                return messages
    except Exception as e:
        logger.warning("⚠️ Failed to fetch session history: %s", e)
        return []


async def fetch_coaching_context(session_id: str, focus_area: str) -> dict | None:
    """
    Fetch rich coaching context (skill scores, metrics, example phrases, etc.)
    from the server for personalized Elevate exercises.
    """
    url = f"{SERVER_URL}/internal/coaching-context"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                params={"sessionId": session_id, "focusArea": focus_area},
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                timeout=aiohttp.ClientTimeout(total=5.0),
            ) as response:
                if response.status != 200:
                    logger.warning("⚠️ Coaching context fetch failed: HTTP %s", response.status)
                    return None
                data = await response.json()
                logger.info("📊 Coaching context fetched: %d skill summaries, replay=%s",
                    len(data.get("skillSummaries", {})),
                    "yes" if data.get("replayInsights") else "no")
                return data
    except Exception as e:
        logger.warning("⚠️ Failed to fetch coaching context: %s", e)
        return None


def build_resume_context(history_messages: list[dict]) -> str:
    """Build a compact resume context string from prior messages."""
    if not history_messages:
        return ""

    def clip(text: str, limit: int = 220) -> str:
        text = (text or "").strip().replace("\n", " ")
        if len(text) <= limit:
            return text
        return text[: limit - 3].rstrip() + "..."

    # Normalize and clean messages first.
    normalized = []
    for msg in history_messages:
        role = msg.get("role", "assistant")
        content = (msg.get("content") or "").strip()
        if not content:
            continue
        normalized.append({"role": role, "content": content})

    if not normalized:
        return ""

    user_msgs = [m["content"] for m in normalized if m["role"] == "user"]
    assistant_msgs = [m["content"] for m in normalized if m["role"] == "assistant"]

    # Build compact memory summary.
    summary_lines = [
        f"- Conversation so far has {len(normalized)} messages.",
    ]

    if user_msgs:
        summary_lines.append(f"- User recent focus: {clip(user_msgs[-1], 180)}")
        if len(user_msgs) > 1:
            summary_lines.append(f"- Earlier user context: {clip(user_msgs[-2], 180)}")

    # Capture last assistant question, if any.
    last_assistant_question = ""
    for text in reversed(assistant_msgs):
        if "?" in text:
            last_assistant_question = text
            break
    if last_assistant_question:
        summary_lines.append(
            f"- Last assistant question/prompt: {clip(last_assistant_question, 180)}"
        )

    # Keep only recent dialogue snippets to preserve continuity.
    recent_messages = normalized[-6:]
    recent_lines = []
    for msg in recent_messages:
        speaker = "User" if msg["role"] == "user" else "Assistant"
        recent_lines.append(f"{speaker}: {clip(msg['content'], 180)}")

    return (
        "SESSION MEMORY SUMMARY:\n"
        + "\n".join(summary_lines)
        + "\n\nRECENT DIALOGUE SNIPPETS:\n"
        + "\n".join(recent_lines)
        + "\n\nContinue naturally from this context. Do not restart from introductions unless the user asks."
    )

class ConversationLogger:
    """Minimal conversation logging to server API with IST timestamps"""
    
    def __init__(self, session_id: str):
        self.session_id = session_id
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def log_message(self, role: str, content: str) -> None:
        """Log conversation message to server with IST timestamp"""
        try:
            if not self.session:
                self.session = aiohttp.ClientSession()
            
            payload = {
                "role": role, 
                "content": content,
                "timestamp": to_ist_isoformat()  # Use IST timestamp
            }
            
            async with self.session.post(
                f"{SERVER_URL}/internal/sessions/{self.session_id}/messages",
                headers={"x-internal-agent-token": INTERNAL_AGENT_TOKEN},
                json=payload,
                timeout=aiohttp.ClientTimeout(total=5.0)
            ) as response:
                if response.status == 201:
                    logger.info("✅ Saved %s message to database", role)
                else:
                    logger.warning("⚠️ Failed to save message: HTTP %d", response.status)
        except Exception as e:
            logger.warning("⚠️ Failed to save to database: %s", e)
    
    async def close(self):
        if self.session:
            await self.session.close()

class EgressRecorder:
    """Manages Egress participant recording (no Chrome rendering!)"""
    
    def __init__(self, room_name: str, session_id: str, participant_identity: Optional[str] = None, participant_type: str = "user"):
        self.room_name = room_name
        self.session_id = session_id
        self.participant_identity = participant_identity  # Participant ID (user or agent)
        self.participant_type = participant_type  # "user" or "agent"
        self.egress_id: Optional[str] = None
        self.recording_id: Optional[str] = None  # Alias for cleanup check
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")  # Match livekit.yaml
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
        
    async def start_recording(self):
        """Start room recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
                        # Validate participant identity
            if not self.participant_identity:
                logger.error("❌ Participant identity required for recording")
                return None
            
            # Generate filename with session ID and timestamp
            timestamp = int(time.time())
            # Clean participant label (remove prefixes)
            participant_label = self.participant_identity.replace("user-", "").replace("agent-", "")
            filename = f"{self.participant_type}_{participant_label}_{self.session_id}_{timestamp}.mp4"
            filepath = f"/out/{filename}"  # Egress container path
            
            # Create ParticipantEgressRequest (NO CHROME RENDERING!)
            if not self.use_s3:
                request = lk_api.ParticipantEgressRequest(
                    room_name=self.room_name,
                    identity=self.participant_identity,  # The user's participant ID
                    file_outputs=[
                        lk_api.EncodedFileOutput(
                            filepath=filepath,  # Must include /out/ prefix
                            file_type=lk_api.EncodedFileType.MP4
                        )
                    ]
                )
                self.file_path = filepath
            
            # Create Egress service client and start recording
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                logger.info(f"🎙️ Starting Participant Egress for {self.participant_type}: {self.participant_identity}")
                egress_info = await egress_service.start_participant_egress(request)
                
                self.egress_id = egress_info.egress_id
                self.recording_id = self.egress_id  # Set alias for cleanup check
                logger.info(f"✅ Started {self.participant_type} Egress recording: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                return self.egress_id
            
        except Exception as e:
            logger.error(f"❌ Failed to start Egress recording: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            # Build stop request
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped recording: {self.egress_id}")
                
                # Return metadata
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Recording metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to stop Egress recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save recording metadata to database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save recording metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save recording metadata: {e}")


class TrackEgressRecorder:
    """Manages Egress track recording - records specific audio track by ID"""
    
    def __init__(self, room_name: str, session_id: str, track_id: Optional[str] = None, participant_type: str = "agent"):
        self.room_name = room_name
        self.session_id = session_id
        self.track_id = track_id  # Audio track ID (e.g., TR_AMxVEQKjm47qSk)
        self.participant_type = participant_type
        self.egress_id: Optional[str] = None
        self.recording_id: Optional[str] = None
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
    
    async def start_recording(self):
        """Start track recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            if not self.track_id:
                logger.error("❌ Track ID required for track recording")
                return None
            
            # Generate filename
            timestamp = int(time.time())
            track_label = self.track_id.replace("TR_", "")[:8]  # Use first 8 chars of track ID
            filename = f"{self.participant_type}_track_{track_label}_{self.session_id}_{timestamp}.mp4"
            filepath = f"/out/{filename}"
            
            # Create TrackEgressRequest - records specific audio track
            if not self.use_s3:
                request = lk_api.TrackEgressRequest(
                    room_name=self.room_name,
                    track_id=self.track_id,  # Specific track to record
                    file=lk_api.DirectFileOutput(
                        filepath=filepath,
                        disable_manifest=True
                    )
                )
                self.file_path = filepath
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                logger.info(f"🎙️ Starting Track Egress for {self.participant_type}: {self.track_id}")
                egress_info = await egress_service.start_track_egress(request)
                
                self.egress_id = egress_info.egress_id
                self.recording_id = self.egress_id
                logger.info(f"✅ Started {self.participant_type} Track recording: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                return self.egress_id
                
        except Exception as e:
            logger.error(f"❌ Failed to start Track Egress recording: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active track recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped track recording: {self.egress_id}")
                
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Track recording metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
                
        except Exception as e:
            logger.error(f"❌ Failed to stop track recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save recording metadata to server database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} track metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved track recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save track metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save track metadata: {e}")


class RoomCompositeEgressRecorder:
    """Manages Room Composite Egress recording - records entire room audio/video"""
    
    def __init__(self, room_name: str, session_id: str, participant_type: str = "room_composite"):
        self.room_name = room_name
        self.session_id = session_id
        self.participant_type = participant_type
        self.egress_id: Optional[str] = None
        self.file_path: Optional[str] = None
        self.livekit_url = os.getenv("LIVEKIT_URL", "http://localhost:7880")
        self.api_key = os.getenv("LIVEKIT_API_KEY", "devkey")
        self.api_secret = os.getenv("LIVEKIT_API_SECRET", "devsecret")
        self.use_s3 = os.getenv("ENVIRONMENT", "development") == "production"
    
    async def start_recording(self):
        """Start room composite recording via Egress SDK"""
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            # Generate timestamp for unique file naming
            timestamp = int(time.time())
            
            # Build file path - using audio-only for now (can be changed to video)
            if self.use_s3:
                self.file_path = f"s3://your-bucket/room_{self.room_name}_session_{self.session_id}_{timestamp}.mp4"
            else:
                # Local file output
                self.file_path = f"/out/room_composite_session_{self.session_id}_{timestamp}.mp4"
            
            logger.info(f"🎙️ Starting Room Composite Egress for room: {self.room_name}")
            
            # Create RoomComposite request - audio only for voice calls
            room_composite = lk_api.RoomCompositeEgressRequest(
                room_name=self.room_name,
                audio_only=True,  # Set to False if you want video composite
                file_outputs=[
                    lk_api.EncodedFileOutput(
                        file_type=lk_api.EncodedFileType.MP4,
                        filepath=self.file_path,
                    )
                ],
            )
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.start_room_composite_egress(room_composite)
                self.egress_id = egress_info.egress_id
                
                logger.info(f"✅ Started room composite Egress: {self.egress_id}")
                logger.info(f"📁 Recording to: {self.file_path}")
                
                return self.egress_id
                
        except Exception as e:
            logger.error(f"❌ Failed to start room composite Egress: {e}", exc_info=True)
            return None
    
    async def stop_recording(self) -> dict:
        """Stop room composite recording and return metadata"""
        if not self.egress_id:
            logger.warning("⚠️ No active room composite recording to stop")
            return {}
        
        try:
            from livekit import api as lk_api
            from livekit.api.egress_service import EgressService
            
            stop_request = lk_api.StopEgressRequest(egress_id=self.egress_id)
            
            async with aiohttp.ClientSession() as session:
                egress_service = EgressService(
                    session=session,
                    url=self.livekit_url,
                    api_key=self.api_key,
                    api_secret=self.api_secret
                )
                
                egress_info = await egress_service.stop_egress(stop_request)
                logger.info(f"⏹️ Stopped room composite recording: {self.egress_id}")
                
                metadata = {
                    "egress_id": self.egress_id,
                    "file_path": self.file_path,
                    "duration": getattr(egress_info, 'duration', 0),
                    "file_size": getattr(egress_info, 'size', 0),
                    "status": getattr(egress_info, 'status', 'EGRESS_COMPLETE'),
                }
                
                logger.info(f"📊 Room composite metadata: {metadata}")
                
                # Clean up Egress JSON metadata file (we store in database instead)
                try:
                    json_file = os.path.join(
                        os.path.dirname(__file__), 
                        "audio_storage", 
                        f"{self.egress_id}.json"
                    )
                    if os.path.exists(json_file):
                        os.remove(json_file)
                        logger.info(f"🗑️ Removed JSON metadata file: {self.egress_id}.json")
                except Exception as json_err:
                    logger.warning(f"⚠️ Could not remove JSON file: {json_err}")
                
                return metadata
                
        except Exception as e:
            logger.error(f"❌ Failed to stop room composite recording: {e}", exc_info=True)
            return {}
    
    async def save_metadata_to_db(self, metadata: dict):
        """Save room composite metadata to server database"""
        try:
            async with aiohttp.ClientSession() as session:
                # Convert status to string (LiveKit sends integer status codes)
                status_value = metadata.get("status", "completed")
                status_str = str(status_value) if isinstance(status_value, int) else status_value
                
                payload = {
                    "egress_id": metadata.get("egress_id"),
                    "file_path": metadata.get("file_path"),
                    "duration": metadata.get("duration", 0),
                    "file_size": metadata.get("file_size", 0),
                    "status": status_str,
                    "recording_type": self.participant_type,  # "room_composite"
                }
                
                url = f"{SERVER_URL}/sessions/{self.session_id}/recording"
                logger.info(f"💾 Saving {self.participant_type} metadata to: {url}")
                logger.info(f"💾 Payload: {payload}")
                
                async with session.post(
                    url,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved room composite metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save room composite metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save room composite metadata: {e}")


class AudioMerger:
    """Merges user and agent audio files using ffmpeg"""
    
    def __init__(self, session_id: str, audio_storage_path: str = None):
        self.session_id = session_id
        # Get the audio storage path (resolve /out to actual directory)
        if audio_storage_path is None:
            self.audio_storage_path = os.path.join(os.path.dirname(__file__), "audio_storage")
        else:
            self.audio_storage_path = audio_storage_path
        
        # Ensure directory exists
        os.makedirs(self.audio_storage_path, exist_ok=True)
    
    def get_actual_file_path(self, egress_path: str) -> str:
        """Convert Egress container path (/out/...) to actual file path"""
        if egress_path.startswith("/out/"):
            filename = egress_path.replace("/out/", "")
            return os.path.join(self.audio_storage_path, filename)
        return egress_path
    
    async def merge_audio_files(self, user_file_path: str, agent_file_path: str) -> Optional[str]:
        """
        Merge user and agent audio files into a single seamless file
        Uses ffmpeg to mix both tracks together naturally (not side-by-side)
        This preserves the natural timing of the conversation without overlap
        """
        try:
            # Convert container paths to actual file paths
            user_file = self.get_actual_file_path(user_file_path)
            agent_file = self.get_actual_file_path(agent_file_path)
            
            # Check if files exist
            if not os.path.exists(user_file):
                logger.error(f"❌ User audio file not found: {user_file}")
                return None
            
            if not os.path.exists(agent_file):
                logger.error(f"❌ Agent audio file not found: {agent_file}")
                return None
            
            logger.info(f"🔊 Merging audio files:")
            logger.info(f"  User:  {user_file}")
            logger.info(f"  Agent: {agent_file}")
            
            # Generate output filename
            timestamp = int(time.time())
            output_filename = f"merged_{self.session_id}_{timestamp}.mp4"
            output_path = os.path.join(self.audio_storage_path, output_filename)
            
            # Use ffmpeg to merge audio files
            # Strategy: Mix both audio streams into a single mono/stereo output
            # This creates a natural conversation flow where both voices are heard together
            # The amix filter will blend the audio naturally without side-by-side stereo
            ffmpeg_cmd = [
                'ffmpeg',
                '-i', user_file,      # Input 1: user audio
                '-i', agent_file,     # Input 2: agent audio
                '-filter_complex',    # Complex audio filter
                '[0:a][1:a]amix=inputs=2:duration=longest:dropout_transition=2[aout]',  # Mix both inputs naturally
                '-map', '[aout]',     # Map the mixed audio
                '-c:a', 'aac',        # Audio codec
                '-b:a', '192k',       # Audio bitrate
                '-y',                 # Overwrite output file if exists
                output_path
            ]
            
            logger.info(f"🎬 Running ffmpeg to merge audio with amix filter...")
            
            # Run ffmpeg command asynchronously
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            
            stdout, stderr = await process.communicate()
            
            if process.returncode == 0:
                # Get file size
                file_size = os.path.getsize(output_path)
                file_size_mb = file_size / (1024 * 1024)
                
                logger.info(f"✅ Audio files merged successfully!")
                logger.info(f"📁 Output: {output_path}")
                logger.info(f"📊 Size: {file_size_mb:.2f}MB")
                
                return output_path
            else:
                error_msg = stderr.decode() if stderr else "Unknown error"
                logger.error(f"❌ ffmpeg failed with return code {process.returncode}")
                logger.error(f"Error: {error_msg}")
                return None
                
        except FileNotFoundError:
            logger.error("❌ ffmpeg not found. Please install ffmpeg: brew install ffmpeg")
            return None
        except Exception as e:
            logger.error(f"❌ Failed to merge audio files: {e}", exc_info=True)
            return None
    
    async def save_merged_metadata_to_db(self, merged_file_path: str):
        """Save merged recording metadata to database"""
        try:
            file_size = os.path.getsize(merged_file_path)
            
            async with aiohttp.ClientSession() as session:
                payload = {
                    "file_path": merged_file_path,
                    "file_size": file_size,
                    "status": "merged",
                    "type": "merged_audio"
                }
                
                async with session.post(
                    f"{SERVER_URL}/sessions/{self.session_id}/recording",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=5.0)
                ) as response:
                    if response.status in [200, 201]:
                        logger.info("✅ Saved merged recording metadata to database")
                    else:
                        logger.warning(f"⚠️ Failed to save merged metadata: HTTP {response.status}")
        except Exception as e:
            logger.error(f"❌ Failed to save merged metadata: {e}")


def prewarm(proc):
    """Prewarm forked process (receives JobProcess, not JobContext)."""
    logger.info("🔥 Prewarming SpashtAI agent worker")
    logger.info("🤖 Using AUTOMATIC dispatch - agent will join all new rooms")

async def entrypoint(ctx: JobContext):
    """
    Enhanced entrypoint with transcript support
    Reference: https://docs.livekit.io/agents/integrations/realtime/nova-sonic/
    """
    
    # CRITICAL: Connect with AUDIO_ONLY subscription for voice
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)

    # Wait for a real user to join before initializing the Bedrock session.
    # Without this the agent starts streaming to Nova Sonic in an empty room,
    # causing "Timed out waiting for input events" errors from AWS.
    participant = await ctx.wait_for_participant()
    
    region = os.getenv("BEDROCK_REGION", os.getenv("AWS_REGION", "us-east-1"))
    
    logger.info(f"🚀 Agent starting in room: {ctx.room.name}")
    logger.info(f"🌍 Region: {region}")
    logger.info(f"🏠 Participants: {len(ctx.room.remote_participants)}")
    
    # Extract or generate session ID
    # Priority:
    # 1) Room metadata (set during room creation by server)
    # 2) Dispatch/job metadata (backup)
    # 3) Fallback generated ID
    session_id = None

    # 1) Try room metadata first (most reliable for resume flows)
    room_meta: dict = {}
    try:
        if hasattr(ctx, 'room') and getattr(ctx.room, 'metadata', None):
            room_meta = json.loads(ctx.room.metadata)
            session_id = room_meta.get('sessionId')
            if session_id:
                logger.info(f"📦 Session ID loaded from room metadata: {session_id}")
    except Exception as e:
        logger.warning(f"⚠️ Failed to parse room metadata: {e}")

    # 2) Try job metadata as backup
    if not session_id:
        try:
            if hasattr(ctx, 'job') and hasattr(ctx.job, 'metadata') and ctx.job.metadata:
                job_metadata = json.loads(ctx.job.metadata)
                session_id = job_metadata.get('sessionId')
                if session_id:
                    logger.info(f"📦 Session ID loaded from job metadata: {session_id}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to parse job metadata: {e}")
    
    persistence_enabled = True
    if not session_id:
        # Safety fallback: never create synthetic persisted session IDs.
        # If metadata is missing, run voice flow but skip DB persistence to avoid duplicate sessions.
        persistence_enabled = False
        session_id = f"ephemeral_{int(datetime.now().timestamp() * 1000)}_{ctx.room.name}"
        logger.error(
            "❌ Missing sessionId in room/job metadata for room %s. "
            "Running in ephemeral mode (no DB persistence) to avoid duplicate sessions.",
            ctx.room.name,
        )
    
    logger.info(f"📋 Session ID: {session_id}")
    history_messages = await fetch_session_history(session_id) if persistence_enabled else []
    resume_context = build_resume_context(history_messages)
    if history_messages:
        logger.info("📚 Loaded %d prior messages for resumed context", len(history_messages))
    else:
        logger.info("📚 No prior messages found for session context")
    conversation_logger = ConversationLogger(session_id) if persistence_enabled else None
    if conversation_logger:
        logger.info("💬 Conversation logger initialized")
    else:
        logger.warning("💬 Conversation logging disabled (ephemeral mode)")
    
    # Initialize advanced metrics collector (includes basic metrics via MetricsCollector)
    advanced_metrics = None
    if ADVANCED_ANALYTICS_AVAILABLE:
        try:
            advanced_metrics = AdvancedMetricsCollector(session_id)
            advanced_metrics.start_session()
            logger.info("🧠 Advanced analytics initialized (spaCy + Praat + Gentle)")
            logger.info("📊 Basic metrics tracking included (WPM, turns, response times)")
        except Exception as e:
            logger.warning(f"⚠️ Failed to initialize advanced analytics: {e}")
            advanced_metrics = None
    
    # Note: Audio is captured via Egress recorders (user/agent/room composite)
    # We use the recorded MP4 files for Gentle/Praat analysis at session end
    # No need for real-time frame capture
    
    # `participant` comes from ctx.wait_for_participant() above
    user_participant = participant
    logger.info(f"👤 User participant joined: {user_participant.identity}")
    
    # Initialize THREE Egress recorders running in parallel:
    # 1. ParticipantEgress for user audio (MP4)
    # 2. TrackEgress for agent audio (OGG)
    # 3. RoomCompositeEgress for combined room recording (MP4)
    user_identity = user_participant.identity if user_participant else None
    user_recorder = EgressRecorder(ctx.room.name, session_id, user_identity, participant_type="user")
    
    # Agent recorder - will use TrackEgress to record specific audio track
    agent_recorder = TrackEgressRecorder(ctx.room.name, session_id, None, participant_type="agent")
    
    # Room composite recorder - records entire room (all participants combined)
    room_recorder = RoomCompositeEgressRecorder(ctx.room.name, session_id, participant_type="room_composite")
    
    logger.info("⏳ Triple recording will start after session initialization (user + agent + room composite)")
    
    try:
        # Set agent metadata for frontend
        try:
            await ctx.room.local_participant.set_name("SpashtAI Assistant")
            await ctx.room.local_participant.set_metadata(
                '{"role": "agent", "type": "voice_assistant", "model": "AWS Nova Sonic"}'
            )
            logger.info("✅ Agent metadata set")
        except Exception as e:
            logger.warning("⚠️ Failed to set metadata: %s", e)
        
        # Create AWS Nova Sonic RealtimeModel (proven pattern)
        realtime_model = aws.realtime.RealtimeModel(
            region=region,
            voice="tiffany",
            temperature=0.7,
            top_p=0.9,
            max_tokens=1024,
        )
        logger.info("✅ AWS Nova Sonic model created")
        
        # Track actual AWS usage metrics for billing
        # Note: Token metrics will be estimated from conversation text since
        # Nova Sonic RealtimeModel emits metrics internally but doesn't expose a public event API
        usage_metrics = {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "speech_input_tokens": 0,
            "speech_output_tokens": 0,
            "text_input_tokens": 0,
            "text_output_tokens": 0,
        }
        
        # Build personalized agent instructions from room metadata
        user_name = room_meta.get('userName', '').strip() or None
        focus_area = room_meta.get('focusArea', '').strip() or None
        focus_context = room_meta.get('focusContext', '').strip() or None
        session_name = room_meta.get('sessionName', '').strip() or None

        logger.info(f"👤 User name: {user_name or '(unknown)'}, focus: {focus_area or 'general'}, context: {focus_context or '(none)'}")

        base_instructions = (
            "You are a voice AI coach for SpashtAI, a platform that helps people become better communicators. "
            "Your interface with users will be voice. Use short and concise responses, "
            "and avoid unpronounceable punctuation. Be warm, encouraging, and professional."
        )

        # Personalization: use the user's name naturally
        if user_name:
            base_instructions += (
                f"\n\nThe user's name is {user_name}. "
                f"Greet them by name at the start (e.g. 'Hello {user_name}, welcome to SpashtAI!'). "
                "Use their name naturally once in a while during the conversation — "
                "like a real coach would — but don't overdo it. "
                "For example, use it when giving praise, asking a reflective question, "
                "or wrapping up a topic."
            )

        # Fetch rich coaching context from server API
        coaching_context = None
        if focus_area and session_id:
            coaching_context = await fetch_coaching_context(session_id, focus_area)

        # Session scope: adapt based on how the user arrived
        exercise_instructions = ""
        if focus_area:
            exercise_instructions = get_exercise_instructions(focus_area, focus_context, coaching_context)

        if exercise_instructions:
            base_instructions += f"\n\n{exercise_instructions}"
        elif focus_context:
            base_instructions += (
                f"\n\nThis session was started from a Replay analysis recommendation. "
                f"The specific area to work on is: \"{focus_context}\". "
                "Focus the session on this topic. Your greeting should acknowledge "
                "what they're here to practice (e.g. 'Let's work on your pacing today' "
                "rather than a generic welcome). Ask targeted questions and provide "
                "feedback specific to this skill area."
            )
        elif focus_area:
            base_instructions += (
                f"\n\nThe user chose \"{focus_area}\" as their focus area. "
                "Tailor your coaching, questions, and feedback to this area. "
                "Mention it in your greeting so they know you're aligned."
            )
        else:
            base_instructions += (
                "\n\nThis is a general practice session with no specific focus area. "
                "Ask the user what they'd like to work on — it could be interview prep, "
                "pitch practice, presentation skills, or anything communication-related. "
                "Be open and let them guide the direction."
            )

        combined_instructions = (
            f"{base_instructions}\n\n{resume_context}"
            if resume_context
            else base_instructions
        )

        agent = Agent(instructions=combined_instructions)
        logger.info("✅ Agent created")
        
        # Create AgentSession with transcript support enabled
        session = AgentSession(
            llm=realtime_model,
            use_tts_aligned_transcript=True  # Enable transcript events
        )
        logger.info("✅ AgentSession created with transcript support")
        
        # Register event handlers for transcripts
        @session.on("conversation_item_added")
        def on_conversation_item_added(item):
            """Handle conversation items from Nova Sonic"""
            try:
                logger.info(f"🎯 Conversation item: {type(item).__name__}")
                
                # Extract role and content
                role = "unknown"
                content = ""
                
                # Handle nested item structure
                if hasattr(item, 'item'):
                    msg = item.item
                    role = getattr(msg, 'role', 'unknown')
                    content_attr = getattr(msg, 'content', [])
                elif hasattr(item, 'role'):
                    role = getattr(item, 'role', 'unknown')
                    content_attr = getattr(item, 'content', [])
                else:
                    logger.debug(f"⏭️ Unknown item structure: {item}")
                    return
                
                # Extract text from content (Nova Sonic only sends text, not audio frames)
                if isinstance(content_attr, list):
                    content = ' '.join(str(p).strip() for p in content_attr if str(p).strip())
                elif isinstance(content_attr, str):
                    content = content_attr.strip()
                else:
                    content = str(content_attr).strip()
                
                # Skip empty/invalid content
                if not content or len(content) < 3:
                    logger.debug(f"⏭️ Skipping empty content")
                    return
                
                logger.info(f"📝 {role}: {content[:100]}...")
                
                # Publish to frontend
                message_data = {
                    "type": role,
                    "text": content,
                    "final": True,
                    "id": getattr(item, 'id', f"{role}_{int(datetime.now().timestamp() * 1000)}"),
                    "timestamp": int(datetime.now().timestamp() * 1000)
                }
                
                asyncio.create_task(ctx.room.local_participant.publish_data(
                    json.dumps(message_data).encode(),
                    topic="lk.conversation"
                ))
                
                # Log to database
                if conversation_logger:
                    asyncio.create_task(conversation_logger.log_message(role, content))
                
                # Feed to advanced metrics collector (which includes basic metrics)
                if advanced_metrics:
                    try:
                        # This automatically updates both basic metrics and advanced analytics
                        advanced_metrics.add_conversation_turn(role, content)
                    except Exception as analytics_error:
                        logger.debug(f"⚠️ Analytics tracking error: {analytics_error}")
                
            except Exception as e:
                logger.warning("⚠️ Error in conversation_item_added: %s", e)
        
        logger.info("✅ Event handlers registered")
        
        # Send ready status to frontend
        await asyncio.sleep(0.5)  # Brief delay for connection stability
        await ctx.room.local_participant.publish_data(
            json.dumps({
                "type": "session_state",
                "text": "ready",
                "agent_model": "AWS Nova Sonic",
                "timestamp": datetime.now().isoformat()
            }).encode(),
            topic="lk.control"
        )
        logger.info("✅ Sent ready status")
        logger.info("�️ Room recording via Egress will capture all audio automatically")
        
        session_closed = asyncio.Event()
        
        @session.on("close")
        def on_session_close(event):
            logger.info(f"🔚 Session close event received, error: {event.error if hasattr(event, 'error') else None}")
            session_closed.set()
        
        # Start session (proven pattern - this handles everything)
        logger.info("🎯 Starting AgentSession...")
        session_task = asyncio.create_task(session.start(room=ctx.room, agent=agent))
        
        # Wait for agent to publish audio tracks before starting recording
        logger.info("⏳ Waiting for agent audio tracks to be published...")
        agent_track_id = None
        
        # Wait up to 10 seconds for agent tracks
        for i in range(20):  # 20 attempts * 0.5s = 10 seconds max
            await asyncio.sleep(0.5)
            local_participant = ctx.room.local_participant
            if local_participant and local_participant.track_publications:
                for track_pub in local_participant.track_publications.values():
                    if track_pub.kind == rtc.TrackKind.KIND_AUDIO and track_pub.track:
                        agent_track_id = track_pub.sid
                        logger.info(f"✅ Agent audio track found: {agent_track_id}")
                        break
            if agent_track_id:
                break
        
        if not agent_track_id:
            logger.warning("⚠️ Agent audio tracks not detected after 10s, will only record user audio")
        
        try:
            # Update user participant if needed
            if not user_recorder.participant_identity and ctx.room.remote_participants:
                user_participant = list(ctx.room.remote_participants.values())[0]
                user_recorder.participant_identity = user_participant.identity
                logger.info(f"👤 Updated user participant: {user_participant.identity}")
            
            # Start all three recordings in parallel
            # 1. User recording (ParticipantEgress)
            user_recording_id = await user_recorder.start_recording()
            if user_recording_id:
                logger.info(f"🎬 User audio recording started: {user_recording_id}")
            
            # 2. Agent recording if track ID found (TrackEgress)
            agent_recording_id = None
            if agent_track_id:
                agent_recorder.track_id = agent_track_id
                logger.info(f"🎙️ Starting agent track recording for: {agent_track_id}")
                agent_recording_id = await agent_recorder.start_recording()
                if agent_recording_id:
                    logger.info(f"🎬 Agent audio recording started: {agent_recording_id}")
            else:
                logger.warning("⚠️ Skipping agent recording - no audio tracks published")
            
            # 3. Room composite recording (combined audio from all participants)
            room_recording_id = await room_recorder.start_recording()
            if room_recording_id:
                logger.info(f"🎬 Room composite recording started: {room_recording_id}")
                
            if not user_recording_id and not agent_recording_id and not room_recording_id:
                logger.warning("⚠️ Failed to start any recordings - continuing without recording")
        except Exception as e:
            logger.warning(f"⚠️ Recording start failed: {e}")
        
        # Wait for the session to ACTUALLY close (not just start)
        await session_closed.wait()
        logger.info("🎉 Session completed - waiting for task cleanup...")
        
        # Give the task a moment to cleanup
        try:
            await asyncio.wait_for(session_task, timeout=2.0)
        except asyncio.TimeoutError:
            logger.warning("⚠️ Session task timeout during cleanup")
        
        logger.info("✅ Session fully closed")
        
    except Exception as e:
        logger.error("❌ Agent error: %s", e, exc_info=True)
        raise
    finally:
        # Stop ALL THREE recordings and save metadata
        user_file_path = None
        agent_file_path = None
        room_file_path = None
        
        try:
            # Stop user recording
            user_metadata = await user_recorder.stop_recording()
            if user_metadata:
                if persistence_enabled:
                    await user_recorder.save_metadata_to_db(user_metadata)
                user_file_path = user_metadata.get("file_path")
                logger.info("✅ User recording stopped and metadata saved")
            # If stop failed, try to use the file path that was set during start
            elif user_recorder.file_path:
                user_file_path = user_recorder.file_path
                logger.info("ℹ️ User recording already completed, using file path from start")
            
            # Stop agent recording (only if it was started)
            if agent_recorder.recording_id:
                agent_metadata = await agent_recorder.stop_recording()
                if agent_metadata:
                    if persistence_enabled:
                        await agent_recorder.save_metadata_to_db(agent_metadata)
                    agent_file_path = agent_metadata.get("file_path")
                    logger.info("✅ Agent recording stopped and metadata saved")
                # If stop failed, try to use the file path that was set during start
                elif agent_recorder.file_path:
                    agent_file_path = agent_recorder.file_path
                    logger.info("ℹ️ Agent recording already completed, using file path from start")
            else:
                logger.info("ℹ️ Agent recording was not started, nothing to stop")
            
            # Stop room composite recording
            if room_recorder.egress_id:
                room_metadata = await room_recorder.stop_recording()
                if room_metadata:
                    if persistence_enabled:
                        await room_recorder.save_metadata_to_db(room_metadata)
                    room_file_path = room_metadata.get("file_path")
                    logger.info("✅ Room composite recording stopped and metadata saved")
                # If stop failed, try to use the file path that was set during start
                elif room_recorder.file_path:
                    room_file_path = room_recorder.file_path
                    logger.info("ℹ️ Room composite recording already completed, using file path from start")
            else:
                logger.info("ℹ️ Room composite recording was not started, nothing to stop")
                
        except Exception as e:
            logger.error(f"❌ Error stopping recordings: {e}")
            # Even if stop fails, try to use the paths set during start
            if not user_file_path and user_recorder.file_path:
                user_file_path = user_recorder.file_path
            if not agent_file_path and agent_recorder.file_path:
                agent_file_path = agent_recorder.file_path
            if not room_file_path and room_recorder.file_path:
                room_file_path = room_recorder.file_path
        
        # Note: We now have 3 separate recordings:
        # 1. User audio (ParticipantEgress) - isolated user voice
        # 2. Agent audio (TrackEgress) - isolated agent voice
        # 3. Room composite (RoomCompositeEgress) - combined audio of all participants
        # The composite is useful for playback, while separate files are better for analysis
        
        logger.info(f"📁 Audio files saved separately:")
        if user_file_path:
            logger.info(f"  User: {user_file_path}")
        if agent_file_path:
            logger.info(f"  Agent: {agent_file_path}")
        if room_file_path:
            logger.info(f"  Room Composite: {room_file_path}")
        
        # Process advanced analytics at session end
        if advanced_metrics and (user_file_path or advanced_metrics.user_transcript):
            try:
                logger.info("🔬 Starting advanced analytics processing...")
                
                # Call finalize_session() which automatically:
                # 1. Finalizes basic metrics (WPM, turns, filler words, response times)
                # 2. Analyzes audio delivery (if audio file exists)
                # 3. Analyzes content with spaCy
                # 4. Generates performance insights
                logger.info("🎯 Finalizing comprehensive session analysis...")
                
                # Convert Egress container path to local file path
                local_user_audio_path = None
                if user_file_path:
                    # Convert /out/ path to actual audio_storage path
                    audio_manager = AudioFileManager(session_id)
                    local_user_audio_path = audio_manager.to_local_path(user_file_path)
                    logger.info(f"📁 Using user audio file for delivery analysis: {local_user_audio_path}")
                
                await advanced_metrics.finalize_session(user_audio_file_path=local_user_audio_path)
                logger.info("✅ Advanced analytics processing complete!")
                
                # Log summary of results
                if advanced_metrics.session_metrics.basic_metrics:
                    user_wpm = advanced_metrics.session_metrics.basic_metrics.user_metrics.words_per_minute
                    total_turns = advanced_metrics.session_metrics.basic_metrics.total_turns
                    total_tokens = advanced_metrics.session_metrics.basic_metrics.total_llm_tokens
                    logger.info(f"📊 Basic metrics: {total_turns} turns, {user_wpm:.1f} WPM, {total_tokens} tokens")
                
                if advanced_metrics.session_metrics.performance_insights:
                    overall_score = advanced_metrics.session_metrics.performance_insights.scores.overall
                    logger.info(f"🎯 Overall score: {overall_score:.1f}/10")
                
                # Save advanced metrics to database
                logger.info("💾 Saving advanced metrics to database...")
                if persistence_enabled:
                    await advanced_metrics.save_to_database()
                    logger.info("✅ Metrics saved to database!")
                else:
                    logger.warning("⚠️ Skipping metrics DB save (ephemeral mode)")
                
                # 6. Mark session as ended in the database
                if persistence_enabled:
                    try:
                        import aiohttp
                        async with aiohttp.ClientSession() as session:
                            end_url = f"{SERVER_URL}/sessions/{session_id}/end"
                            end_payload = {
                                "endedAt": advanced_metrics.session_metrics.end_time.isoformat(),
                                "durationSec": int((advanced_metrics.session_metrics.end_time - advanced_metrics.session_metrics.start_time).total_seconds()) if advanced_metrics.session_metrics.start_time else 0
                            }
                            async with session.post(end_url, json=end_payload, timeout=aiohttp.ClientTimeout(total=5.0)) as response:
                                if response.status == 200:
                                    logger.info(f"✅ Session marked as ended in database")
                                else:
                                    logger.warning(f"⚠️ Failed to mark session as ended: {response.status}")
                    except Exception as end_error:
                        logger.error(f"❌ Error marking session as ended: {end_error}")
                else:
                    logger.warning("⚠️ Skipping session end DB mark (ephemeral mode)")
                
            except Exception as analytics_error:
                logger.error(f"❌ Error processing advanced analytics: {analytics_error}", exc_info=True)
                advanced_metrics.session_metrics.processing_errors.append(str(analytics_error))
        
        if conversation_logger:
            await conversation_logger.close()
        logger.info("🧹 Cleanup completed")

def _cleanup_children():
    """Kill all child processes in our process group on exit.
    Prevents orphaned multiprocessing workers from registering as
    stale LiveKit agent workers after the parent is killed."""
    try:
        os.killpg(os.getpgid(os.getpid()), signal.SIGTERM)
    except (ProcessLookupError, PermissionError, OSError):
        pass

if __name__ == "__main__":
    # Ensure we are the process group leader so killpg reaches all children
    try:
        os.setpgrp()
    except OSError:
        pass
    atexit.register(_cleanup_children)

    # Also handle SIGTERM/SIGINT to clean up children before exiting
    def _signal_handler(sig, frame):
        logger.info("🛑 Received signal %s — cleaning up child processes", sig)
        _cleanup_children()
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, _signal_handler)
    signal.signal(signal.SIGINT, _signal_handler)

    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            num_idle_processes=1,
        )
    )