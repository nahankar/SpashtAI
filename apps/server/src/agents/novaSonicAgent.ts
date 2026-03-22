// Placeholder file for a Nova Sonic agent integration.
// Recommended approach per LiveKit guide is to use the LiveKit Agents SDK with AWS plugin.
// See: https://docs.livekit.io/agents/integrations/realtime/nova-sonic/

export const NOVASONIC_AGENT_README = `
Use a LiveKit Agent (Python) to bridge your LiveKit room audio with Amazon Nova Sonic (Bedrock):

1) Create \`apps/agent\` with a Python venv and install deps:
   - livekit-agents
   - livekit-plugins-aws[realtime]
   - python-dotenv

2) The agent should:
   - Connect to the same LiveKit room as the user
   - Subscribe to user's microphone track
   - Stream audio to Nova Sonic bidirectionally
   - Publish TTS back into the room
   - Send partial/final transcripts via LiveKit data messages (JSON: { type: "assistant" | "partial" | "final", text })

3) Environment needed (can reuse apps/server/.env):
   - LIVEKIT_URL (wss/wss)
   - LIVEKIT_API_KEY / LIVEKIT_API_SECRET
   - AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION
   - BEDROCK_REGION
   - BEDROCK_NOVASONIC_MODEL_ID
`;
