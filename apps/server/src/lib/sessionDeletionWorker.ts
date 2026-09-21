import { RoomServiceClient } from 'livekit-server-sdk'
import { randomUUID } from 'crypto'
import { prisma } from './prisma'
import { logger } from './logger'
import { deleteSessionStorage, stopSessionEgress } from './sessionStorageCleanup'

const activeJobs = new Set<string>()
const retryTimers = new Map<string, NodeJS.Timeout>()
let sweepTimer: NodeJS.Timeout | null = null
const DELETION_LEASE_MS = 10 * 60_000

function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6))
}

function legacyTranscriptAudioPaths(conversationData: unknown): string[] {
  if (!conversationData || typeof conversationData !== 'object') return []
  const audioFiles = (conversationData as { audioFiles?: unknown }).audioFiles
  if (!Array.isArray(audioFiles)) return []
  return audioFiles.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { s3Bucket, s3Key } = entry as { s3Bucket?: unknown; s3Key?: unknown }
    return typeof s3Bucket === 'string' &&
      s3Bucket.length > 0 &&
      typeof s3Key === 'string' &&
      s3Key.length > 0
      ? [`s3://${s3Bucket}/${s3Key}`]
      : []
  })
}

function livekitConfig() {
  const url = process.env.LIVEKIT_URL || ''
  return {
    httpUrl: url.startsWith('wss://')
      ? url.replace('wss://', 'https://')
      : url.replace('ws://', 'http://'),
    apiKey: process.env.LIVEKIT_API_KEY || '',
    apiSecret: process.env.LIVEKIT_API_SECRET || '',
  }
}

async function disconnectRooms(roomNames: string[]): Promise<void> {
  const { httpUrl, apiKey, apiSecret } = livekitConfig()
  if (!httpUrl || !apiKey || !apiSecret || roomNames.length === 0) return
  const service = new RoomServiceClient(httpUrl, apiKey, apiSecret)
  const results = await Promise.allSettled(
    [...new Set(roomNames)].map((roomName) => service.deleteRoom(roomName)),
  )
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)
    .filter((error) => {
      const candidate = error as {
        status?: number
        statusCode?: number
        code?: string | number
        message?: string
      }
      const code = String(candidate?.code ?? '').toLowerCase()
      const message = String(candidate?.message ?? '').toLowerCase()
      return !(
        candidate?.status === 404 ||
        candidate?.statusCode === 404 ||
        code === 'not_found' ||
        code === 'notfound' ||
        message.includes('room not found')
      )
    })
  if (failures.length > 0) {
    throw new AggregateError(failures, `Failed to close ${failures.length} LiveKit room(s)`)
  }
}

export function enqueueSessionDeletion(sessionId: string, delayMs = 0): void {
  if (activeJobs.has(sessionId)) return
  const pendingTimer = retryTimers.get(sessionId)
  if (pendingTimer) {
    if (delayMs > 0) return
    clearTimeout(pendingTimer)
    retryTimers.delete(sessionId)
  }
  const timer = setTimeout(() => {
    retryTimers.delete(sessionId)
    void processSessionDeletion(sessionId)
  }, Math.max(0, delayMs))
  timer.unref()
  retryTimers.set(sessionId, timer)
}

