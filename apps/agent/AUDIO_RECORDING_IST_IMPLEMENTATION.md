# SpashtAI Audio Recording & IST Timezone Implementation

## Overview
This implementation adds full conversation audio recording and Indian Standard Time (IST) timezone support to the SpashtAI voice agent.

## Features Implemented

### 1. Indian Standard Time (IST) Support ✅
- **All timestamps** now use IST (Asia/Kolkata timezone)
- Applied to:
  - Conversation message timestamps
  - Database entries (createdAt, updatedAt)
  - Audio file metadata
  - Session logs

### 2. Full Conversation Audio Recording ✅
- Records complete conversation audio from both participants
- Saves separate tracks for:
  - **User audio** - Voice input from the user
  - **Assistant audio** - Voice output from AWS Nova Sonic
  - **Mixed audio** - Combined conversation (both tracks)

### 3. Environment-Aware Storage ✅
- **Development**: Local file storage (`./audio_storage/`)
- **Production**: Amazon S3 storage
- Automatic selection based on `ENVIRONMENT` variable

## File Structure

```
apps/agent/
├── main.py                    # Enhanced with IST + audio recording
├── audio_recorder.py          # NEW: Audio recording manager
├── audio_storage.py           # Local storage backend
├── s3_audio_storage.py        # S3 storage backend
└── requirements.txt           # Updated with pytz dependency
```

## Configuration

### Environment Variables

```bash
# Timezone (handled automatically)
TZ=Asia/Kolkata

# Audio Storage
ENVIRONMENT=development  # or "production"
LOCAL_AUDIO_PATH=./audio_storage  # for dev
AUDIO_S3_BUCKET=spashtai-audio-storage  # for prod

# AWS (for S3 in production)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
```

## How It Works

### IST Timezone Conversion

```python
# All timestamps are converted to IST
from pytz import timezone
IST = timezone('Asia/Kolkata')

# Convert any datetime to IST
def to_ist_isoformat(dt=None):
    if dt is None:
        dt = datetime.now(IST)
    elif dt.tzinfo is None:
        dt = pytz.utc.localize(dt).astimezone(IST)
    else:
        dt = dt.astimezone(IST)
    return dt.isoformat()
```

### Audio Recording Flow

1. **Session Start**: AudioRecorder initialized with session ID
2. **Track Subscription**: Subscribe to user and assistant audio tracks
3. **Frame Capture**: Real-time audio frames collected in buffers
4. **Session End**: Audio saved as WAV files to storage backend
5. **Cleanup**: Files organized by date/session, metadata stored

### Audio File Organization

```
Local Storage (Development):
./audio_storage/
  └── 2025-10-01/
      └── session_xyz/
          ├── user_094830_abc123.wav
          ├── assistant_094830_def456.wav
          └── mixed_094830_ghi789.wav

S3 Storage (Production):
s3://spashtai-audio-storage/
  └── conversations/
      └── 2025/10/01/
          └── session_xyz/
              ├── user_094830_abc123.wav
              ├── assistant_094830_def456.wav
              └── mixed_094830_ghi789.wav
```

## Audio Metadata

Each saved audio file includes metadata:

```python
@dataclass
class AudioMetadata:
    session_id: str
    user_id: str
    participant_type: str  # 'user', 'assistant', or 'mixed'
    duration_seconds: float
    sample_rate: int       # 16000 Hz
    channels: int          # 1 (mono)
    file_size_bytes: int
    upload_timestamp: datetime  # in IST
    storage_key: str
    storage_location: str
    content_type: str      # "audio/wav"
```

## Installation

1. Install new dependency:
```bash
cd apps/agent
source .venv312/bin/activate
pip install pytz
```

2. Verify S3 bucket (for production):
```bash
aws s3 ls s3://spashtai-audio-storage/
```

3. Create local storage directory (for development):
```bash
mkdir -p ./audio_storage
```

## Usage

### Check Recording Status

```python
# During session
stats = audio_recorder.get_recording_stats()
print(stats)
# {
#     "session_id": "session_123",
#     "is_recording": True,
#     "duration_seconds": 45.2,
#     "user_frames": 2260,
#     "assistant_frames": 1890,
#     "sample_rate": 16000,
#     "channels": 1
# }
```

### Access Saved Audio

**Development (Local)**:
```python
# Files are in ./audio_storage/YYYY-MM-DD/session_id/
path = "./audio_storage/2025-10-01/session_xyz/user_094830_abc123.wav"
```

**Production (S3)**:
```python
# Generate pre-signed URL for download
url = await storage.get_access_url(
    storage_key="conversations/2025/10/01/session_xyz/user_094830_abc123.wav",
    expiration=3600  # 1 hour
)
```

## Database Schema

Conversation messages now include IST timestamps:

```json
{
  "role": "user",
  "content": "Hello, how are you?",
  "timestamp": "2025-10-01T21:48:30.123456+05:30"  // IST
}
```

The `+05:30` suffix indicates IST (UTC+5:30).

## Monitoring

### Agent Logs

Watch for these log messages:

```
🎙️ Audio recorder initialized with local storage
▶️ Started recording session session_xyz
🎙️ Subscribed to audio track from user-3456
✅ Saved user audio: audio_storage/2025-10-01/session_xyz/user_094830_abc123.wav
✅ Saved assistant audio: audio_storage/2025-10-01/session_xyz/assistant_094830_def456.wav
✅ Saved mixed audio: audio_storage/2025-10-01/session_xyz/mixed_094830_ghi789.wav
⏹️ Stopped recording session session_xyz (duration: 45.23s)
```

## Testing

### Test IST Timestamps

```python
from datetime import datetime
import pytz

IST = pytz.timezone('Asia/Kolkata')
now_ist = datetime.now(IST)
print(f"Current IST time: {now_ist.isoformat()}")
# Output: 2025-10-01T21:48:30.123456+05:30
```

### Test Audio Recording

1. Start a session
2. Have a conversation
3. End the session
4. Check audio files:

```bash
# Development
ls -lh ./audio_storage/$(date +%Y-%m-%d)/

# Production
aws s3 ls s3://spashtai-audio-storage/conversations/$(date +%Y/%m/%d)/
```

## Performance Considerations

- **Memory**: Audio frames buffered in memory during session
- **Storage**: ~1.5 MB per minute of mono audio (16kHz, 16-bit)
- **Network**: S3 uploads happen after session ends (non-blocking)
- **Cleanup**: Consider lifecycle policies for old recordings

## S3 Lifecycle Policy

Audio files are automatically managed:
- **0-30 days**: Standard storage
- **30-90 days**: Infrequent Access (STANDARD_IA)
- **90+ days**: Glacier (archive)

## Troubleshooting

### Issue: Audio files not saved
**Solution**: Check permissions for `./audio_storage/` directory or S3 bucket

### Issue: Wrong timezone
**Solution**: Verify `TZ` environment variable or pytz installation

### Issue: S3 upload fails
**Solution**: Check AWS credentials and bucket permissions

## Future Enhancements

- [ ] Real-time audio streaming to S3 (avoid memory buffering)
- [ ] Audio quality metrics (SNR, clarity, volume)
- [ ] Automatic transcription sync with audio timestamps
- [ ] Audio compression (reduce storage costs)
- [ ] Multi-region S3 replication

## License

Part of the SpashtAI project.
