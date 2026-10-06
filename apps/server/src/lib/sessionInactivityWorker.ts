import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { isStandaloneCommunication } from './activityPolicy'
import { logger } from './logger'
import { lockWritableSession, SessionDiscardedError, SessionMissingError } from './sessionDiscard'
import { activeSegmentDurationSec } from '../analytics/sessionSegments'
import { queuePaceReconciliation, requeuePaceReconciliationData } from './paceReconciliationWorker'
import { awardSessionActivePoints } from './points'
import { runSessionAnalysis } from '../routes/analytics'

export const SESSION_INACTIVITY_TIMEOUT_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 15 * 60 * 1000
const BATCH_SIZE = 100

type ActivityClient = Pick<Prisma.TransactionClient, 'sessionSegment' | 'sessionTurn' | 'sessionTranscript' | 'sessionRecording'>

export function latestActivityAt(startedAt: Date, candidates: Array<Date | null | undefined>): Date {
  let latest = startedAt
  for (const value of candidates) {
    if (value && value.getTime() > latest.getTime()) latest = value
  }
  return latest
}

async function sessionLastActivityAt(db: ActivityClient, sessionId: string, startedAt: Date): Promise<Date> {
  const [segments, turn, transcript, recording] = await Promise.all([
    db.sessionSegment.aggregate({
      where: { sessionId },
      _max: { startedAt: true, endedAt: true, updatedAt: true },
    }),
    db.sessionTurn.aggregate({ where: { sessionId }, _max: { createdAt: true } }),
    db.sessionTranscript.findUnique({ where: { sessionId }, select: { updatedAt: true } }),
    db.sessionRecording.aggregate({ where: { sessionId }, _max: { updatedAt: true } }),
  ])
  return latestActivityAt(startedAt, [
    segments._max.startedAt,
    segments._max.endedAt,
    segments._max.updatedAt,
    turn._max.createdAt,
    transcript?.updatedAt,
    recording._max.updatedAt,
  ])
}

export type InactiveCompletionResult =
  | { completed: true; endedAt: Date; userId: string; prepareOwned: boolean; module: string; rewardEligible: boolean }
  | { completed: false; reason: 'already_ended' | 'active' | 'retained' | 'discarded' | 'missing' }

/**
 * Complete one abandoned session. Re-checks activity under the same row lock
 * Leave and discard use, so a late write or concurrent Leave always wins.
 */
export async function completeInactiveSession(
  sessionId: string,
  now = new Date(),
): Promise<InactiveCompletionResult> {
  const cutoff = now.getTime() - SESSION_INACTIVITY_TIMEOUT_MS
  try {
    return await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          userId: true,
          startedAt: true,
          endedAt: true,
          retainedAt: true,
          durationSec: true,
          module: true,
          purpose: true,
          preparationPractice: { select: { id: true } },
        },
      })
      if (!session) return { completed: false, reason: 'missing' } as const
      if (session.endedAt) return { completed: false, reason: 'already_ended' } as const
      if (session.retainedAt) return { completed: false, reason: 'retained' } as const

      const lastActivity = await sessionLastActivityAt(tx, sessionId, session.startedAt)
      if (lastActivity.getTime() > cutoff) return { completed: false, reason: 'active' } as const

      const openSegments = await tx.sessionSegment.findMany({
        where: { sessionId, endedAt: null },
        select: { id: true, startedAt: true, audioStatus: true, recording: { select: { id: true } } },
      })
      for (const segment of openSegments) {
        const segmentEnd = latestActivityAt(segment.startedAt, [lastActivity])
        await tx.sessionSegment.update({
          where: { id: segment.id },
          data: {
            endedAt: segmentEnd,
            activeDurationSec: activeSegmentDurationSec(segment.startedAt, segmentEnd),
            // A pending upload will not arrive after a day of inactivity.
            ...(segment.audioStatus === 'pending'
              ? { audioStatus: segment.recording ? 'available' : 'unavailable' }
              : {}),
          },
        })
      }

      const segmentCount = await tx.sessionSegment.count({ where: { sessionId } })
      let durationSec = session.durationSec
      if (segmentCount > 0) {
        const aggregate = await tx.sessionSegment.aggregate({
          where: { sessionId, endedAt: { not: null } },
          _sum: { activeDurationSec: true },
        })
        durationSec = aggregate._sum.activeDurationSec ?? 0
      } else if (durationSec == null) {
        durationSec = activeSegmentDurationSec(session.startedAt, lastActivity)
      }

      await tx.session.update({
        where: { id: sessionId },
        data: {
          endedAt: lastActivity,
          durationSec,
          ...requeuePaceReconciliationData(now),
          deliveryAlignmentStatus: 'pending',
          deliveryAlignmentNextAt: new Date(now.getTime() + 15_000),
        },
      })
      return {
        completed: true,
        endedAt: lastActivity,
        userId: session.userId,
        prepareOwned: Boolean(session.preparationPractice),
        module: session.module,
        rewardEligible: isStandaloneCommunication(session),
      } as const
    })
  } catch (error) {
    if (error instanceof SessionDiscardedError) return { completed: false, reason: 'discarded' }
    if (error instanceof SessionMissingError) return { completed: false, reason: 'missing' }
    throw error
  }
}

