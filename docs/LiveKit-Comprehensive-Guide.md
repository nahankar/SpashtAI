# LiveKit Comprehensive Learning Guide

> **Source**: [LiveKit Documentation](https://docs.livekit.io/home/)  
> **Created**: 2025-09-26  
> **Purpose**: Comprehensive reference for building voice, video, and multimodal AI applications

---

## Table of Contents

1. [Overview & Core Concepts](#overview--core-concepts)
2. [Getting Started](#getting-started)
3. [LiveKit SDKs](#livekit-sdks)
4. [Realtime Media & Data](#realtime-media--data)
5. [AI Agents Framework](#ai-agents-framework)
6. [Authentication & Security](#authentication--security)
7. [Server APIs](#server-apis)
8. [Recording & Export](#recording--export)
9. [LiveKit Cloud vs Self-Hosting](#livekit-cloud-vs-self-hosting)
10. [Platform-Specific Implementation](#platform-specific-implementation)
11. [Advanced Features](#advanced-features)
12. [Best Practices & Patterns](#best-practices--patterns)

---

## Overview & Core Concepts

### What is LiveKit?

LiveKit is **the open source framework and cloud platform for voice, video, and physical AI agents**. It provides:

- **Real-time communication** (WebRTC-based)
- **AI Agent framework** for building multimodal AI applications
- **Scalable infrastructure** for production deployments
- **Multi-platform SDKs** (JavaScript, Swift, Kotlin, Flutter, React Native, etc.)

### Core Architecture Components

#### 1. **Rooms, Participants, and Tracks**

**Room**: A virtual space where participants connect for real-time communication
```typescript
// Example room structure
{
  name: "interview-session-123",
  participants: [
    { identity: "user-456", tracks: [...] },
    { identity: "ai-agent", tracks: [...] }
  ],
  metadata: { sessionType: "interview" }
}
```

**Participant**: A user or agent connected to a room
- **Local Participant**: Current user/agent
- **Remote Participants**: Other users/agents in the room

**Track**: Media stream (audio, video, or data)
- **Audio Tracks**: Microphone input, TTS output
- **Video Tracks**: Camera feed, screen share
- **Data Tracks**: Text messages, metadata, real-time data

#### 2. **Track Sources & Types**

| Source Type | Description | Use Cases |
|-------------|-------------|-----------|
| `microphone` | User's microphone input | Voice conversations, interviews |
| `camera` | User's camera feed | Video calls, visual interactions |
| `screen_share` | Screen sharing | Presentations, demos |
| `unknown` | Custom or unspecified | AI-generated content, custom streams |

---

## Getting Started

### 1. **Basic Connection Flow**

```typescript
// Frontend (React/JS)
import { LiveKitRoom } from '@livekit/components-react';

function MyApp() {
  const token = await fetchTokenFromBackend();
  
  return (
    <LiveKitRoom
      token={token}
      serverUrl="wss://your-livekit-server.com"
      onConnected={() => console.log('Connected!')}
    >
      {/* Your UI components */}
    </LiveKitRoom>
  );
}
```

```python
# Backend (Python Agent)
from livekit.agents import JobContext, WorkerOptions, cli

async def entrypoint(ctx: JobContext):
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    # Your agent logic here

if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
```

### 2. **Environment Setup**

#### Local Development
```bash
# Using Docker (Recommended)
docker run --rm -p 7880:7880 \
  -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server \
  --dev --bind 0.0.0.0
```

#### Environment Variables
```env
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
```

---

## LiveKit SDKs

### 1. **Client-Side SDKs**

#### JavaScript/TypeScript
- **@livekit/components-react**: Pre-built React components
- **@livekit/components-styles**: Default styling
- **livekit-client**: Core client SDK

```typescript
import { Room, RoomEvent, Track } from 'livekit-client';

const room = new Room();
await room.connect('wss://your-server.com', token);

// Handle events
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === Track.Kind.Audio) {
    const audioElement = track.attach();
    document.body.appendChild(audioElement);
  }
});
```

#### Mobile SDKs
- **Swift (iOS)**: Native iOS integration
- **Kotlin (Android)**: Native Android integration
- **Flutter**: Cross-platform mobile
- **React Native**: JavaScript-based mobile

### 2. **Server-Side SDKs**

#### Python (Agents)
```python
from livekit.agents import JobContext, WorkerOptions
from livekit.agents.voice import Agent

# For AI Agents
agent = Agent(
    instructions="You are a helpful assistant",
    vad=VAD.load(),
    llm=OpenAI(),
    tts=ElevenLabs()
)
```

#### Node.js (Server APIs)
```typescript
import { RoomServiceClient } from 'livekit-server-sdk';

const client = new RoomServiceClient('wss://server', 'api-key', 'secret');
await client.createRoom({ name: 'my-room' });
```

---

## Realtime Media & Data

### 1. **Audio Processing**

#### Voice Activity Detection (VAD)
```python
from livekit.plugins import silero

vad = silero.VAD.load()
# Automatically detects when user starts/stops speaking
```

#### Audio Formats & Configuration
- **Sample Rate**: 16kHz, 24kHz, 48kHz
- **Encoding**: Opus, PCM
- **Channels**: Mono (recommended for voice), Stereo

### 2. **Data Channels**

#### Sending Data Messages
```typescript
// Frontend
const room = useRoomContext();
await room.localParticipant.publishData(
  JSON.stringify({ type: 'chat', message: 'Hello!' }),
  { topic: 'chat', reliable: true }
);
```

```python
# Python Agent
await ctx.room.local_participant.publish_data(
    json.dumps({"type": "transcript", "text": "Hello!"}),
    topic="conversation"
)
```

#### Receiving Data Messages
```typescript
// React Hook
import { useDataChannel } from '@livekit/components-react';

useDataChannel({
  onMessage: (data, participant, topic) => {
    const message = JSON.parse(new TextDecoder().decode(data));
    console.log('Received:', message);
  }
});
```

### 3. **State Synchronization**

#### Event Handling
```typescript
room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  // Handle real-time data updates
});

room.on(RoomEvent.ParticipantConnected, (participant) => {
  // New participant joined
});

room.on(RoomEvent.TrackPublished, (publication, participant) => {
  // New media track available
});
```

---

## AI Agents Framework

### 1. **Agent Architecture**

LiveKit Agents provide a framework for building **realtime multimodal AI agents**:

```python
from livekit.agents.voice import Agent, AgentSession

# Create Agent
agent = Agent(
    instructions="System prompt for the AI",
    vad=VAD.load(),        # Voice Activity Detection
    llm=LLMProvider(),     # Language Model
    tts=TTSProvider(),     # Text-to-Speech
    stt=STTProvider()      # Speech-to-Text (optional)
)

# Create Session
session = AgentSession(
    vad=VAD.load(),
    llm=LLMProvider(),
    tts=TTSProvider()
)

await session.start(agent, room=ctx.room)
```

### 2. **Supported AI Providers**

#### Language Models (LLM)
- **OpenAI**: GPT-4, GPT-3.5
- **Anthropic**: Claude
- **AWS Bedrock**: Nova, Titan models
- **Google**: Gemini
- **Local Models**: Ollama, Custom

#### Text-to-Speech (TTS)
- **OpenAI**: Voice models
- **ElevenLabs**: Premium voices
- **AWS Polly**: Multi-language support
- **Google Cloud TTS**
- **Azure Speech Services**

#### Speech-to-Text (STT)
- **OpenAI Whisper**
- **Google Speech-to-Text**
- **AWS Transcribe**
- **Azure Speech Services**

### 3. **Agent Event Handling**

```python
@session.on("user_speech_committed")
async def on_user_speech(event):
    transcript = event.transcript
    # Process user input
    
@session.on("agent_speech_committed") 
async def on_agent_speech(event):
    response = event.text
    # Log or process agent response
    
@session.on("llm_response_started")
async def on_llm_start(event):
    # LLM started generating response
    
@session.on("llm_response_finished")
async def on_llm_finish(event):
    final_response = event.text
    # Complete response available
```

### 4. **Real-time Conversation Patterns**

#### AWS Nova Sonic Integration

**Amazon Nova Sonic** is a state-of-the-art speech-to-speech model with bidirectional audio streaming API that processes and responds to realtime speech naturally.

##### Installation
```bash
pip install "livekit-plugins-aws[realtime]"
```

##### Authentication
```env
AWS_ACCESS_KEY_ID=<your-aws-access-key-id>
AWS_SECRET_ACCESS_KEY=<your-aws-secret-access-key>
```

##### Simple Usage Pattern
```python
from livekit.plugins import aws

# Simple and clean - Nova Sonic handles everything internally
session = AgentSession(
    llm=aws.realtime.RealtimeModel(),
)

await session.start(agent, room=ctx.room)
```

##### Advanced Configuration
```python
from livekit.plugins import aws

# With custom parameters
realtime_model = aws.realtime.RealtimeModel(
    region="us-east-1",  # AWS region
    voice="tiffany",     # Nova Sonic voice
    temperature=0.7,
    top_p=0.9,
    max_tokens=1024
)

session = AgentSession(
    llm=realtime_model,  # Nova Sonic handles STT + LLM + TTS internally
)
```

##### Key Features
- **Built-in VAD**: Voice Activity Detection included
- **Turn Detection**: Automatic conversation turn management
- **Bidirectional Streaming**: Real-time audio processing
- **Natural Conversations**: Human-like conversational experiences
- **No Manual Event Handling**: Nova Sonic manages all audio events internally

##### Important Notes
- Nova Sonic includes **built-in VAD-based turn detection** - no manual VAD needed
- The model handles **STT + LLM + TTS** in a single integrated pipeline
- **No manual event monitoring required** - conversations flow automatically
- Data messages for transcripts must be published separately if needed for UI display

##### Data Publishing with RTC SDK
Based on the [LiveKit Python RTC documentation](https://docs.livekit.io/reference/python/v1/livekit/rtc/index.html), use proper data publishing patterns:

```python
# Proper data publishing using RTC SDK patterns
await room.local_participant.publish_data(
    payload.encode('utf-8'),  # Encode as bytes
    reliable=True,           # Ensure reliable delivery
    topic="chat"             # Specific topic for organization
)
```

##### Room Event Handling
Using [LiveKit RTC event patterns](https://docs.livekit.io/reference/client-sdk-node/) for better connectivity monitoring:

```python
# Set up room event handlers
room.on("participant_connected", lambda participant: 
       print(f"Participant joined: {participant.identity}"))
       
room.on("participant_disconnected", lambda participant, reason: 
       print(f"Participant left: {participant.identity} - {reason}"))
       
room.on("data_received", lambda payload, participant, topic: 
       print(f"Data received on {topic}"))
```

##### Conversation Access Patterns
Access Nova Sonic conversation state using multiple approaches for compatibility:

```python
# Multiple conversation source checking
conversation_sources = [
    (session, '_chat_ctx'),
    (realtime_model, '_conversation'), 
    (realtime_model, '_chat_ctx'),
]

for source, attr_name in conversation_sources:
    if hasattr(source, attr_name):
        chat_ctx = getattr(source, attr_name)
        if chat_ctx and hasattr(chat_ctx, 'messages'):
            messages = getattr(chat_ctx, 'messages', [])
            # Process messages for web UI display
```

### 5. **Key Documentation Learnings**

This section consolidates critical insights from official LiveKit documentation that were successfully applied in production implementations.

#### Official Documentation Sources Applied
1. **[LiveKit Nova Sonic Integration](https://docs.livekit.io/agents/integrations/realtime/nova-sonic/)** - Official patterns
2. **[LiveKit Python RTC SDK](https://docs.livekit.io/reference/python/v1/livekit/rtc/index.html)** - Data publishing patterns  
3. **[LiveKit Node.js RTC SDK](https://docs.livekit.io/reference/client-sdk-node/)** - Event handling patterns
4. **LiveKit Comprehensive Guide** - Complete integration documentation

#### Simplified Agent Architecture (Nova Sonic Official Pattern)
The official Nova Sonic documentation emphasizes **simplicity over complexity**:

```python
# ✅ OFFICIAL PATTERN - Simple and effective
from livekit.plugins import aws

session = AgentSession(
    llm=aws.realtime.RealtimeModel(region="us-east-1"),
)

await session.start(agent, room=ctx.room)
```

**Key Insight**: Nova Sonic handles STT + LLM + TTS + VAD internally - no manual event handlers needed for basic functionality.

#### Data Publishing Best Practices (Python RTC SDK)
From the Python RTC documentation, proper data message formatting:

```python
# ✅ CORRECT - Encode as bytes with explicit parameters
await room.local_participant.publish_data(
    payload.encode('utf-8'),  # Always encode strings to bytes
    reliable=True,           # Ensure delivery for critical data
    topic="chat"             # Use topics for message organization
)

# ❌ AVOID - Raw strings without encoding
await room.local_participant.publish_data(payload, topic="chat")
```

#### Event Handler Patterns (Node.js RTC SDK)
Based on Node.js RTC documentation patterns for robust event handling:

```python
# ✅ STRUCTURED EVENT HANDLING
def setup_room_events(room):
    """Set up comprehensive room event monitoring"""
    
    def on_participant_connected(participant):
        logger.info(f"Participant joined: {participant.identity}")
        
    def on_participant_disconnected(participant, reason):
        logger.info(f"Participant left: {participant.identity} - {reason}")
        
    def on_data_received(payload, participant, topic):
        logger.debug(f"Data received on {topic} from {participant.identity}")
    
    room.on("participant_connected", on_participant_connected)
    room.on("participant_disconnected", on_participant_disconnected)
    room.on("data_received", on_data_received)
```

#### Integration Architecture Lessons
**Monorepo Structure** (Applied Successfully):
```
spashtai/
├── apps/
│   ├── web/          # React + LiveKit Components
│   ├── server/       # Express + LiveKit Server SDK
│   └── agent/        # Python + Nova Sonic Agent
├── docs/             # Comprehensive documentation
└── infra/            # Docker LiveKit deployment
```

**Technology Stack Validation**:
- ✅ **Frontend**: React + Vite + LiveKit Components + 21st.dev UI
- ✅ **Backend**: Node.js + Express + LiveKit Server SDK
- ✅ **Agent**: Python + LiveKit Agents + Nova Sonic
- ✅ **Real-time**: LiveKit Server (Docker) + Data Channels
- ✅ **AI**: AWS Nova Sonic (Bedrock) with built-in capabilities

#### Critical Implementation Patterns
**1. Agent Session Simplicity**
```python
# DON'T overcomplicate - Nova Sonic handles everything
agent = Agent(instructions="...", llm=realtime_model, tts=realtime_model)
session = AgentSession(llm=realtime_model)
await session.start(agent, room=ctx.room)
```

**2. Frontend Data Channel Robustness**
```typescript
// Use stable references to prevent re-initialization
const onAssistantRef = useRef(onAssistant)
const onUserRef = useRef(onUser)

useDataChannel({
  onMessage: useCallback((data, participant, topic) => {
    // Handle both string and ArrayBuffer data
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data)
    const parsed = JSON.parse(text)
    // Process message...
  }, [])
})
```

**3. Environment Configuration**
```env
# Critical environment variables for production
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret  
BEDROCK_REGION=us-east-1
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
```

#### Deployment Readiness Checklist
Based on comprehensive documentation implementation:

- ✅ **Containerized LiveKit Server** (Docker deployment ready)
- ✅ **AWS Nova Sonic Integration** (Production credentials configured)
- ✅ **Monorepo Build System** (Concurrent development workflows)
- ✅ **UI Component Library** (21st.dev + ShadCN for production UX)
- ✅ **Real-time Data Flow** (Bidirectional agent ↔ frontend communication)
- ✅ **Error Handling** (Graceful degradation and reconnection)

#### Official Transcription Topic Patterns (Applied Successfully)
Based on [AWS Realtime Documentation](https://docs.livekit.io/reference/python/v1/livekit/plugins/aws/experimental/realtime/index.html) and [LiveKit Text Agents](https://docs.livekit.io/agents/build/text/):

```python
# ✅ AGENT - Official transcription publishing
await ctx.room.local_participant.publish_data(
    payload.encode('utf-8'),
    reliable=True,  # Ensure delivery
    topic="lk.transcription"  # Official transcription topic
)

# ✅ FRONTEND - Official transcription listening  
useDataChannel({
  topic: 'lk.transcription', // Official transcription topic
  onMessage: useCallback((data, participant, topic) => {
    const parsed = JSON.parse(text) as { type?: string; text?: string }
    if (parsed?.type === 'assistant' && parsed.text) onAssistant(parsed.text)
    if (parsed?.type === 'user_transcript' && parsed.text) onUser(parsed.text)
  }, [])
})
```

#### AWS RealtimeSession Access Pattern (Production-Ready)
```python
# ✅ CORRECT - Access RealtimeSession chat context
if hasattr(session, '_llm') and hasattr(session._llm, '_chat_ctx'):
    aws_session = session._llm  # This is the RealtimeSession
    chat_ctx = aws_session._chat_ctx  # Official chat context access
    
    if chat_ctx and hasattr(chat_ctx, 'items') and chat_ctx.items:
        for item in chat_ctx.items[-2:]:
            role = getattr(item, 'role', 'unknown')
            content = getattr(item, 'content', '') or str(item)
            # Process and publish...
```

This integration successfully demonstrates how official LiveKit documentation patterns can be combined to create a production-ready voice AI application.

---

## Authentication & Security

### 1. **Access Tokens**

LiveKit uses **JWT tokens** for authentication:

```typescript
// Backend token generation
import { AccessToken } from 'livekit-server-sdk';

const token = new AccessToken(apiKey, apiSecret, {
  identity: 'user-123',
  name: 'John Doe'
});

token.addGrant({
  room: 'my-room',
  roomJoin: true,
  canPublish: true,
  canSubscribe: true
});

const jwt = token.toJwt();
```

### 2. **Permission Grants**

| Grant | Description |
|-------|-------------|
| `roomJoin` | Can join the room |
| `canPublish` | Can publish tracks |
| `canSubscribe` | Can subscribe to tracks |
| `canPublishData` | Can send data messages |
| `hidden` | Participant not visible to others |
| `recorder` | Can record the session |

### 3. **Security Best Practices**

- **Never expose API keys** in frontend code
- **Generate tokens server-side** only
- **Set appropriate token expiration** (recommended: 1-24 hours)
- **Use HTTPS/WSS** in production
- **Validate participant identity** server-side

---

## Server APIs

### 1. **Room Management**

```typescript
import { RoomServiceClient } from 'livekit-server-sdk';

const client = new RoomServiceClient(serverUrl, apiKey, apiSecret);

// Create room
await client.createRoom({
  name: 'interview-123',
  maxParticipants: 5,
  metadata: JSON.stringify({ type: 'interview' })
});

// List rooms
const rooms = await client.listRooms();

// Delete room
await client.deleteRoom('interview-123');
```

### 2. **Participant Management**

```typescript
// Get participants in room
const participants = await client.listParticipants('room-name');

// Remove participant
await client.removeParticipant('room-name', 'participant-identity');

// Update participant metadata
await client.updateParticipant('room-name', 'participant-id', {
  metadata: JSON.stringify({ role: 'interviewer' })
});
```

### 3. **Webhooks**

LiveKit sends webhooks for important events:

```typescript
// Webhook handler (Express.js)
app.post('/livekit-webhook', (req, res) => {
  const event = req.body;
  
  switch (event.event) {
    case 'room_started':
      console.log('Room started:', event.room);
      break;
    case 'room_finished':
      console.log('Room ended:', event.room);
      break;
    case 'participant_joined':
      console.log('Participant joined:', event.participant);
      break;
    case 'participant_left':
      console.log('Participant left:', event.participant);
      break;
  }
  
  res.status(200).send('OK');
});
```

---

## Recording & Export

### 1. **Recording Types**

#### Composite Recording
- **Single video file** with all participants
- **Customizable layout** (grid, speaker focus, etc.)
- **Automated recording** triggers

#### Individual Track Recording
- **Separate files** for each participant
- **Audio-only or video** options
- **Post-processing flexibility**

#### Web Recording  
- **Browser-based recording**
- **Custom HTML templates**
- **Real-time preview**

### 2. **Egress API**

```typescript
import { EgressClient, EncodedFileOutput } from 'livekit-server-sdk';

const egressClient = new EgressClient(serverUrl, apiKey, apiSecret);

// Start room composite recording
await egressClient.startRoomCompositeEgress('room-name', {
  file: {
    fileType: 'MP4',
    filepath: '/recordings/session-123.mp4'
  },
  layout: 'grid-light'
});
```

### 3. **Auto Egress**

Configure automatic recording based on room events:

```yaml
# egress.yaml
auto_egress:
  room_composite:
    enabled: true
    layout: "speaker-light"
    file_outputs:
      - filepath: "/recordings/{room_name}-{time}.mp4"
        file_type: MP4
```

---

## LiveKit Cloud vs Self-Hosting

### 1. **LiveKit Cloud**

#### Advantages:
- **Global infrastructure** with edge locations
- **Auto-scaling** based on demand
- **Built-in monitoring** and analytics
- **Enhanced noise cancellation**
- **Managed updates** and security patches

#### Pricing Model:
- **Pay-per-use** based on participant minutes
- **Region pinning** for data locality
- **Quotas and limits** management

### 2. **Self-Hosting**

#### Deployment Options:

##### Docker (Development)
```bash
docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp \
  livekit/livekit-server --dev --bind 0.0.0.0
```

##### Kubernetes (Production)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: livekit-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: livekit-server
  template:
    metadata:
      labels:
        app: livekit-server
    spec:
      containers:
      - name: livekit-server
        image: livekit/livekit-server:latest
        ports:
        - containerPort: 7880
        - containerPort: 7881
        - containerPort: 7882
```

##### Virtual Machine
- **Single VM** for small deployments
- **Multi-region setup** for global coverage
- **Load balancing** configuration

#### Configuration Management:
```yaml
# livekit.yaml
port: 7880
bind_addresses:
  - 0.0.0.0
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 60000
redis:
  address: redis:6379
keys:
  ABCDEFG123456789: secret-key-here
```

---

## Platform-Specific Implementation

### 1. **Web (React/JavaScript)**

#### Essential Components:
```typescript
import { 
  LiveKitRoom, 
  RoomAudioRenderer, 
  useConnectionState, 
  useRoomContext,
  useDataChannel,
  useTracks
} from '@livekit/components-react';

function InterviewRoom() {
  const connectionState = useConnectionState();
  const room = useRoomContext();
  
  useDataChannel({
    onMessage: (data, participant, topic) => {
      // Handle data messages
    }
  });
  
  return (
    <div>
      <p>Status: {connectionState}</p>
      <RoomAudioRenderer />
      {/* Your custom UI */}
    </div>
  );
}
```

### 2. **Mobile (React Native)**

```typescript
import { LiveKitRoom, useRoom } from '@livekit/react-native';

function MobileRoom() {
  const room = useRoom();
  
  useEffect(() => {
    room.localParticipant.enableCameraAndMicrophone();
  }, []);
  
  return (
    <LiveKitRoom 
      serverUrl="wss://your-server.com"
      token={token}
    >
      {/* Mobile-specific UI */}
    </LiveKitRoom>
  );
}
```

### 3. **Flutter**

```dart
import 'package:livekit_client/livekit_client.dart';

class FlutterRoom extends StatefulWidget {
  @override
  _FlutterRoomState createState() => _FlutterRoomState();
}

class _FlutterRoomState extends State<FlutterRoom> {
  Room? _room;
  
  @override
  void initState() {
    super.initState();
    _connectToRoom();
  }
  
  void _connectToRoom() async {
    _room = Room();
    await _room!.connect(serverUrl, token);
  }
}
```

---

## Advanced Features

### 1. **Stream Import**

Import external streams into LiveKit rooms:

```typescript
// RTMP Stream Import
await ingressClient.createIngress({
  inputType: 'RTMP_INPUT',
  name: 'external-stream',
  roomName: 'target-room',
  participantName: 'stream-participant'
});
```

### 2. **SIP Integration (Telephony)**

Connect traditional phone systems:

```yaml
# SIP configuration
sip:
  inbound:
    - trunk: "sip-trunk-1"
      numbers: ["+1234567890"]
      room_pattern: "phone-{number}"
  outbound:
    - trunk: "outbound-trunk"
      rule: ".*"
```

### 3. **Enhanced Noise Cancellation**

AI-powered noise reduction (LiveKit Cloud feature):

```typescript
// Enable in room creation
await client.createRoom({
  name: 'quiet-room',
  metadata: JSON.stringify({
    enhancedNoiseSupp: true
  })
});
```

### 4. **Analytics & Monitoring**

```typescript
// Analytics API (LiveKit Cloud)
const analytics = await client.listRoomStats({
  room: 'room-name',
  startTime: Date.now() - 3600000 // Last hour
});
```

---

## Best Practices & Patterns

### 1. **Connection Management**

```typescript
// Robust connection handling
const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  reconnectPolicy: {
    maxRetries: 3,
    retryDelayMs: 1000
  }
});

room.on(RoomEvent.Reconnecting, () => {
  showReconnectingUI();
});

room.on(RoomEvent.Reconnected, () => {
  hideReconnectingUI();
});
```

### 2. **Error Handling**

```typescript
try {
  await room.connect(serverUrl, token);
} catch (error) {
  if (error.code === 'TokenExpired') {
    // Refresh token and retry
    const newToken = await refreshToken();
    await room.connect(serverUrl, newToken);
  } else {
    // Handle other connection errors
    showErrorMessage(error.message);
  }
}
```

### 3. **Resource Management**

```typescript
// Cleanup on component unmount
useEffect(() => {
  return () => {
    room?.disconnect();
    // Clean up tracks, listeners, etc.
  };
}, []);
```

### 4. **Performance Optimization**

#### Audio Quality Settings:
```typescript
// Optimize for voice
room.localParticipant.publishTrack(audioTrack, {
  source: Track.Source.Microphone,
  audioBitrate: 32000, // 32kbps for voice
  dtx: true, // Discontinuous transmission
});
```

#### Bandwidth Management:
```typescript
// Adaptive streaming
room.setAdaptiveStreamSettings({
  pixelDensity: 'high',
  videoQuality: 'high'
});
```

### 5. **Data Channel Best Practices**

```typescript
// Efficient data publishing
const publishChatMessage = async (message: string) => {
  const payload = {
    type: 'chat',
    message,
    timestamp: Date.now()
  };
  
  await room.localParticipant.publishData(
    JSON.stringify(payload),
    { 
      topic: 'chat',
      reliable: true // For important messages
    }
  );
};

// Batch data updates
const batchUpdates = [];
// ... collect updates
if (batchUpdates.length > 0) {
  await room.localParticipant.publishData(
    JSON.stringify({ type: 'batch', updates: batchUpdates }),
    { topic: 'updates' }
  );
}
```

---

## Common Patterns for Voice AI Applications

### 1. **Interview/Conversation Pattern**

```typescript
// Frontend
function InterviewSession() {
  const [isRecording, setIsRecording] = useState(false);
  const [conversation, setConversation] = useState([]);
  
  useDataChannel({
    onMessage: (data, participant) => {
      const message = JSON.parse(new TextDecoder().decode(data));
      if (message.type === 'transcript') {
        setConversation(prev => [...prev, message]);
      }
    }
  });
  
  return (
    <LiveKitRoom token={token} serverUrl={serverUrl}>
      <ConversationDisplay messages={conversation} />
      <AudioControls 
        isRecording={isRecording}
        onToggleRecording={() => setIsRecording(!isRecording)}
      />
    </LiveKitRoom>
  );
}
```

```python
# Python Agent
@session.on("user_speech_committed")
async def on_user_speech(event):
    transcript = event.transcript
    
    # Publish transcript to UI
    await ctx.room.local_participant.publish_data(
        json.dumps({
            "type": "transcript",
            "role": "user", 
            "text": transcript
        }),
        topic="conversation"
    )

@session.on("agent_speech_committed")
async def on_agent_speech(event):
    response = event.text
    
    # Publish response to UI
    await ctx.room.local_participant.publish_data(
        json.dumps({
            "type": "transcript",
            "role": "assistant",
            "text": response
        }),
        topic="conversation"
    )
```

### 2. **Multi-Agent Pattern**

```python
# Multiple specialized agents
class InterviewerAgent:
    def __init__(self):
        self.agent = Agent(
            instructions="You are an interviewer...",
            llm=OpenAI(model="gpt-4")
        )

class AssistantAgent:
    def __init__(self):
        self.agent = Agent(
            instructions="You provide helpful context...",
            llm=OpenAI(model="gpt-3.5-turbo")
        )

# Route based on context or user command
async def route_to_agent(user_input: str):
    if "interview" in user_input.lower():
        return interviewer_agent
    else:
        return assistant_agent
```

### 3. **Session Management Pattern**

```typescript
// Session state management
interface SessionState {
  status: 'waiting' | 'active' | 'paused' | 'completed';
  participants: Participant[];
  startTime?: Date;
  duration?: number;
  transcript: Message[];
}

function useSessionState() {
  const [session, setSession] = useState<SessionState>({
    status: 'waiting',
    participants: [],
    transcript: []
  });
  
  const startSession = () => {
    setSession(prev => ({
      ...prev,
      status: 'active',
      startTime: new Date()
    }));
  };
  
  const endSession = () => {
    setSession(prev => ({
      ...prev,
      status: 'completed',
      duration: Date.now() - (prev.startTime?.getTime() || 0)
    }));
  };
  
  return { session, startSession, endSession };
}
```

---

## Troubleshooting & Debugging

### 1. **Common Issues**

#### Connection Problems:
- **Token expired**: Refresh tokens regularly
- **Network issues**: Implement retry logic
- **Firewall blocking**: Check UDP ports (50000-60000)

#### Audio Issues:
- **No audio**: Check microphone permissions
- **Echo**: Implement echo cancellation
- **Latency**: Optimize buffer sizes

#### Data Channel Issues:
- **Messages not received**: Check topic matching
- **Large payloads**: Split into smaller chunks
- **Ordering**: Use reliable channels for important data

### 2. **Debugging Tools**

```typescript
// Enable debug logging
import { setLogLevel, LogLevel } from 'livekit-client';
setLogLevel(LogLevel.debug);

// Room stats
room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
  console.log(`Connection quality: ${quality} for ${participant?.identity}`);
});
```

### 3. **Performance Monitoring**

```typescript
// Track metrics
const trackStats = async () => {
  const stats = await room.engine.getConnectedServerAddress();
  console.log('Server address:', stats);
  
  const quality = room.engine.getConnectionQuality();
  console.log('Connection quality:', quality);
};
```

---

### Managing Media Tracks & Reconnection Logic

LiveKit’s documentation emphasises treating media track publishing as an event-driven workflow so downstream subscribers can recover gracefully when a publisher restarts. Key points pulled from the **Managing Media Tracks** and **Reconnection Logic** sections (docs.livekit.io):

- **Detect publisher restarts:**
  - Listen for `RoomEvent.TrackUnpublished` and `RoomEvent.TrackPublished` to know when the agent tears down or republishes audio.
  - The `Track` API (JS SDK) exposes `track.addListener('ended', ...)` for detecting stream failures on the publisher side.
- **Automatic reconnection:**
  - LiveKit handles network reconnection at the transport layer, but external audio sources (like Nova Sonic) must be re-attached when the new track comes online.
  - Use the SDK’s `connectionState` and `ParticipantEvent.TrackSubscribed` to re-enable playback.
- **Data channel coordination:**
  - Publish a control message (e.g., topic `lk.control`) whenever the agent restarts so clients can reset local state.

**Frontend JS snippet (from docs, adapted):**
```typescript
room.on(RoomEvent.TrackUnpublished, ({ track }) => {
  if (track.kind === Track.Kind.Audio) {
    detachAudioRenderer();
  }
});

room.on(RoomEvent.TrackPublished, ({ publication }) => {
  if (publication.kind === Track.Kind.Audio) {
    publication.setSubscribed(true);
  }
});

room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === Track.Kind.Audio) {
    attachAudioRenderer(track);
  }
});
```

This same pattern appears in LiveKit recipes where external media is republished (see voice agent examples). The JS SDK will automatically request the new track version; calling `publication.setSubscribed(true)` ensures the remote audio resumes once LiveKit signals the new track.

---

### Nova Sonic Agent Restarts

Nova Sonic’s realtime API can emit transient 5xx errors (`ModelStreamErrorException`, `Invalid event bytes`).

Our production pattern:

1. Treat AWS exceptions as recoverable: close the `AgentSession`, sleep briefly, and launch a fresh session automatically. Application code doesn’t require manual intervention.
2. Publish status changes on `lk.control` (`session_state`: restarting → recovering → ready). Frontend uses this to show assistant health and reset local buffers.
3. When the agent restarts, it republishes audio. Clients listen for `TrackUnpublished/TrackPublished/TrackSubscribed` to detach and reattach audio renderers so playback resumes seamlessly.

This mirrors LiveKit’s guidance: reconnection is automatic at the transport layer, but external media (AWS Nova Sonic) must be re-bound when the publisher reintroduces tracks.

---

## Conclusion

This comprehensive guide covers all major aspects of LiveKit for building real-time voice, video, and AI applications. Key takeaways:

1. **Start Simple**: Use LiveKit Cloud for rapid prototyping
2. **Event-Driven Architecture**: Leverage LiveKit's robust event system
3. **Proper Authentication**: Always generate tokens server-side
4. **Error Handling**: Implement comprehensive error handling and reconnection logic
5. **Performance**: Optimize for your specific use case (voice vs video vs data)
6. **Scalability**: Plan for growth with proper architecture decisions

For our SpashtAI project specifically, we're leveraging:
- **LiveKit Agents** for AI voice interactions
- **AWS Nova Sonic** for real-time speech processing
- **Data channels** for transcript display
- **React components** for seamless UI integration

This foundation provides everything needed to build sophisticated real-time AI applications with LiveKit.

---

**Next Steps for Implementation:**
1. Review current agent implementation against best practices
2. Implement proper error handling and reconnection logic
3. Add comprehensive logging and monitoring
4. Optimize for production deployment
5. Add advanced features like recording and analytics

