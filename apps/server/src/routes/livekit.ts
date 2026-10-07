import type { Request, Response } from 'express'
import { AccessToken, RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk'
import { prisma } from '../lib/prisma'
import { resolveLivekitAccess } from '../lib/livekitAccess'
import { logger, reqLog } from '../lib/logger'

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
    logger.warn({ err: err }, 'voice-config lookup failed, using nova-sonic fallback:')
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
    hushEnabled: false,
  } as const
}

type TurnDetection = 'HIGH' | 'MEDIUM' | 'LOW' | 'EXTRA'

function normalizeTurnDetection(value?: string): TurnDetection {
  const level = (value || 'MEDIUM').toUpperCase()
  if (level === 'HIGH' || level === 'LOW' || level === 'EXTRA') return level
  return 'MEDIUM'
}

function parseRoomMetadata(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeHushEnabled(value: unknown): boolean {
  return value === true || (typeof value === 'string' && ['1', 'true', 'yes'].includes(value.trim().toLowerCase()))
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
    const { room: requestedRoom, sessionId, segmentId, turnDetection } = req.query as Record<string, string | undefined>
    const access = await resolveLivekitAccess(req, { room: requestedRoom, sessionId, segmentId })
    if ('error' in access) return res.status(access.status ?? 500).json({ error: access.error })
    const { session, identity } = access
    const room = access.segment.roomName
    const userName = session.user.firstName || session.user.email.split('@')[0]
    // The agent's metadata contract treats absent keys as empty. Saved
    // sessions store empty values as null, so omit them rather than sending null.
    const focusArea = session.focusArea ?? undefined
    const focusContext = session.focusContext ?? undefined
    const sessionName = session.sessionName ?? undefined
    const boothDemo = session.focusArea === 'snapshot' ? '1' : undefined

    const { apiKey, apiSecret, lkUrl, httpUrl } = getLivekitConfig()
    if (!apiKey || !apiSecret || !lkUrl) {
      return res.status(500).json({ error: 'LiveKit env not configured' })
    }

    console.log(`Generating token for identity: ${identity}, room: ${room}`)

    // Look up the active voice backend so the agent worker uses the right model.
    const voiceCfg = await getActiveVoiceConfig()

    // Create the room first to ensure agent can join
    const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret)
    const roomMeta: Record<string, string | boolean | undefined | null> = {
      sessionId,
      segmentId,
      userName,
      focusArea,
      focusContext,
      sessionName,
      boothDemo:
        boothDemo === '1' || boothDemo === 'true' || boothDemo === 'yes' ? '1' : undefined,
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
      // This is resolved once for a new room. The agent reads it at session
      // start; changing the admin switch never mutates an active session.
      hushEnabled: voiceCfg.backend === 'pipeline-bedrock' && voiceCfg.hushEnabled === true,
      turnDetection: normalizeTurnDetection(turnDetection),
    }
    try {
      const rooms = await roomService.listRooms([room])
      if (rooms.length) throw new Error('room already exists')
      const created = await roomService.createRoom({
        name: room,
        emptyTimeout: 60 * 10, // 10 minutes
        metadata: JSON.stringify(roomMeta),
      })
      // createRoom can return an existing room during a concurrent creation.
      const createdMeta = parseRoomMetadata(created.metadata)
      if (createdMeta.sessionId !== sessionId || createdMeta.segmentId !== segmentId) {
        return res.status(409).json({ error: 'Room belongs to another activity' })
      }
      console.log(`✅ Room ${room} created (voice backend: ${voiceCfg.backend})`)
    } catch (roomError: any) {
      const msg = roomError?.message || String(roomError)
      if (msg.includes('already exists')) {
        try {
          // Preserve the Hush decision made at room creation.  A token refresh
          // for an active room must never turn cleanup on/off mid-session.
          // If the existing room predates this flag, leave it absent; the agent
          // safely interprets that as disabled.
          const existingRoom = (await roomService.listRooms([room]))[0]
          if (!existingRoom) {
            throw new Error('existing room could not be read')
          }
          const existingMeta = parseRoomMetadata(existingRoom.metadata)
          if (existingMeta.sessionId !== sessionId || existingMeta.segmentId !== segmentId) {
            return res.status(409).json({ error: 'Room belongs to another activity' })
          }
          if (Object.prototype.hasOwnProperty.call(existingMeta, 'hushEnabled')) {
            roomMeta.hushEnabled = normalizeHushEnabled(existingMeta.hushEnabled)
          } else {
            delete roomMeta.hushEnabled
          }
          await roomService.updateRoomMetadata(room, JSON.stringify(roomMeta))
          console.log(`✅ Room ${room} metadata updated; Hush setting preserved`)
        } catch (metaErr: any) {
          logger.warn({ err: metaErr }, 'Existing room could not be verified')
          return res.status(503).json({ error: 'Unable to verify live room' })
        }
      } else {
        return res.status(503).json({ error: 'Unable to create live room' })
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
    reqLog(req).info(
      {
        event: 'livekit.token_issued',
        room,
        sessionId,
        voiceBackend: voiceCfg.backend,
        hushRequested: roomMeta.hushEnabled === true,
      },
      'livekit token issued',
    )
    res.json({ token, url: lkUrl })
  } catch (error) {
    logger.error({ err: error }, '❌ Error generating LiveKit token:')
    res.status(500).json({ error: 'Failed to generate token' })
  }
}

export async function dispatchAgent(req: Request, res: Response) {
  try {
    const { room, sessionId, segmentId } = req.body as { room?: string; sessionId?: string; segmentId?: string }
    const access = await resolveLivekitAccess(req, { room, sessionId, segmentId })
    if ('error' in access) return res.status(access.status ?? 500).json({ error: access.error })

    const { apiKey, apiSecret, httpUrl } = getLivekitConfig()
    if (!apiKey || !apiSecret || !httpUrl) {
      return res.status(500).json({ error: 'LiveKit env not configured' })
    }

    const roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret)
    const existing = (await roomService.listRooms([room!]))[0]
    const metadata = parseRoomMetadata(existing?.metadata)
    if (metadata.sessionId !== sessionId || metadata.segmentId !== segmentId) {
      return res.status(409).json({ error: 'Room belongs to another activity' })
    }

    console.log(`🤖 Dispatching agent to room: ${room}`)
    const agentClient = new AgentDispatchClient(httpUrl, apiKey, apiSecret)
    // createDispatch(roomName, agentName, options)
    const dispatches = await agentClient.listDispatch(room!)
    if (hasActiveDispatchJobs(dispatches as any[])) return res.json({ alreadyActive: true })
    const dispatch = await agentClient.createDispatch(room!, '', { metadata: JSON.stringify({ sessionId }) })
    console.log(`✅ Agent dispatched:`, dispatch)
    
    res.json({ success: true, dispatch })
  } catch (error: any) {
    logger.error({ err: error }, '❌ Error dispatching agent:')
    res.status(500).json({ error: 'Failed to dispatch agent', details: error.message })
  }
}