export async function processSessionDeletion(sessionId: string): Promise<boolean> {
  if (activeJobs.has(sessionId)) return false
  activeJobs.add(sessionId)
  let retryAfterMs: number | null = null
  const leaseId = randomUUID()
  try {
    const now = new Date()
    const claimed = await prisma.session.updateMany({
      where: {
        id: sessionId,
        discardedAt: { not: null },
        AND: [
          {
            OR: [
              { deletionLeaseUntil: null },
              { deletionLeaseUntil: { lte: now } },
            ],
          },
          {
            OR: [
              { nextDeletionAttemptAt: null },
              { nextDeletionAttemptAt: { lte: now } },
            ],
          },
        ],
      },
      data: {
        deletionStatus: 'retrying',
        deletionAttempts: { increment: 1 },
        deletionError: null,
        nextDeletionAttemptAt: null,
        deletionLeaseId: leaseId,
        deletionLeaseUntil: new Date(now.getTime() + DELETION_LEASE_MS),
      },
    })
    if (claimed.count !== 1) return false

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        segments: {
          select: { roomName: true },
        },
        recordings: {
          select: { egressId: true, filePath: true, status: true },
        },
        transcript: { select: { conversationData: true } },
      },
    })
    if (!session?.discardedAt || session.deletionLeaseId !== leaseId) return false
    const attempt = session.deletionAttempts

    const roomNames = session.segments.map((segment) => segment.roomName)
    const latestRecordings = await prisma.sessionRecording.findMany({
      where: { sessionId },
      select: { egressId: true, filePath: true, status: true },
    })
    const recordingReferences = [...session.recordings, ...latestRecordings]
    const egress = await stopSessionEgress(roomNames, recordingReferences)
    if (egress.skippedUnavailable) {
      logger.info(
        { sessionId },
        'Skipped unavailable Redis-disabled Egress with no active-writer evidence',
      )
    }
    await disconnectRooms(roomNames)

    // Renew and fence the lease before deleting storage. A stale worker may
    // perform idempotent deletes, but it must never hard-delete another
    // worker's job.
    const renewed = await prisma.session.updateMany({
      where: { id: sessionId, discardedAt: { not: null }, deletionLeaseId: leaseId },
      data: { deletionLeaseUntil: new Date(Date.now() + DELETION_LEASE_MS) },
    })
    if (renewed.count !== 1) return false

    await deleteSessionStorage(
      sessionId,
      new Set([
        ...session.recordings.map((recording) => recording.filePath),
        ...latestRecordings.map((recording) => recording.filePath),
        ...egress.paths,
        ...legacyTranscriptAudioPaths(session.transcript?.conversationData),
      ]),
    )

    const [, deleted] = await prisma.$transaction([
      prisma.progressPulse.deleteMany({ where: { sessionId, source: 'elevate' } }),
      prisma.session.deleteMany({
        where: {
          id: sessionId,
          discardedAt: { not: null },
          deletionLeaseId: leaseId,
        },
      }),
    ])
    if (deleted.count !== 1) return false
    logger.info({ sessionId, attempt }, 'Discarded session cleanup completed')
    return true
  } catch (error) {
    try {
      const current = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { discardedAt: true, deletionAttempts: true, deletionLeaseId: true },
      })
      if (current?.discardedAt && current.deletionLeaseId === leaseId) {
        const delay = retryDelayMs(current.deletionAttempts)
        const nextAttempt = new Date(Date.now() + delay)
        const released = await prisma.session.updateMany({
          where: {
            id: sessionId,
            discardedAt: { not: null },
            deletionLeaseId: leaseId,
          },
          data: {
            deletionStatus: 'failed',
            deletionError: error instanceof Error ? error.message.slice(0, 2000) : String(error),
            nextDeletionAttemptAt: nextAttempt,
            deletionLeaseId: null,
            deletionLeaseUntil: null,
          },
        })
        if (released.count === 1) {
          retryAfterMs = delay
          logger.warn(
            { err: error, sessionId, nextAttempt },
            'Discarded session cleanup failed; retry scheduled',
          )
        }
      }
    } catch (statusError) {
      // A database outage can prevent recording the retry time. The periodic
      // sweep still discovers the persisted discardedAt tombstone on recovery.
      logger.error(
        { err: statusError, cleanupError: error, sessionId },
        'Could not persist discarded-session cleanup failure',
      )
    }
    return false
  } finally {
    activeJobs.delete(sessionId)
    if (retryAfterMs != null) enqueueSessionDeletion(sessionId, retryAfterMs)
  }
}

export async function sweepPendingDeletions(): Promise<void> {
  const now = new Date()
  const sessions = await prisma.session.findMany({
    where: {
      discardedAt: { not: null },
      OR: [
        { deletionLeaseUntil: null },
        { deletionLeaseUntil: { lte: now } },
      ],
    },
    select: { id: true, nextDeletionAttemptAt: true },
    take: 100,
    orderBy: { discardedAt: 'asc' },
  })
  for (const session of sessions) {
    const delay = session.nextDeletionAttemptAt
      ? Math.max(0, session.nextDeletionAttemptAt.getTime() - Date.now())
      : 0
    enqueueSessionDeletion(session.id, delay)
  }
}

export function startSessionDeletionWorker(): void {
  void sweepPendingDeletions().catch((error) => {
    logger.error({ err: error }, 'Failed to sweep pending session deletions')
  })
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    void sweepPendingDeletions().catch((error) => {
      logger.error({ err: error }, 'Failed to sweep pending session deletions')
    })
  }, 60_000)
  sweepTimer.unref()
}
