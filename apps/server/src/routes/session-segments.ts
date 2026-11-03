import type { Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { isPrivilegedRole } from '../lib/userExportFlags'
import { currentDataScope } from '../lib/dataScope'
import { reserveWorkspaceVoiceSlot } from '../workspaces/quotas'
import { WorkspaceError } from '../workspaces/contracts'
import { releaseLivekitRooms } from '../lib/livekitRooms'
import {
  activeSegmentDurationSec,
  mergeSegmentAudioStatus,
} from '../analytics/sessionSegments'
import {
  lockWritableSession,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'

const AUDIO_STATUSES = new Set(['pending', 'available', 'failed', 'unavailable'])

async function ownedSession(req: Request, sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, userId: true, endedAt: true },
  })
  if (!session) return { status: 404 as const, error: 'Session not found' }
  if (
    req.user &&
    !isPrivilegedRole(req.user.role) &&
    session.userId !== req.user.userId
  ) {
    return { status: 403 as const, error: 'Access denied' }
  }
  return { session }
}

/** Matches `workspace_open_voice_segments`: a slot is live only if updated within 6 hours. */
const VOICE_STALE_MS = 6 * 60 * 60 * 1000

async function closeOpenSegments(
  tx: Prisma.TransactionClient,
  leftover: Array<{ id: string; startedAt: Date; audioStatus: string; roomName: string }>,
  endedAt: Date,
  audio: 'abandon' | 'keep',
): Promise<string[]> {
  const rooms: string[] = []
  for (const open of leftover) {
    rooms.push(open.roomName)
    await tx.sessionSegment.update({
      where: { id: open.id },
      data: {
        endedAt,
        activeDurationSec: activeSegmentDurationSec(open.startedAt, endedAt),
        audioStatus:
          audio === 'abandon' && open.audioStatus === 'pending' ? 'unavailable' : open.audioStatus,
      },
    })
  }
  return rooms
}

/**
 * Same-learner leftovers occupy the org voice slot after refresh. Close only
 * stale segments, or recently updated ones after an explicit takeover.
 */
async function claimOwnWorkspaceVoiceSlot(
  tx: Prisma.TransactionClient,
  userId: string,
  exceptSessionId: string,
  endedAt: Date,
  takeover: boolean,
): Promise<string[]> {
  if (!currentDataScope()) return []
  const leftover = await tx.sessionSegment.findMany({
    where: {
      endedAt: null,
      session: {
        id: { not: exceptSessionId },
        userId,
        endedAt: null,
        discardedAt: null,
      },
    },
    select: { id: true, sessionId: true, startedAt: true, updatedAt: true, audioStatus: true, roomName: true },
  })
  const stale = leftover.filter(open => endedAt.getTime() - open.updatedAt.getTime() >= VOICE_STALE_MS)
  const active = leftover.filter(open => endedAt.getTime() - open.updatedAt.getTime() < VOICE_STALE_MS)
  const rooms = await closeOpenSegments(tx, stale, endedAt, 'abandon')
  if (!active.length) return rooms
  if (!takeover) {
    throw new WorkspaceError(
      409,
      'VOICE_SESSION_ACTIVE',
      'You already have a live session in this workspace. Resume it, or confirm starting a new one to end the other take.',
      { openSessions: [...new Set(active.map(open => open.sessionId))] },
    )
  }
  rooms.push(...await closeOpenSegments(tx, active, endedAt, 'keep'))
  return rooms
}

