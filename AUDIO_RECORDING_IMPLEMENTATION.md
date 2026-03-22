# Audio Recording Implementation Summary

## Overview
Successfully implemented **end-to-end audio recording** for SpashtAI using LiveKit Egress service. The system now records all conversation audio automatically and stores it with metadata in the database.

## What Was Implemented

### 1. **LiveKit Egress Service** ✅
- **Added Egress to Docker Compose** (`infra/livekit/docker-compose.yml`)
  - Configured Egress container with Redis connection
  - Mapped local storage volume: `apps/agent/audio_storage`
  - Health check and automatic restarts

- **Created Egress Configuration** (`infra/livekit/egress.yaml`)
  - Redis message bus connection
  - Local file storage for development
  - S3 configuration template for production
  - Audio codec settings (AAC, 128kbps, 48kHz)

### 2. **Python Agent Recording** ✅
- **Created `EgressRecorder` Class** (`apps/agent/main.py`)
  - Starts room recording on session begin
  - Stops recording on session end
  - Generates unique filenames: `{sessionId}_{timestamp}.mp3`
  - Environment-based storage:
    - **Development**: `/out/{filename}` (local storage)
    - **Production**: S3 bucket with configurable credentials
  - Saves metadata to database

- **Integration Points**:
  - Recording starts automatically when agent joins room
  - Recording stops in `finally` block ensuring cleanup
  - Metadata saved: `egress_id`, `file_path`, `duration`, `file_size`, `status`

### 3. **Database Schema** ✅
- **Created `SessionRecording` Model** (Prisma schema)
  ```prisma
  model SessionRecording {
    id         String   @id @default(cuid())
    session    Session  @relation(...)
    sessionId  String   @unique
    egressId   String   @unique
    filePath   String   // Local path or S3 URL
    duration   Int      // Duration in seconds
    fileSize   Int      // File size in bytes
    status     String   // completed, failed, processing
    createdAt  DateTime
    updatedAt  DateTime
  }
  ```
- **Ran Migration**: `20251003145414_add_session_recording`
- **Updated Session Model**: Added `recording` relation

### 4. **Backend API** ✅
- **New Endpoint**: `POST /sessions/:sessionId/recording`
  - Saves recording metadata
  - Auto-creates session if doesn't exist
  - Upserts recording data
  - Returns recording details

- **Updated Routes** (`apps/server/src/routes/sessions.ts`):
  - Added `saveRecording` function
  - Integrated with Prisma client
  - Error handling and logging

### 5. **Frontend Audio Visualizer** ✅
- **Created `AgentVisualizer` Component** 
  - Shows real-time audio bars (`BarVisualizer`)
  - Displays agent state (connecting, listening, thinking, speaking)
  - Color-coded states:
    - **Green**: Listening
    - **Yellow**: Thinking
    - **Blue**: Speaking
    - **Gray**: Initializing/Connecting
    - **Red**: Disconnected

- **Integrated into Interview Page**
  - Added above conversation UI
  - Uses LiveKit hooks: `useVoiceAssistant()`
  - Tracks audio levels in real-time

## Key Features

### Recording Flow
```
1. User joins room
   ↓
2. Python agent connects
   ↓
3. EgressRecorder.start_recording()
   - Creates Egress request
   - Gets egress_id
   - Logs file path
   ↓
4. Egress service records room audio
   ↓
5. User leaves / session ends
   ↓
6. EgressRecorder.stop_recording()
   - Stops Egress
   - Gets duration/size metadata
   ↓
7. Save metadata to database
   - POST /sessions/{id}/recording
   - Stores in SessionRecording table
```

### Storage Configuration

#### Development (Local)
```yaml
file_output:
  local: true
  output_directory: /out
```
Files saved to: `/Users/.../spashtai/apps/agent/audio_storage/`

#### Production (S3)
```yaml
s3:
  access_key: ${AWS_ACCESS_KEY_ID}
  secret: ${AWS_SECRET_ACCESS_KEY}
  region: ${AWS_REGION}
  bucket: ${S3_RECORDING_BUCKET}
```

Set environment variables:
```bash
export AWS_ACCESS_KEY_ID=your_key
export AWS_SECRET_ACCESS_KEY=your_secret
export AWS_REGION=us-east-1
export S3_RECORDING_BUCKET=spashtai-recordings
export ENVIRONMENT=production
```

### Audio Format
- **Codec**: AAC (Advanced Audio Codec)
- **Bitrate**: 128 kbps
- **Sample Rate**: 48 kHz
- **Format**: MP3
- **Channels**: Stereo

## Files Modified/Created

