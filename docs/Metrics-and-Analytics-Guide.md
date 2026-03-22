# SpashtAI Metrics and Analytics System

> **Comprehensive metrics collection and analytics for voice AI interviews**  
> **Created**: 2025-09-26  
> **Features**: LiveKit built-in metrics + custom linguistic analytics + transcript export

---

## Overview

SpashtAI now includes a comprehensive metrics and analytics system that captures both technical performance metrics from LiveKit and custom linguistic analytics for interview sessions. This system provides real-time feedback during sessions and detailed post-session analysis.

## Features

### 1. **LiveKit Built-in Metrics**
- **LLM Metrics**: Token usage, processing duration, time-to-first-token (TTFT)
- **TTS Metrics**: Audio duration, character count, time-to-first-byte (TTFB)
- **STT Metrics**: Audio processing duration (when using standalone STT)
- **End-of-Utterance (EOU)**: Turn detection delays, transcription latency
- **Conversation Latency**: Total response time (EOU + TTFT + TTS TTFB)

### 2. **Custom Linguistic Analytics**
- **Speaking Performance**: Words per minute, filler word detection and rate
- **Vocabulary Analysis**: Diversity index, average sentence length
- **Conversation Flow**: Response times, turn distribution
- **Speaking Time**: User vs Assistant time allocation

### 3. **Real-time Monitoring**
- Live metrics overlay during active sessions
- Performance indicators with color-coded status
- Turn-by-turn conversation tracking

### 4. **Session Analytics Dashboard**
- Comprehensive post-session analysis
- Performance benchmarking with industry standards
- Visual progress indicators and status badges

### 5. **Transcript Management**
- Complete conversation capture with speaker identification
- Export in multiple formats (JSON, TXT)
- Downloadable transcripts with metadata

---

## Technical Architecture

### Agent-Side Metrics Collection

**File**: `apps/agent/metrics_collector.py`

```python
from metrics_collector import MetricsCollector

# Initialize for session
metrics_collector = MetricsCollector(session_id)

# Set up LiveKit metrics collection
session.on("metrics_collected", metrics_collector.on_metrics_collected)

# Add conversation turns
metrics_collector.add_conversation_turn("user", transcript_text)
metrics_collector.add_conversation_turn("assistant", response_text)

# Finalize and export
final_metrics = metrics_collector.finalize_session()
transcript_data = metrics_collector.export_transcript()
```

**Key Classes**:
- `MetricsCollector`: Main collection and analysis engine
- `SessionMetrics`: Complete session data structure
- `LinguisticMetrics`: Custom analytics for speaking performance
- `ConversationTurn`: Individual turn data with metadata

### Backend Storage

**Database Schema**: Enhanced Prisma models for metrics storage

```prisma
model SessionMetrics {
  // LiveKit metrics
  totalLlmTokens        Int
  avgTtft              Float  // time to first token
  conversationLatencyAvg Float
  
  // User linguistic metrics  
  userWpm              Float
  userFillerRate       Float
  userVocabDiversity   Float
  
  // Assistant metrics
  assistantWpm         Float
  totalTurns           Int
}

model SessionTranscript {
  conversationData Json  // Complete conversation with metadata
}
```

**API Endpoints**:
- `POST /sessions/:sessionId/metrics` - Save session metrics
- `POST /sessions/:sessionId/transcript` - Save session transcript
- `GET /sessions/:sessionId/metrics` - Retrieve session metrics
- `GET /sessions/:sessionId/transcript/download?format=json|txt` - Download transcript

### Frontend Analytics

**Components**:
- `SessionMetrics`: Comprehensive post-session analytics dashboard
- `RealTimeMetrics`: Live performance overlay during sessions
- `useSessionMetrics`: Hook for metrics data management
- `useRealTimeMetrics`: Hook for live session monitoring

**Real-time Data Flow**:
```
Agent → LiveKit Data Channels → Frontend Hooks → UI Components
     ↓
  Database Storage ← Backend API ← Session Completion Event
```

---

## Usage Guide

### 1. **Starting a Session**

When joining a LiveKit room, the system automatically:
- Generates a unique session ID
- Initializes metrics collection
- Sets up real-time monitoring

```typescript
// Session starts automatically on room join
const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
```

### 2. **Real-time Monitoring**

During an active session, users can:
- Toggle real-time metrics overlay
- View live performance indicators:
  - Current words per minute
  - Filler word rate
  - Response time
  - Conversation latency
  - Turn count

