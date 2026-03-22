"""
Audio Recording Manager for SpashtAI
Handles real-time audio recording during LiveKit sessions
Supports local storage (dev) and S3 (prod)
"""
import asyncio
import logging
import os
import wave
import io
from datetime import datetime
from typing import Optional, Dict
import pytz
from livekit import rtc

logger = logging.getLogger("audio-recorder")

# Indian Standard Time
IST = pytz.timezone('Asia/Kolkata')

class AudioRecorder:
    """Records and saves full conversation audio"""
    
    def __init__(self, session_id: str, room_name: str):
        self.session_id = session_id
        self.room_name = room_name
        self.environment = os.getenv("ENVIRONMENT", "development")
        
        # Audio buffer for user and assistant
        self.user_audio_frames = []
        self.assistant_audio_frames = []
        
        # Audio parameters (16kHz, 16-bit, mono)
        self.sample_rate = 16000
        self.channels = 1
        self.sample_width = 2  # 16-bit = 2 bytes
        
        # Storage backend
        if self.environment == "production":
            from s3_audio_storage import S3AudioStorage
            self.storage = S3AudioStorage()
            logger.info("🎙️ Audio recorder initialized with S3 storage")
        else:
            from audio_storage import LocalAudioStorage
            self.storage = LocalAudioStorage()
            logger.info("🎙️ Audio recorder initialized with local storage")
        
        # Track recording state
        self.is_recording = False
        self.start_time = None
        self.duration = 0.0
    
    def start_recording(self):
        """Start recording session"""
        self.is_recording = True
        self.start_time = datetime.now(IST)
        logger.info(f"▶️ Started recording session {self.session_id}")
    
    def add_user_audio_frame(self, frame: rtc.AudioFrame):
        """Add user audio frame to buffer"""
        if not self.is_recording:
            return
        
        try:
            # Convert AudioFrame to bytes
            audio_data = frame.data.tobytes()
            self.user_audio_frames.append(audio_data)
        except Exception as e:
            logger.warning(f"⚠️ Failed to capture user audio frame: {e}")
    
    def add_assistant_audio_frame(self, frame: rtc.AudioFrame):
        """Add assistant audio frame to buffer"""
        if not self.is_recording:
            return
        
        try:
            # Convert AudioFrame to bytes
            audio_data = frame.data.tobytes()
            self.assistant_audio_frames.append(audio_data)
        except Exception as e:
            logger.warning(f"⚠️ Failed to capture assistant audio frame: {e}")
    
    def add_assistant_audio_chunk(self, chunk_data: bytes):
        """Add assistant audio chunk (raw bytes from Nova Sonic)"""
        if not self.is_recording:
            return
        
        try:
            # Nova Sonic sends raw audio bytes - append directly
            if isinstance(chunk_data, bytes):
                self.assistant_audio_frames.append(chunk_data)
            else:
                logger.debug(f"⚠️ Unexpected chunk type: {type(chunk_data)}")
        except Exception as e:
            logger.warning(f"⚠️ Failed to capture assistant audio chunk: {e}")
    
    def _create_wav_file(self, audio_frames: list) -> bytes:
        """Create WAV file from audio frames"""
        if not audio_frames:
            return b''
        
        # Combine all frames
        audio_data = b''.join(audio_frames)
        
        # Create WAV file in memory
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, 'wb') as wav_file:
            wav_file.setnchannels(self.channels)
            wav_file.setsampwidth(self.sample_width)
            wav_file.setframerate(self.sample_rate)
            wav_file.writeframes(audio_data)
        
        return wav_buffer.getvalue()
    
    async def stop_and_save(self, user_id: str = "unknown") -> Dict[str, str]:
        """Stop recording and save audio files"""
        if not self.is_recording:
            logger.warning("⚠️ Recording was not active")
            return {}
        
        self.is_recording = False
        end_time = datetime.now(IST)
        self.duration = (end_time - self.start_time).total_seconds()
        
        logger.info(f"⏹️ Stopped recording session {self.session_id} (duration: {self.duration:.2f}s)")
        
        saved_files = {}
        
        try:
            # Save user audio
            if self.user_audio_frames:
                user_wav = self._create_wav_file(self.user_audio_frames)
                user_metadata = await self.storage.upload_audio(
                    audio_data=user_wav,
                    session_id=self.session_id,
                    user_id=user_id,
                    participant_type="user",
                    duration_seconds=self.duration,
                    sample_rate=self.sample_rate,
                    channels=self.channels
                )
                saved_files['user'] = user_metadata.storage_key
                logger.info(f"✅ Saved user audio: {user_metadata.storage_key}")
            
            # Save assistant audio
            if self.assistant_audio_frames:
                assistant_wav = self._create_wav_file(self.assistant_audio_frames)
                assistant_metadata = await self.storage.upload_audio(
                    audio_data=assistant_wav,
                    session_id=self.session_id,
                    user_id=user_id,
                    participant_type="assistant",
                    duration_seconds=self.duration,
                    sample_rate=self.sample_rate,
                    channels=self.channels
                )
                saved_files['assistant'] = assistant_metadata.storage_key
                logger.info(f"✅ Saved assistant audio: {assistant_metadata.storage_key}")
            
            # Save mixed audio (both participants)
            if self.user_audio_frames and self.assistant_audio_frames:
                # Simple mix: interleave or concat (for now, concat)
                mixed_frames = self.user_audio_frames + self.assistant_audio_frames
                mixed_wav = self._create_wav_file(mixed_frames)
                mixed_metadata = await self.storage.upload_audio(
                    audio_data=mixed_wav,
                    session_id=self.session_id,
                    user_id=user_id,
                    participant_type="mixed",
                    duration_seconds=self.duration,
                    sample_rate=self.sample_rate,
                    channels=self.channels
                )
                saved_files['mixed'] = mixed_metadata.storage_key
                logger.info(f"✅ Saved mixed audio: {mixed_metadata.storage_key}")
            
        except Exception as e:
            logger.error(f"❌ Failed to save audio: {e}", exc_info=True)
        
        return saved_files
    
    def get_recording_stats(self) -> Dict:
        """Get current recording statistics"""
        return {
            "session_id": self.session_id,
            "is_recording": self.is_recording,
            "duration_seconds": self.duration,
            "user_frames": len(self.user_audio_frames),
            "assistant_frames": len(self.assistant_audio_frames),
            "sample_rate": self.sample_rate,
            "channels": self.channels
        }
