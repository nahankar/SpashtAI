"""
S3 Audio Storage for SpashtAI
Handles secure upload, download, and management of conversation audio files
"""
import asyncio
import logging
import os
import io
import tempfile
import uuid
from datetime import datetime, timedelta
from dataclasses import dataclass
from typing import Optional, Dict, Any, List
import boto3
from botocore.exceptions import ClientError, NoCredentialsError
import aiofiles

logger = logging.getLogger("s3-audio-storage")

@dataclass
class AudioMetadata:
    """Metadata for stored audio files"""
    session_id: str
    user_id: str
    participant_type: str  # 'user' or 'assistant'
    duration_seconds: float
    sample_rate: int
    channels: int
    file_size_bytes: int
    upload_timestamp: datetime
    s3_key: str
    s3_bucket: str
    content_type: str = "audio/wav"

class S3AudioStorage:
    """
    Manages audio storage in S3 with proper organization and security
    """
    
    def __init__(self):
        self.bucket_name = os.getenv("AUDIO_S3_BUCKET", "spashtai-audio-storage")
        self.region = os.getenv("AWS_REGION", "us-east-1")
        
        # Initialize S3 client
        try:
            self.s3_client = boto3.client(
                's3',
                region_name=self.region,
                aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
                aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
            )
            # Test connection
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            logger.info(f"✅ Connected to S3 bucket: {self.bucket_name}")
        except NoCredentialsError:
            logger.error("❌ AWS credentials not found")
            raise
        except ClientError as e:
            if e.response['Error']['Code'] == '404':
                logger.warning(f"⚠️ S3 bucket {self.bucket_name} not found, will create it")
                self._create_bucket()
            else:
                logger.error(f"❌ S3 connection error: {e}")
                raise
    
    def _create_bucket(self):
        """Create S3 bucket if it doesn't exist"""
        try:
            if self.region == 'us-east-1':
                self.s3_client.create_bucket(Bucket=self.bucket_name)
            else:
                self.s3_client.create_bucket(
                    Bucket=self.bucket_name,
                    CreateBucketConfiguration={'LocationConstraint': self.region}
                )
            
            # Set up bucket lifecycle policy for cost optimization
            lifecycle_policy = {
                'Rules': [
                    {
                        'ID': 'AudioStorageOptimization',
                        'Status': 'Enabled',
                        'Filter': {'Prefix': 'conversations/'},
                        'Transitions': [
                            {
                                'Days': 30,
                                'StorageClass': 'STANDARD_IA'  # Infrequent Access after 30 days
                            },
                            {
                                'Days': 90,
                                'StorageClass': 'GLACIER'  # Archive after 90 days
                            }
                        ]
                    }
                ]
            }
            
            self.s3_client.put_bucket_lifecycle_configuration(
                Bucket=self.bucket_name,
                LifecycleConfiguration=lifecycle_policy
            )
            
            logger.info(f"✅ Created S3 bucket: {self.bucket_name} with lifecycle policy")
        except ClientError as e:
            logger.error(f"❌ Failed to create S3 bucket: {e}")
            raise
    
    def _generate_s3_key(self, session_id: str, participant_type: str, timestamp: datetime) -> str:
        """Generate organized S3 key for audio file"""
        # Format: conversations/YYYY/MM/DD/session_id/participant_type_timestamp_uuid.wav
        date_prefix = timestamp.strftime("%Y/%m/%d")
        unique_id = str(uuid.uuid4())[:8]
        timestamp_str = timestamp.strftime("%H%M%S")
        
        return f"conversations/{date_prefix}/{session_id}/{participant_type}_{timestamp_str}_{unique_id}.wav"
    
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
        """
        Upload audio data to S3 and return metadata
        """
        try:
            timestamp = datetime.utcnow()
            s3_key = self._generate_s3_key(session_id, participant_type, timestamp)
            
            # Upload to S3
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.put_object(
                    Bucket=self.bucket_name,
                    Key=s3_key,
                    Body=audio_data,
                    ContentType="audio/wav",
                    Metadata={
                        'session-id': session_id,
                        'user-id': user_id,
                        'participant-type': participant_type,
                        'duration-seconds': str(duration_seconds),
                        'sample-rate': str(sample_rate),
                        'channels': str(channels),
                        'upload-timestamp': timestamp.isoformat()
                    },
                    StorageClass='STANDARD'  # Start with standard, lifecycle will optimize
                )
            )
            
            metadata = AudioMetadata(
                session_id=session_id,
                user_id=user_id,
                participant_type=participant_type,
                duration_seconds=duration_seconds,
                sample_rate=sample_rate,
                channels=channels,
                file_size_bytes=len(audio_data),
                upload_timestamp=timestamp,
                s3_key=s3_key,
                s3_bucket=self.bucket_name
            )
            
            logger.info(f"✅ Uploaded audio: {s3_key} ({len(audio_data)} bytes)")
            return metadata
            
        except ClientError as e:
            logger.error(f"❌ Failed to upload audio to S3: {e}")
            raise
    
    async def download_audio(self, s3_key: str) -> bytes:
        """Download audio data from S3"""
        try:
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.get_object(Bucket=self.bucket_name, Key=s3_key)
            )
            audio_data = response['Body'].read()
            logger.info(f"✅ Downloaded audio: {s3_key} ({len(audio_data)} bytes)")
            return audio_data
        except ClientError as e:
            logger.error(f"❌ Failed to download audio from S3: {e}")
            raise
    
    async def get_presigned_url(
        self,
        s3_key: str,
        expiration: int = 3600,
        method: str = 'get_object'
    ) -> str:
        """Generate presigned URL for secure audio access"""
        try:
            url = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.generate_presigned_url(
                    method,
                    Params={'Bucket': self.bucket_name, 'Key': s3_key},
                    ExpiresIn=expiration
                )
            )
            logger.info(f"✅ Generated presigned URL for: {s3_key}")
            return url
        except ClientError as e:
            logger.error(f"❌ Failed to generate presigned URL: {e}")
            raise
    
    async def list_session_audio(self, session_id: str) -> List[Dict[str, Any]]:
        """List all audio files for a session"""
        try:
            prefix = f"conversations/"
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.list_objects_v2(
                    Bucket=self.bucket_name,
                    Prefix=prefix
                )
            )
            
            session_files = []
            if 'Contents' in response:
                for obj in response['Contents']:
                    if session_id in obj['Key']:
                        # Get object metadata
                        metadata_response = await asyncio.get_event_loop().run_in_executor(
                            None,
                            lambda: self.s3_client.head_object(
                                Bucket=self.bucket_name,
                                Key=obj['Key']
                            )
                        )
                        
                        session_files.append({
                            'key': obj['Key'],
                            'size': obj['Size'],
                            'last_modified': obj['LastModified'],
                            'metadata': metadata_response.get('Metadata', {})
                        })
            
            logger.info(f"✅ Found {len(session_files)} audio files for session: {session_id}")
            return session_files
            
        except ClientError as e:
            logger.error(f"❌ Failed to list session audio: {e}")
            raise
    
    async def delete_audio(self, s3_key: str) -> bool:
        """Delete audio file from S3"""
        try:
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.delete_object(Bucket=self.bucket_name, Key=s3_key)
            )
            logger.info(f"✅ Deleted audio: {s3_key}")
            return True
        except ClientError as e:
            logger.error(f"❌ Failed to delete audio: {e}")
            return False
    
    async def cleanup_old_audio(self, days_old: int = 365) -> int:
        """Clean up audio files older than specified days"""
        try:
            cutoff_date = datetime.utcnow() - timedelta(days=days_old)
            
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.s3_client.list_objects_v2(Bucket=self.bucket_name)
            )
            
            deleted_count = 0
            if 'Contents' in response:
                for obj in response['Contents']:
                    if obj['LastModified'].replace(tzinfo=None) < cutoff_date:
                        await self.delete_audio(obj['Key'])
                        deleted_count += 1
            
            logger.info(f"✅ Cleaned up {deleted_count} old audio files")
            return deleted_count
            
        except ClientError as e:
            logger.error(f"❌ Failed to cleanup old audio: {e}")
            return 0


# Global instance
_audio_storage = None

async def get_audio_storage() -> S3AudioStorage:
    """Get singleton S3AudioStorage instance"""
    global _audio_storage
    if _audio_storage is None:
        _audio_storage = S3AudioStorage()
    return _audio_storage