"""
Abstract Audio Storage Interface for SpashtAI
Supports both local file storage (development) and S3 storage (production)
"""
import os
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Dict, Any, List

logger = logging.getLogger("audio-storage")

@dataclass
class AudioMetadata:
    """Universal metadata for stored audio files"""
    session_id: str
    user_id: str
    participant_type: str  # 'user' or 'assistant'
    duration_seconds: float
    sample_rate: int
    channels: int
    file_size_bytes: int
    upload_timestamp: datetime
    storage_key: str  # file path for local, S3 key for S3
    storage_location: str  # local directory or S3 bucket
    content_type: str = "audio/wav"

class AudioStorageInterface(ABC):
    """Abstract interface for audio storage backends"""
    
    @abstractmethod
    async def upload_audio(
        self,
        audio_data: bytes,
        session_id: str,
        user_id: str,
        participant_type: str,
        duration_seconds: float,
        sample_rate: int = 16000,
        channels: int = 1
    ) -> AudioMetadata:
        pass
    
    @abstractmethod
    async def download_audio(self, storage_key: str) -> bytes:
        pass
    
    @abstractmethod
    async def get_access_url(self, storage_key: str, expiration: int = 3600) -> str:
        pass
    
    @abstractmethod
    async def list_session_audio(self, session_id: str) -> List[Dict[str, Any]]:
        pass
    
    @abstractmethod
    async def delete_audio(self, storage_key: str) -> bool:
        pass


class LocalAudioStorage(AudioStorageInterface):
    """Local file storage for development"""
    
    def __init__(self):
        self.base_path = os.getenv("LOCAL_AUDIO_PATH", "./audio_storage")
        self.server_url = os.getenv("SERVER_URL", "http://localhost:4000")
        
        # Create base directory if it doesn't exist
        os.makedirs(self.base_path, exist_ok=True)
        logger.info(f"✅ Local audio storage initialized: {self.base_path}")
    
    def _generate_file_path(self, session_id: str, participant_type: str, timestamp: datetime) -> str:
        """Generate organized file path for audio file"""
        # Format: audio_storage/YYYY-MM-DD/session_id/participant_type_HHMMSS_uuid.wav
        import uuid
        date_prefix = timestamp.strftime("%Y-%m-%d")
        unique_id = str(uuid.uuid4())[:8]
        timestamp_str = timestamp.strftime("%H%M%S")
        
        session_dir = os.path.join(self.base_path, date_prefix, session_id)
        os.makedirs(session_dir, exist_ok=True)
        
        filename = f"{participant_type}_{timestamp_str}_{unique_id}.wav"
        return os.path.join(session_dir, filename)
    
    async def upload_audio(
        self,
        audio_data: bytes,
        session_id: str,
        user_id: str,
        participant_type: str,
        duration_seconds: float,
        sample_rate: int = 16000,
        channels: int = 1
    ) -> AudioMetadata:
        """Save audio data to local file"""
        try:
            timestamp = datetime.utcnow()
            file_path = self._generate_file_path(session_id, participant_type, timestamp)
            
            # Write audio data to file
            with open(file_path, 'wb') as f:
                f.write(audio_data)
            
            metadata = AudioMetadata(
                session_id=session_id,
                user_id=user_id,
                participant_type=participant_type,
                duration_seconds=duration_seconds,
                sample_rate=sample_rate,
                channels=channels,
                file_size_bytes=len(audio_data),
                upload_timestamp=timestamp,
                storage_key=file_path,
                storage_location=self.base_path
            )
            
            logger.info(f"✅ Audio saved locally: {file_path} ({len(audio_data)} bytes)")
            return metadata
            
        except Exception as e:
            logger.error(f"❌ Failed to save audio locally: {e}")
            raise
    
    async def download_audio(self, storage_key: str) -> bytes:
        """Read audio data from local file"""
        try:
            with open(storage_key, 'rb') as f:
                audio_data = f.read()
            logger.info(f"✅ Audio loaded locally: {storage_key} ({len(audio_data)} bytes)")
            return audio_data
        except Exception as e:
            logger.error(f"❌ Failed to load audio locally: {e}")
            raise
    
    async def get_access_url(self, storage_key: str, expiration: int = 3600) -> str:
        """Generate local file URL for development server"""
        try:
            # Extract path components for server endpoint
            relative_path = os.path.relpath(storage_key, self.base_path)
            path_parts = relative_path.replace('\\', '/').split('/')
            
            if len(path_parts) >= 3:
                date, session_id, filename = path_parts[0], path_parts[1], path_parts[2]
                url = f"{self.server_url}/audio/local/{date}/{session_id}/{filename}"
            else:
                # Fallback for unexpected path structure
                url = f"{self.server_url}/audio/local/{relative_path.replace(os.sep, '/')}"
                
            logger.info(f"✅ Generated local URL: {url}")
            return url
        except Exception as e:
            logger.error(f"❌ Failed to generate local URL: {e}")
            raise
    
    async def list_session_audio(self, session_id: str) -> List[Dict[str, Any]]:
        """List all local audio files for a session"""
        try:
            session_files = []
            
            # Search through date directories
            for date_dir in os.listdir(self.base_path):
                date_path = os.path.join(self.base_path, date_dir)
                if not os.path.isdir(date_path):
                    continue
                
                session_path = os.path.join(date_path, session_id)
                if os.path.exists(session_path) and os.path.isdir(session_path):
                    for filename in os.listdir(session_path):
                        if filename.endswith('.wav'):
                            file_path = os.path.join(session_path, filename)
                            stat = os.stat(file_path)
                            
                            session_files.append({
                                'key': file_path,
                                'size': stat.st_size,
                                'last_modified': datetime.fromtimestamp(stat.st_mtime),
                                'metadata': {
                                    'filename': filename,
                                    'session_id': session_id
                                }
                            })
            
            logger.info(f"✅ Found {len(session_files)} local audio files for session: {session_id}")
            return session_files
            
        except Exception as e:
            logger.error(f"❌ Failed to list local session audio: {e}")
            raise
    
    async def delete_audio(self, storage_key: str) -> bool:
        """Delete local audio file"""
        try:
            if os.path.exists(storage_key):
                os.remove(storage_key)
                logger.info(f"✅ Deleted local audio: {storage_key}")
                return True
            else:
                logger.warning(f"⚠️ Local audio file not found: {storage_key}")
                return False
        except Exception as e:
            logger.error(f"❌ Failed to delete local audio: {e}")
            return False


# Import S3 storage for production
try:
    from s3_audio_storage import S3AudioStorage
    S3_AVAILABLE = True
except ImportError:
    logger.warning("⚠️ S3 storage not available (missing dependencies)")
    S3_AVAILABLE = False
    
    class S3AudioStorage:
        def __init__(self):
            raise ImportError("S3 storage dependencies not installed")


def get_audio_storage() -> AudioStorageInterface:
    """
    Factory function to get appropriate storage backend
    Returns S3 for production, local for development
    """
    environment = os.getenv("ENVIRONMENT", "development").lower()
    force_local = os.getenv("FORCE_LOCAL_STORAGE", "false").lower() == "true"
    
    if environment == "production" and not force_local and S3_AVAILABLE:
        logger.info("🌍 Using S3 storage for production")
        return S3AudioStorage()
    else:
        logger.info("💻 Using local storage for development")
        return LocalAudioStorage()


# Global storage instance
_storage_instance = None

async def get_storage_instance() -> AudioStorageInterface:
    """Get singleton storage instance"""
    global _storage_instance
    if _storage_instance is None:
        _storage_instance = get_audio_storage()
    return _storage_instance