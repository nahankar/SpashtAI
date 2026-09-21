import { RoomServiceClient } from 'livekit-server-sdk'
import { prisma } from './prisma'
import { logger } from './logger'
import { deleteSessionStorage, stopSessionEgress } from './sessionStorageCleanup'

const activeJobs = new Set<string>()
const retryTimers = new Map<string, NodeJS.Timeout>()
let sweepTimer: NodeJS.Timeout | null = null

function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6))
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
  await Promise.allSettled(
    [...new Set(roomNames)].map((roomName) => service.deleteRoom(roomName)),
  )
}

export function enqueueSessionDeletion(sessionId: string, delayMs = 0): void {
  if (activeJobs.has(sessionId) || retryTimers.has(sessionId)) return
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
  try {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        segments: {
          where: { endedAt: null },
          select: { roomName: true },
        },
        recordings: { select: { filePath: true } },
      },
    })
    if (!session?.discardedAt) return false

    const attempt = session.deletionAttempts + 1
    await prisma.session.update({
      where: { id: sessionId },
      data: {
        deletionStatus: 'retrying',
        deletionAttempts: attempt,
        deletionError: null,
        nextDeletionAttemptAt: null,
      },
    })

    const roomNames = session.segments.map((segment) => segment.roomName)
    const egressPaths = await stopSessionEgress(roomNames)
    await disconnectRooms(roomNames)

    const latestRecordings = await prisma.sessionRecording.findMany({
      where: { sessionId },
      select: { filePath: true },
    })
    await deleteSessionStorage(
      sessionId,
      new Set([
        ...session.recordings.map((recording) => recording.filePath),
        ...latestRecordings.map((recording) => recording.filePath),
        ...egressPaths,
      ]),
    )

    await prisma.$transaction([
      prisma.progressPulse.deleteMany({ where: { sessionId, source: 'elevate' } }),
      prisma.session.delete({ where: { id: sessionId } }),
    ])
    logger.info({ sessionId, attempt }, 'Discarded session cleanup completed')
    return true
  } catch (error) {
    try {
      const current = await prisma.session.findUnique({
        where: { id: sessionId },
        select: { discardedAt: true, deletionAttempts: true },
      })
      if (current?.discardedAt) {
        const delay = retryDelayMs(current.deletionAttempts)
        const nextAttempt = new Date(Date.now() + delay)
        await prisma.session.updateMany({
          where: { id: sessionId, discardedAt: { not: null } },
          data: {
            deletionStatus: 'failed',
            deletionError: error instanceof Error ? error.message.slice(0, 2000) : String(error),
            nextDeletionAttemptAt: nextAttempt,
          },
        })
        retryAfterMs = delay
        logger.warn(
          { err: error, sessionId, nextAttempt },
          'Discarded session cleanup failed; retry scheduled',
        )
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
  const sessions = await prisma.session.findMany({
    where: { discardedAt: { not: null } },
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
