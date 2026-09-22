import { prisma } from './prisma'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import {
  readPersistedPaceEvidence,
  selectBestPaceEvidence,
} from '../analytics/pace'
import { lockWritableSession } from './sessionDiscard'

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
export const PACE_RECONCILIATION_BATCH_SIZE = 100
const LEASE_MS = 2 * 60 * 1000
const MAX_NOT_READY_ATTEMPTS = 5
let sweepTimer: NodeJS.Timeout | null = null
let sweepRunning = false

export function shouldAttemptPaceReconciliation(input: {
  endedAt: Date | null
  discardedAt: Date | null
  userTurnCount: number
}): boolean {
  return Boolean(input.endedAt && !input.discardedAt && input.userTurnCount > 0)
}

function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6))
}

export function paceReconciliationEligibilityWhere(
  now: Date,
): Prisma.SessionWhereInput {
  return {
    endedAt: { not: null },
    discardedAt: null,
    paceReconciliationStatus: { in: ['pending', 'retry', 'processing'] },
    OR: [
      { paceReconciliationLeaseUntil: null },
      { paceReconciliationLeaseUntil: { lte: now } },
    ],
    AND: [
      {
        OR: [
          { nextPaceReconciliationAt: null },
          { nextPaceReconciliationAt: { lte: now } },
        ],
      },
    ],
  }
}

export async function reconcileEndedSessionPace(
  sessionId: string,
  leaseId?: string,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    // JSON columns are replaced atomically, not patched. Serialize with every
    // other session writer, then reread the latest status under that lock.
    await lockWritableSession(tx, sessionId)
    const session = await tx.session.findUnique({
      where: { id: sessionId },
      select: {
        endedAt: true,
        discardedAt: true,
        paceReconciliationLeaseId: true,
        metrics: { select: { processingStatus: true, userWpm: true } },
        turns: {
          where: { role: 'user' },
          select: { role: true, metrics: true },
        },
      },
    })
    if (
      !session ||
      (leaseId && session.paceReconciliationLeaseId !== leaseId) ||
      !shouldAttemptPaceReconciliation({
        endedAt: session.endedAt,
        discardedAt: session.discardedAt,
        userTurnCount: session.turns.length,
      })
    ) {
      return false
    }

    const expectedWords = session.turns.reduce((sum, turn) => {
      if (!turn.metrics || typeof turn.metrics !== 'object' || Array.isArray(turn.metrics)) {
        return sum
      }
      const words = Number((turn.metrics as Record<string, unknown>).word_count)
      return sum + (Number.isFinite(words) && words > 0 ? words : 0)
    }, 0)
    const currentRaw = readPersistedPaceEvidence(session.metrics?.processingStatus)
    const pace = selectBestPaceEvidence(currentRaw, session.turns, expectedWords)
    if (pace.status !== 'available' || pace.wpm == null) return false

    const current =
      currentRaw && typeof currentRaw === 'object' && !Array.isArray(currentRaw)
        ? (currentRaw as Record<string, unknown>)
        : null
    if (
      current?.status === 'available' &&
      current.origin === pace.origin &&
      Number(current.totalWords) === pace.totalWords &&
      Number(current.speakingSeconds) === pace.speakingSeconds &&
      Number(current.samples) === pace.samples &&
      Math.abs((session.metrics?.userWpm ?? 0) - pace.wpm) < 0.01
    ) {
      return true
    }

    const processingStatus = mergePaceIntoProcessingStatus(
      session.metrics?.processingStatus,
      pace,
    )
    await tx.sessionMetrics.upsert({
      where: { sessionId },
      create: {
        sessionId,
        userWpm: pace.wpm,
        userSpeakingTime: pace.speakingSeconds,
        processingStatus,
      },
      update: {
        userWpm: pace.wpm,
        userSpeakingTime: pace.speakingSeconds,
        processingStatus,
      },
    })
    return true
  })
}

export function mergePaceIntoProcessingStatus(
  currentStatus: unknown,
  pace: unknown,
): Prisma.InputJsonObject {
  const current =
    currentStatus && typeof currentStatus === 'object' && !Array.isArray(currentStatus)
      ? (currentStatus as Record<string, unknown>)
      : {}
  return JSON.parse(JSON.stringify({ ...current, pace })) as Prisma.InputJsonObject
}

export async function processPaceReconciliation(sessionId: string): Promise<boolean> {
  const now = new Date()
  const leaseId = randomUUID()
  const claimed = await prisma.session.updateMany({
    where: {
      id: sessionId,
      ...paceReconciliationEligibilityWhere(now),
    },
    data: {
      paceReconciliationStatus: 'processing',
      paceReconciliationAttempts: { increment: 1 },
      paceReconciliationError: null,
      nextPaceReconciliationAt: null,
      paceReconciliationLeaseId: leaseId,
      paceReconciliationLeaseUntil: new Date(now.getTime() + LEASE_MS),
    },
  })
  if (claimed.count !== 1) return false

  try {
    const reconciled = await reconcileEndedSessionPace(sessionId, leaseId)
    const job = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { paceReconciliationAttempts: true },
    })
    const completed = reconciled || (job?.paceReconciliationAttempts ?? 0) >= MAX_NOT_READY_ATTEMPTS
    await prisma.session.updateMany({
      where: { id: sessionId, paceReconciliationLeaseId: leaseId },
      data: {
        paceReconciliationStatus: completed ? 'completed' : 'retry',
        nextPaceReconciliationAt: completed
          ? null
          : new Date(Date.now() + retryDelayMs(job?.paceReconciliationAttempts ?? 1)),
        paceReconciliationLeaseId: null,
        paceReconciliationLeaseUntil: null,
      },
    })
    return reconciled
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const job = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { paceReconciliationAttempts: true },
    })
    await prisma.session.updateMany({
      where: { id: sessionId, paceReconciliationLeaseId: leaseId },
      data: {
        paceReconciliationStatus: 'retry',
        paceReconciliationError: message,
        nextPaceReconciliationAt: new Date(
          Date.now() + retryDelayMs(job?.paceReconciliationAttempts ?? 1),
        ),
        paceReconciliationLeaseId: null,
        paceReconciliationLeaseUntil: null,
      },
    })
    throw error
  }
}

export async function sweepEndedSessionPace(): Promise<void> {
  if (sweepRunning) return
  sweepRunning = true
  try {
    const now = new Date()
    const sessions = await prisma.session.findMany({
      where: {
        ...paceReconciliationEligibilityWhere(now),
      },
      orderBy: [{ nextPaceReconciliationAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
      take: PACE_RECONCILIATION_BATCH_SIZE,
    })
    for (const session of sessions) {
      await processPaceReconciliation(session.id).catch((error) => {
        console.error(`Pace reconciliation failed for ${session.id}:`, error)
      })
    }
  } finally {
    sweepRunning = false
  }
}

export function queuePaceReconciliation(sessionId: string): void {
  for (const delay of [1_000, 5_000, 30_000]) {
    setTimeout(() => {
      void processPaceReconciliation(sessionId).catch((error) => {
        console.error(`Queued pace reconciliation failed for ${sessionId}:`, error)
      })
    }, delay).unref?.()
  }
}

export function startPaceReconciliationWorker(): void {
  if (sweepTimer) return
  void sweepEndedSessionPace()
  sweepTimer = setInterval(() => {
    void sweepEndedSessionPace()
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
}