### 3. **Post-Session Analytics**

After session completion:
- Comprehensive metrics dashboard appears
- Download transcripts in preferred format
- View performance benchmarking
- Access historical session data

### 4. **Transcript Export**

**JSON Format**: Complete data with metadata
```json
{
  "session_id": "session_123",
  "conversation": [
    {
      "speaker": "user",
      "text": "Hello, I'd like to practice interviewing",
      "timestamp": 1640995200.123,
      "word_count": 7,
      "filler_words": []
    }
  ],
  "metrics": { /* complete metrics */ }
}
```

**TXT Format**: Clean, readable transcript
```
Session Transcript
Session ID: session_123
User: john@example.com
Date: 2025-09-26T10:30:00Z

[10:30:15] User: Hello, I'd like to practice interviewing
[10:30:18] Assistant: Great! I'm here to help you practice...
```

---

## Metrics Reference

### Performance Benchmarks

| Metric | Excellent | Good | Average | Needs Improvement |
|--------|-----------|------|---------|-------------------|
| **Words Per Minute** | ≥140 | 120-139 | 100-119 | <100 |
| **Filler Word Rate** | ≤2% | 2-5% | 5-8% | >8% |
| **Conversation Latency** | ≤1.0s | 1.0-2.0s | 2.0-3.0s | >3.0s |
| **Response Time** | ≤2.0s | 2.0-4.0s | 4.0-6.0s | >6.0s |

### Filler Words Detected

The system automatically detects common filler words:
- Basic: "um", "uh", "er", "ah"
- Conversational: "like", "you know", "so", "well"
- Professional: "actually", "basically", "literally"

### Vocabulary Diversity

Calculated as: `unique_words / total_words`
- Higher scores indicate more varied vocabulary
- Typical range: 0.3-0.8 for interview contexts

---

## Data Privacy & Storage

### Data Collection
- All metrics are session-scoped and user-controlled
- Transcripts include speaker identification only
- No personal information beyond email is stored

### Data Retention
- Session data stored indefinitely for user access
- Users can request data deletion via API
- Transcripts can be downloaded and deleted from servers

### Security
- All API endpoints require proper authentication
- Database uses encrypted storage for sensitive data
- HTTPS/WSS required for all data transmission

---

## Development & Customization

### Adding Custom Metrics

1. **Extend LinguisticMetrics**:
```python
@dataclass
class LinguisticMetrics:
    # Existing metrics...
    custom_metric: float = 0.0
```

2. **Update Calculation Logic**:
```python
def _calculate_linguistic_metrics(self, turns):
    # Existing calculations...
    custom_value = self._calculate_custom_metric(turns)
    return LinguisticMetrics(custom_metric=custom_value)
```

3. **Update Database Schema**:
```prisma
model SessionMetrics {
  // Existing fields...
  customMetric Float @default(0)
}
```

### Custom Analytics Dashboard

Create new components extending the base SessionMetrics:
```typescript
import { SessionMetrics } from '@/components/analytics/SessionMetrics'

function CustomAnalytics({ metrics }) {
  return (
    <div>
      <SessionMetrics {...props} />
      {/* Your custom visualizations */}
    </div>
  )
}
```

---

## Troubleshooting

### Common Issues

**Metrics not appearing**:
- Verify session ID is properly set
- Check LiveKit data channel connectivity
- Ensure backend API is accessible

**Transcript export failing**:
- Confirm session has completed
- Check file permissions for downloads
- Verify API endpoint responses

**Real-time metrics not updating**:
- Check LiveKit room connection status
- Verify data channel topic subscriptions
- Monitor browser console for errors

### Debug Mode

Enable detailed logging:
```python
# Agent side
logger.setLevel(logging.DEBUG)

# Frontend
console.log('🔍 Debug mode enabled')
```

---

## Future Enhancements

### Planned Features
- **Sentiment Analysis**: Emotional tone detection
- **Fluency Scoring**: Advanced speech pattern analysis
- **Comparative Analytics**: Performance trends over time
- **AI-Powered Insights**: Personalized improvement recommendations
- **Team Analytics**: Organization-wide performance metrics

### Integration Opportunities
- **HR Systems**: Direct integration with applicant tracking
- **Learning Platforms**: Progress tracking and certification
- **Communication Tools**: Slack/Teams notifications for session completion

---

This comprehensive metrics system provides the foundation for data-driven interview practice and performance improvement, combining technical precision with practical insights for better user experiences.