/**
 * Leave normally triggers /analyze from the browser; an abandoned session never
 * does. Run the same pipeline with the same Pulse default as a normal Leave.
 */
export async function analyzeCompletedSession(sessionId: string): Promise<boolean> {
  try {
    const result = await runSessionAnalysis(sessionId, { source: 'elevate' })
    if (result.status !== 200) {
      logger.warn({ sessionId, status: result.status, body: result.body }, 'auto-complete analysis skipped')
      return false
    }
    return true
  } catch (err) {
    logger.error({ err, sessionId }, 'auto-complete analysis failed')
    return false
  }
}

let sweepRunning = false
let sweepTimer: NodeJS.Timeout | null = null

export async function sweepInactiveSessions(now = new Date()): Promise<number> {
  if (sweepRunning) return 0
  sweepRunning = true
  let completed = 0
  try {
    // startedAt bounds the candidate set; activity is verified per session.
    const startedBefore = new Date(now.getTime() - SESSION_INACTIVITY_TIMEOUT_MS)
    let cursor: string | undefined
    for (;;) {
      const batch = await prisma.session.findMany({
        where: { endedAt: null, discardedAt: null, retainedAt: null, startedAt: { lt: startedBefore } },
        orderBy: { id: 'asc' },
        select: { id: true },
        take: BATCH_SIZE,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      })
      for (const { id } of batch) {
        try {
          const result = await completeInactiveSession(id, now)
          if (!result.completed) continue
          completed += 1
          logger.info(
            { event: 'elevate.session_auto_completed', sessionId: id, endedAt: result.endedAt },
            'inactive session completed',
          )
          queuePaceReconciliation(id)
          if (result.rewardEligible) {
            try {
              await awardSessionActivePoints(result.userId, id)
            } catch (err) {
              logger.warn({ err, sessionId: id }, 'auto-complete points award skipped')
            }
          }
          if (result.module === 'elevate') await analyzeCompletedSession(id)
        } catch (err) {
          logger.error({ err, sessionId: id }, 'inactive session completion failed')
        }
      }
      if (batch.length < BATCH_SIZE) break
      cursor = batch[batch.length - 1].id
    }
  } finally {
    sweepRunning = false
  }
  return completed
}

export function startSessionInactivityWorker(): void {
  if (sweepTimer) return
  void sweepInactiveSessions().catch((err) => logger.error({ err }, 'inactive session sweep failed'))
  sweepTimer = setInterval(() => {
    void sweepInactiveSessions().catch((err) => logger.error({ err }, 'inactive session sweep failed'))
  }, SWEEP_INTERVAL_MS)
  sweepTimer.unref?.()
}
