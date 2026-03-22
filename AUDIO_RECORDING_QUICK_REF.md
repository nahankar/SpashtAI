# Quick Reference: Audio Recording System

## Architecture Overview

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   Browser   │◄───────►│ LiveKit Room │◄───────►│ Python Agent│
│  (React UI) │  WebRTC │   (Server)   │  WebRTC │  (AWS Nova) │
└─────────────┘         └──────────────┘         └─────────────┘
      │                         │                        │
      │                         ▼                        │
      │                  ┌─────────────┐                │
      │                  │   Egress    │                │
      │                  │  (Recording)│                │
      │                  └─────────────┘                │
      │                         │                        │
      ▼                         ▼                        ▼
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│  Visualizer │         │  Audio File │         │  PostgreSQL │
│   (UI)      │         │  (MP3/S3)   │         │  (Metadata) │
└─────────────┘         └─────────────┘         └─────────────┘
```

## Key Components

### 1. LiveKit Egress (Docker)
**Location**: `infra/livekit/egress.yaml`
```yaml
# Local dev
file_output:
  local: true
  output_directory: /out

# Production
s3:
  bucket: spashtai-recordings
```

### 2. Python Agent (EgressRecorder)
**Location**: `apps/agent/main.py`
```python
# Start recording
recorder = EgressRecorder(room_name, session_id)
recording_id = await recorder.start_recording()

# Stop recording
metadata = await recorder.stop_recording()
await recorder.save_metadata_to_db(metadata)
```

### 3. Backend API
**Endpoint**: `POST /sessions/:sessionId/recording`
```json
{
  "egress_id": "EG_...",
  "file_path": "/out/session_123.mp3",
  "duration": 120,
  "file_size": 1024000,
  "status": "completed"
}
```

### 4. Frontend Visualizer
**Component**: `AgentVisualizer.tsx`
```tsx
<AgentVisualizer className="bg-muted/20 rounded-lg" />
```

## Quick Commands

### Start All Services
```bash
# 1. LiveKit + Egress
cd infra/livekit && docker-compose up -d

# 2. Backend
cd apps/server && npm run dev

# 3. Frontend  
cd apps/web && npm run dev

# 4. Agent
cd apps/agent && source .venv312/bin/activate && python main.py start
```

### Check Status
```bash
# Egress service
docker-compose ps egress
docker logs livekit-egress --tail 20

# Recording files
ls -lh apps/agent/audio_storage/

# Database
psql -c "SELECT * FROM \"SessionRecording\" ORDER BY \"createdAt\" DESC LIMIT 5;"
```

### Debug Recording Issues
```bash
# 1. Check Egress is running
docker-compose ps | grep egress

# 2. Check Egress logs
docker logs livekit-egress --tail 50 --follow

# 3. Check agent logs
# Look for: "🎬 Recording started" and "⏹️ Stopped recording"

# 4. Check backend logs
# Look for: "🎙️ Saved recording for session"

# 5. Verify file created
ls -lh apps/agent/audio_storage/*.mp3
```

## Production Deployment

### Environment Variables
```bash
# Agent (.env)
LIVEKIT_URL=https://your-livekit-server.com
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret
AWS_ACCESS_KEY_ID=your-aws-key
AWS_SECRET_ACCESS_KEY=your-aws-secret
AWS_REGION=us-east-1
S3_RECORDING_BUCKET=spashtai-recordings
ENVIRONMENT=production
```

### S3 Bucket Setup
```bash
# Create bucket
aws s3 mb s3://spashtai-recordings --region us-east-1

# Set bucket policy (adjust as needed)
aws s3api put-bucket-policy \
  --bucket spashtai-recordings \
  --policy file://bucket-policy.json

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket spashtai-recordings \
  --versioning-configuration Status=Enabled
```

### Example Bucket Policy (bucket-policy.json)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EgressUpload",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT:user/egress-uploader"
      },
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::spashtai-recordings/*"
    }
  ]
}
```

## File Naming Convention

```
{sessionId}_{timestamp}.mp3

Examples:
- session_1759502389626_4odk2b9ca_20251003_145930.mp3
- session_abc123def456_20251003_160045.mp3
```

## Database Schema Reference

```sql
CREATE TABLE "SessionRecording" (
  "id" TEXT PRIMARY KEY,
  "sessionId" TEXT UNIQUE NOT NULL REFERENCES "Session"(id) ON DELETE CASCADE,
  "egressId" TEXT UNIQUE NOT NULL,
  "filePath" TEXT NOT NULL,
  "duration" INTEGER NOT NULL DEFAULT 0,
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'completed',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL
);
```

## Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| Egress container restarting | Check Redis connection in `egress.yaml` |
| No recording file created | Verify `audio_storage/` directory permissions |
| Recording metadata not saved | Check backend logs for HTTP errors |
| Audio visualizer not showing | Ensure agent publishes `lk.agent.state` attribute |
| S3 upload fails in prod | Verify AWS credentials and bucket permissions |

## Performance Metrics

| Metric | Value |
|--------|-------|
| Audio bitrate | 128 kbps |
| File size | ~1 MB/minute |
| Egress CPU usage | 2-6 CPUs per room |
| Egress memory | 4 GB minimum |
| Recording delay | <1 second start/stop |

## Monitoring Checklist

- [ ] Egress service health: `http://localhost:9090/health`
- [ ] Egress metrics: `livekit_egress_available`
- [ ] Storage usage: Monitor `audio_storage/` or S3 bucket size
- [ ] Database queries: Monitor `SessionRecording` table growth
- [ ] Failed recordings: Check `status != 'completed'`

## Support & Documentation

- **LiveKit Docs**: https://docs.livekit.io/home/self-hosting/egress/
- **Implementation Guide**: `AUDIO_RECORDING_IMPLEMENTATION.md`
- **Project Instructions**: `.instructions.md`
