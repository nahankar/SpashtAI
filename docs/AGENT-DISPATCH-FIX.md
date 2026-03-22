# Agent Not Dispatching - Root Cause & Fix

## Problem
Agent worker registers successfully but **NEVER receives job dispatch** when users join rooms.

## Root Cause
After extensive debugging and LiveKit log analysis:

1. ✅ Agent worker registers: `worker registered {"agentName": "spashtai-assistant"}`
2. ✅ User connects to room with token containing `RoomAgentDispatch`
3. ❌ **Agent is NEVER dispatched** - no "Agent received job request" logs

**The Issue**: LiveKit's explicit agent dispatch requires **TWO steps**:
- Token specifies WHICH agent to use (`RoomAgentDispatch` in token)
- **Server must explicitly dispatch the agent via API call**

The token alone does NOT trigger automatic dispatch!

## Solution Options

### Option A: Use Automatic Dispatch (Recommended for MVP)
Remove explicit dispatch, let agent join ALL rooms automatically.

**Backend Change** (`apps/server/src/routes/livekit.ts`):
```typescript
// REMOVE this entire RoomAgentDispatch code:
const { RoomAgentDispatch, RoomConfiguration } = await import('@livekit/protocol')

at.roomConfig = new RoomConfiguration({
  agents: [
    new RoomAgentDispatch({
      agentName: "spashtai-assistant",
      metadata: JSON.stringify({ ... })
    })
  ]
})
```

**Agent stays the same** - automatic dispatch works with current agent code.

### Option B: Fix Explicit Dispatch (For Production)
Keep explicit dispatch but add API call to actually dispatch the agent.

**Backend Change** (`apps/server/src/routes/livekit.ts`):
```typescript
import { RoomServiceClient } from 'livekit-server-sdk'

export async function getLivekitToken(req: Request, res: Response) {
  // ... existing token generation ...
  
  // AFTER generating token, dispatch the agent:
  const roomService = new RoomServiceClient(lkUrl, apiKey, apiSecret)
  
  try {
    await roomService.createRoom({
      name: room as string,
    })
    
    // Explicitly dispatch agent to this room
    await roomService.createRoomAgentDispatch({
      room: room as string,
      agentName: 'spashtai-assistant',
      metadata: JSON.stringify({
        userId: identity,
        sessionId: sessionId || `session_${Date.now()}`
      })
    })
    
    console.log('✅ Agent dispatched to room:', room)
  } catch (error) {
    console.warn('⚠️ Agent dispatch failed (room may exist):', error)
  }
  
  const token = await at.toJwt()
  res.json({ token, url: lkUrl })
}
```

## Why This Happens

From LiveKit documentation and logs:

1. **Token with `RoomAgentDispatch`** tells LiveKit "this room needs this agent"
2. **But** LiveKit still waits for an explicit dispatch API call
3. Without the API call, the agent worker just sits idle

The confusion comes from:
- Documentation shows `RoomAgentDispatch` in tokens
- But doesn't emphasize that you STILL need the API call
- Only automatic dispatch works "token-only"

## Recommended Approach

**For MVP/Development**: Use Option A (automatic dispatch)
- Simpler code
- Agent joins all rooms automatically
- No API calls needed
- Easy to test

**For Production**: Use Option B (explicit dispatch with API)
- Control which rooms get agents
- Better resource management
- Pass metadata to agents
- Scale better with multiple agent types

## Testing

After implementing Option A or B:

1. Start all services (LiveKit, backend, agent, frontend)
2. Join a room
3. **Check agent logs** - should see:
   ```
   INFO:spashtai-agent:🚀 Agent received job request for room: dev
   INFO:spashtai-agent:✅ Session started - agent is now listening and ready to speak
   ```
4. **Speak into microphone** - agent should respond!

## Current Status

- ✅ All services running correctly
- ✅ Agent code fixed (official LiveKit pattern)
- ✅ LiveKit server configured
- ❌ **Agent dispatch not implemented** ← FIX THIS NEXT

Choose Option A or B and implement the backend change!