### Created
1. `/infra/livekit/egress.yaml` - Egress configuration
2. `/apps/agent/audio_storage/` - Local storage directory
3. `/apps/web/src/components/layout/AgentVisualizer.tsx` - Audio visualizer
4. Database migration: `20251003145414_add_session_recording`

### Modified
1. `/infra/livekit/docker-compose.yml` - Added Egress service
2. `/apps/agent/main.py` - Added EgressRecorder class
3. `/apps/server/prisma/schema.prisma` - Added SessionRecording model
4. `/apps/server/src/routes/sessions.ts` - Added saveRecording endpoint
5. `/apps/server/src/index.ts` - Added recording route
6. `/apps/web/src/pages/Interview.tsx` - Added AgentVisualizer

## How to Test

### 1. Start Services
```bash
# LiveKit (includes Egress)
cd infra/livekit && docker-compose up -d

# Backend
cd apps/server && npm run dev

# Frontend
cd apps/web && npm run dev

# Agent
cd apps/agent && source .venv312/bin/activate && python main.py start
```

### 2. Test Recording
1. Open browser: http://localhost:5174
2. Navigate to Interview page
3. Join a room
4. Start conversation with agent
5. **Observe**:
   - Audio visualizer shows agent state
   - Bars animate during speech
   - Agent terminal logs: "🎬 Recording started: {egress_id}"
6. Leave room
7. **Verify**:
   - Check terminal: "⏹️ Stopped recording: {egress_id}"
   - Check file: `apps/agent/audio_storage/{sessionId}_{timestamp}.mp3`
   - Check database: `SELECT * FROM "SessionRecording"`

### 3. Verify Database
```sql
-- Check recording metadata
SELECT 
  sr.*,
  s.id as session_id,
  s."startedAt",
  s."endedAt"
FROM "SessionRecording" sr
JOIN "Session" s ON s.id = sr."sessionId"
ORDER BY sr."createdAt" DESC
LIMIT 10;
```

## Troubleshooting

### Egress Not Starting
```bash
# Check Egress logs
docker logs livekit-egress --tail 50

# Common issues:
# 1. Redis not connected → Check egress.yaml redis config
# 2. Permission denied → Check audio_storage directory permissions
```

### Recording File Not Created
```bash
# Check directory exists
ls -la apps/agent/audio_storage/

# Check Egress status
docker-compose ps egress

# Check Egress health
curl http://localhost:9090/health
```

### Metadata Not Saved to Database
```bash
# Check backend logs
# Look for: "🎙️ Saved recording for session..."

# Verify endpoint
curl -X POST http://localhost:4000/sessions/test_session/recording \
  -H "Content-Type: application/json" \
  -d '{
    "egress_id": "test_id",
    "file_path": "/out/test.mp3",
    "duration": 120,
    "file_size": 1024000
  }'
```

## Production Deployment Checklist

- [ ] Set AWS credentials as environment variables
- [ ] Create S3 bucket: `spashtai-recordings`
- [ ] Set `ENVIRONMENT=production` in agent
- [ ] Configure S3 bucket policy (public/private)
- [ ] Set up S3 lifecycle rules (retention policy)
- [ ] Configure CloudFront (optional, for CDN)
- [ ] Enable S3 versioning (optional)
- [ ] Set up monitoring alerts for Egress failures
- [ ] Configure backup strategy
- [ ] Test recording from production environment

## Performance Notes

- **Egress CPU**: 2-6 CPUs per room recording
- **Memory**: 4 GB minimum recommended
- **Storage**: ~1 MB/minute for 128kbps audio
- **Concurrent Recordings**: Egress auto-load-balances
- **Autoscaling**: Configure based on `livekit_egress_available` metric

## Next Steps (Optional Enhancements)

1. **Download Recordings**
   - Add endpoint: `GET /sessions/:id/recording/download`
   - Stream file from S3 or local storage

2. **Transcription Integration**
   - Send recording to AWS Transcribe
   - Store transcript in SessionTranscript table

3. **Audio Playback in UI**
   - Add audio player in session details
   - Show waveform visualization

4. **Recording Management**
   - Bulk download recordings
   - Delete old recordings (cleanup job)
   - Compression options

5. **Advanced Analytics**
   - Voice activity detection
   - Speaker diarization
   - Sentiment analysis from audio

## Documentation References

- [LiveKit Egress Docs](https://docs.livekit.io/home/self-hosting/egress/)
- [LiveKit Agents Audio](https://docs.livekit.io/agents/build/audio/)
- [Audio Recipes](https://docs.livekit.io/recipes/?tag=audio)
- [Audio Visualizer](https://docs.livekit.io/agents/start/frontend/#audio-visualizer)

## Status: ✅ COMPLETE

All components implemented, tested, and integrated. The system is ready for use in development. For production deployment, configure AWS S3 credentials and set `ENVIRONMENT=production`.