export async function createSessionSegment(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const id = String(req.body?.segmentId || '').trim()
    const roomName = String(req.body?.roomName || '').trim()
    const startedAt = req.body?.startedAt ? new Date(req.body.startedAt) : new Date()
    const takeover = req.body?.takeover === true
    if (
      !id ||
      id.length > 128 ||
      !roomName ||
      roomName.length > 256 ||
      Number.isNaN(startedAt.getTime())
    ) {
      return res.status(400).json({ error: 'segmentId, roomName, and valid startedAt are required' })
    }

    const ownership = await ownedSession(req, sessionId)
    if ('error' in ownership) {
      return res.status(ownership.status ?? 500).json({ error: ownership.error })
    }
    if (ownership.session.endedAt) {
      return res.status(409).json({ error: 'Cannot add a segment to an ended session' })
    }

    const existing = await prisma.sessionSegment.findUnique({ where: { id } })
    if (existing) {
      if (existing.sessionId !== sessionId || existing.roomName !== roomName) {
        return res.status(409).json({ error: 'segmentId already belongs to different metadata' })
      }
      return res.status(200).json({ segment: existing, idempotent: true })
    }

    let segment
    let releasedRooms: string[] = []
    try {
      segment = await prisma.$transaction(
        async (tx) => {
          await lockWritableSession(tx, sessionId)
          const openSegments = await tx.sessionSegment.findMany({
            where: { sessionId, endedAt: null },
          })
          const rooms = await closeOpenSegments(tx, openSegments, startedAt, 'keep')
          rooms.push(
            ...await claimOwnWorkspaceVoiceSlot(tx, ownership.session.userId, sessionId, startedAt, takeover),
          )
          releasedRooms = rooms
          await reserveWorkspaceVoiceSlot(tx)
          const latest = await tx.sessionSegment.findFirst({
            where: { sessionId },
            orderBy: { segmentIndex: 'desc' },
            select: { segmentIndex: true },
          })
          const created = await tx.sessionSegment.create({
            data: {
              id,
              sessionId,
              segmentIndex: (latest?.segmentIndex ?? -1) + 1,
              roomName,
              startedAt,
            },
          })
          if (openSegments.length > 0) {
            const aggregate = await tx.sessionSegment.aggregate({
              where: { sessionId, endedAt: { not: null } },
              _sum: { activeDurationSec: true },
            })
            await tx.session.update({
              where: { id: sessionId },
              data: { durationSec: aggregate._sum.activeDurationSec ?? 0 },
            })
          }
          return created
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
    } catch (error) {
      if (error instanceof WorkspaceError) {
        return res.status(error.status).json({ error: error.message, code: error.code, ...error.details })
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
        return res.status(409).json({ error: 'Live practice is starting elsewhere. Try again.', code: 'SEGMENT_RETRY' })
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.sessionSegment.findUnique({ where: { id } })
        if (raced?.sessionId === sessionId && raced.roomName === roomName) {
          return res.status(200).json({ segment: raced, idempotent: true })
        }
        return res.status(409).json({ error: 'Session segment or room is already in use' })
      }
      throw error
    }

    await releaseLivekitRooms(releasedRooms)
    return res.status(201).json({ segment })
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error('Error creating session segment:', error instanceof Error ? error.message : error)
    return res.status(500).json({ error: 'Failed to create session segment' })
  }
}

export async function closeSessionSegment(req: Request, res: Response) {
  try {
    const { sessionId, segmentId } = req.params
    const ownership = await ownedSession(req, sessionId)
    if ('error' in ownership) {
      return res.status(ownership.status ?? 500).json({ error: ownership.error })
    }

    const segment = await prisma.sessionSegment.findUnique({ where: { id: segmentId } })
    if (!segment || segment.sessionId !== sessionId) {
      return res.status(404).json({ error: 'Segment not found' })
    }

    const audioStatus = req.body?.audioStatus
    if (audioStatus != null && !AUDIO_STATUSES.has(audioStatus)) {
      return res.status(400).json({ error: 'Invalid audioStatus' })
    }
    const endedAt = req.body?.endedAt ? new Date(req.body.endedAt) : new Date()
    if (Number.isNaN(endedAt.getTime()) || endedAt < segment.startedAt) {
      return res.status(400).json({ error: 'Invalid endedAt' })
    }
    // Active session time starts when the room segment starts. Recording can
    // begin later while the mic track is published; that delay is not paused
    // time and must never redefine the session-duration contract.
    const activeDurationSec = activeSegmentDurationSec(segment.startedAt, endedAt)
    const nextAudioStatus = mergeSegmentAudioStatus(segment.audioStatus, audioStatus)

    const updated = await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const next = await tx.sessionSegment.update({
        where: { id: segmentId },
        data: {
          endedAt: segment.endedAt ?? endedAt,
          activeDurationSec: segment.activeDurationSec ?? activeDurationSec,
          ...(nextAudioStatus ? { audioStatus: nextAudioStatus } : {}),
        },
      })
      const aggregate = await tx.sessionSegment.aggregate({
        where: { sessionId, endedAt: { not: null } },
        _sum: { activeDurationSec: true },
      })
      await tx.session.update({
        where: { id: sessionId },
        data: { durationSec: aggregate._sum.activeDurationSec ?? 0 },
      })
      return next
    })

    return res.json({ segment: updated })
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error('Error closing session segment:', error)
    return res.status(500).json({ error: 'Failed to close session segment' })
  }
}
