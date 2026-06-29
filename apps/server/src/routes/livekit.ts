import type { Request, Response } from 'express'
import { AccessToken, RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk'
import { prisma } from '../lib/prisma'

function getLivekitConfig() {
  const apiKey = process.env.LIVEKIT_API_KEY
  const apiSecret = process.env.LIVEKIT_API_SECRET
  // Public URL returned to browsers (wss://livekit.spasht.ai)
  const lkUrl = process.env.LIVEKIT_URL
  // Server-side SDK calls — use internal docker URL on EC2 when set
  const lkInternalUrl = process.env.LIVEKIT_INTERNAL_URL || lkUrl
  const httpUrl =
    lkInternalUrl?.replace('ws://', 'http://').replace('wss://', 'https://') || ''
  return { apiKey, apiSecret, lkUrl, httpUrl }
}

// Fetch the currently active VoiceConfig (or fall back to nova-sonic defaults).
// Embedded in room metadata so the agent worker picks the right backend.
async function getActiveVoiceConfig() {
  try {
    const active = await prisma.voiceConfig.findFirst({ where: { isActive: true } })
    if (active) return active
  } catch (err) {
    console.warn('voice-config lookup failed, using nova-sonic fallback:', err)
  }
  return {
    backend: 'nova-sonic',
    voiceName: 'tiffany',
    sttProvider: null,
    ttsProvider: null,
    pipelineStt: null,
    pipelineLlm: null,
    pipelineTts: null,
    sttBaseUrl: null,
    llmBaseUrl: null,
    ttsBaseUrl: null,
  } as const
}

type TurnDetection = 'HIGH' | 'MEDIUM' | 'LOW' | 'EXTRA'

function normalizeTurnDetection(value?: string): TurnDetection {
  const level = (value || 'MEDIUM').toUpperCase()
  if (level === 'HIGH' || level === 'LOW' || level === 'EXTRA') return level
  return 'MEDIUM'
}

function hasActiveDispatchJobs(dispatches: any[] | undefined): boolean {
  if (!dispatches || dispatches.length === 0) return false
  return dispatches.some((dispatch) => {
    const jobs = (dispatch as any)?.state?.jobs
    return Array.isArray(jobs) && jobs.length > 0
  })
}

export async function getLivekitToken(req: Request, res: Response) {
  try {
    const {
      identity,
      room,
      sessionId,
      userName,
      focusArea,
      focusContext,
      sessionName,
      turnDetection,
    } = req.query as Record<string, string | undefined>
    if (!identity || !room) {
      return res.status(400).json({ error: 'identity and room are required' })
    }

    const { apiKey, apiSecret, lkUrl, httpUrl } = getLivekitConfig()
    if (!apiKey || !apiSecret || !lkUrl) {
      return res.status(500).json({ error: 'LiveKit env not configured' })
    }

    console.log(`Generating token for identity: ${identity}, room: ${room}`)

    // Look up the active voice backend so the agent worker uses the right model.
    const voiceCfg = await getActiveVoiceConfig()

    // Create the room first to ensure agent can join
    const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret)
    const roomMeta: Record<string, string | undefined | null> = {
      sessionId,
      userName,
      focusArea,
      focusContext,
      sessionName,
      // Voice backend selection (read by apps/agent/main.py via voice_backends.build_session)
      voiceBackend: voiceCfg.backend,
      voiceName: voiceCfg.voiceName ?? undefined,
      sttProvider: voiceCfg.sttProvider ?? undefined,
      ttsProvider: voiceCfg.ttsProvider ?? undefined,
      pipelineStt: voiceCfg.pipelineStt ?? undefined,
      pipelineLlm: voiceCfg.pipelineLlm ?? undefined,
      pipelineTts: voiceCfg.pipelineTts ?? undefined,
      sttBaseUrl: voiceCfg.sttBaseUrl ?? undefined,
      llmBaseUrl: voiceCfg.llmBaseUrl ?? undefined,
      ttsBaseUrl: voiceCfg.ttsBaseUrl ?? undefined,
      turnDetection: normalizeTurnDetection(turnDetection),
    }
    try {
      await roomService.createRoom({
        name: room,
        emptyTimeout: 60 * 10, // 10 minutes
        metadata: JSON.stringify(roomMeta),
      })
      console.log(`✅ Room ${room} created (voice backend: ${voiceCfg.backend})`)
    } catch (roomError: any) {
      const msg = roomError?.message || String(roomError)
      if (msg.includes('already exists')) {
        try {
          await roomService.updateRoomMetadata(room, JSON.stringify(roomMeta))
          console.log(`✅ Room ${room} metadata updated (voice backend: ${voiceCfg.backend})`)
        } catch (metaErr: any) {
          console.log(`ℹ️ Room metadata update failed: ${metaErr?.message || metaErr}`)
        }
      } else {
        console.log(`ℹ️ Room creation note: ${msg}`)
      }
    }

    // By default rely on LiveKit Agent Worker automatic dispatch.
    // Manual dispatch can be enabled via LIVEKIT_MANUAL_DISPATCH=true for environments
    // that do not use automatic dispatch.
    const manualDispatchEnabled = process.env.LIVEKIT_MANUAL_DISPATCH === 'true'
    if (manualDispatchEnabled) {
      try {
        const agentClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret)
        const existingDispatches = await agentClient.listDispatch(room)

        const activeJobExists = hasActiveDispatchJobs(existingDispatches as any[])
        if (activeJobExists) {
          console.log(`ℹ️ Agent already active in room ${room}; skipping new dispatch`)
        } else {
          await agentClient.createDispatch(room, '', {
            metadata: JSON.stringify({ sessionId })
          })
          const staleCount = existingDispatches?.length || 0
          if (staleCount > 0) {
            console.log(`♻️ Created fresh dispatch for room ${room} (ignored ${staleCount} stale dispatch record(s))`)
          } else {
            console.log(`✅ Agent dispatched to room ${room}`)
          }
        }
      } catch (dispatchError: any) {
        console.log(`ℹ️ Agent dispatch note: ${dispatchError.message}`)
      }
    } else {
      console.log(`ℹ️ Using automatic agent dispatch for room ${room}`)
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity,
    })
    at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true })
    
    const token = await at.toJwt()
    console.log('✅ Token generated successfully')
    res.json({ token, url: lkUrl })
  } catch (error) {
    console.error('❌ Error generating LiveKit token:', error)
    res.status(500).json({ error: 'Failed to generate token' })
  }
}

export async function dispatchAgent(req: Request, res: Response) {
  try {
    const { room } = req.body as { room?: string }
    if (!room) {
      return res.status(400).json({ error: 'room is required' })
    }

    const { apiKey, apiSecret, httpUrl } = getLivekitConfig()
    if (!apiKey || !apiSecret || !httpUrl) {
      return res.status(500).json({ error: 'LiveKit env not configured' })
    }

    console.log(`🤖 Dispatching agent to room: ${room}`)
    const agentClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret)
    // createDispatch(roomName, agentName, options)
    const dispatch = await agentClient.createDispatch(room, '', {})
    console.log(`✅ Agent dispatched:`, dispatch)
    
    res.json({ success: true, dispatch })
  } catch (error: any) {
    console.error('❌ Error dispatching agent:', error)
    res.status(500).json({ error: 'Failed to dispatch agent', details: error.message })
  }
}

