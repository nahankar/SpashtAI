import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'crypto'
import {
  resolveElevateAudioInputSignature,
  resolveElevateSessionAudio,
} from './insightProviders/resolveSessionAudio'
import {
  hasRealProsody,
  isUsableProsody,
  mergeProcessingStatus,
  resolveAudioStatus,
} from './audioStatus'
import { lockWritableSession } from '../lib/sessionDiscard'
import { calculateSkillScores, type TextSignals } from './skillScores'

const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')

const inFlight = new Set<string>()
const rerunRequested = new Set<string>()
let retryTimer: NodeJS.Timeout | null = null
let retrySweepRunning = false

function retryDelayMs(attempt: number): number {
  return Math.min(30 * 60_000, 60_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 5))
}

function withoutProsody(signals: unknown): Record<string, unknown> {
  const next =
    signals && typeof signals === 'object' && !Array.isArray(signals)
      ? { ...(signals as Record<string, unknown>) }
      : {}
  delete next.prosody
  return next
}

function recalculateScores(signals: Record<string, unknown>, totalTurns: number) {
  try {
    return calculateSkillScores(signals as unknown as TextSignals, totalTurns)
  } catch {
    return null
  }
}

export function scheduleElevateSessionAudioEnrichmentIfAnalyzed(sessionId: string): void {
  void prisma.sessionMetrics
    .findUnique({ where: { sessionId }, select: { sessionId: true } })
    .then(async (metrics) => {
      if (!metrics) return
      // Persist the queue transition before starting network/media work so a
      // crash between the upload response and fetch is repaired by the sweep.
      const scheduled = await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        const latest = await tx.sessionMetrics.findUnique({
          where: { sessionId },
          select: { processingStatus: true },
        })
        if (!latest) return
        const status =
          latest.processingStatus &&
          typeof latest.processingStatus === 'object' &&
          !Array.isArray(latest.processingStatus)
            ? (latest.processingStatus as Record<string, unknown>)
            : {}
        // A live worker will re-resolve the audio before it commits.  Clearing
        // its lease here would allow a second process to start duplicate media
        // work for the same session.
        if (hasActiveAudioEnrichmentLease(status)) return false
        await tx.sessionMetrics.update({
          where: { sessionId },
          data: {
            processingStatus: {
              ...status,
              audioEnrichmentStatus: 'retry',
              audioEnrichmentNextRetryAt: new Date().toISOString(),
              audioEnrichmentLeaseId: null,
              audioEnrichmentLeaseUntil: null,
            },
          },
        })
        return true
      })
      if (scheduled) return enrichElevateSessionAudio(sessionId)
    })
    .catch((error) => {
      console.warn(`[analytics] late audio enrichment skipped for ${sessionId}:`, error)
    })
}

export function hasActiveAudioEnrichmentLease(
  status: Record<string, unknown>,
  now = Date.now(),
): boolean {
  const leaseUntil = Date.parse(String(status.audioEnrichmentLeaseUntil ?? ''))
  return (
    status.audioEnrichmentStatus === 'processing' &&
    Number.isFinite(leaseUntil) &&
    leaseUntil > now
  )
}

export async function fetchProsodyForPath(sessionId: string, audioPath: string) {
  // A transport timeout, a refused connection, and a malformed body are the
  // same outcome as an explicit failure response: no measurement for this
  // audio. Returning null keeps every caller on the invalidate-and-retry path
  // instead of unwinding past it and leaving stale acoustics certified.
  let data: unknown
  try {
    const prosodyRes = await fetch(`${SIGNAL_API_URL}/analyze-prosody`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-agent-token': INTERNAL_AGENT_TOKEN,
      },
      body: JSON.stringify({ sessionId, audioPath }),
      signal: AbortSignal.timeout(25000),
    })
    if (!prosodyRes.ok) {
      console.warn(
        `[analytics] prosody request failed for ${sessionId} (${prosodyRes.status}) on ${audioPath}`,
      )
      return null
    }
    data = await prosodyRes.json()
  } catch (error) {
    console.warn(
      `[analytics] prosody request errored for ${sessionId} on ${audioPath}:`,
      error,
    )
    return null
  }
  const prosody = (data as { prosody?: unknown } | null)?.prosody ?? null
  if (!isUsableProsody(prosody)) {
    // The signal API answers 200 with a null payload when it cannot read the
    // file, so an unusable result usually means the path is wrong for it.
    console.warn(`[analytics] no usable prosody for ${sessionId} from ${audioPath}`)
    return null
  }
  return prosody
}

/**
 * After a recording is stored, attach real acoustics onto existing text
 * analytics. Must not block the upload HTTP response, write Pulse, or replace
 * prosody that is already present.
 */
export async function enrichElevateSessionAudio(sessionId: string): Promise<void> {
  if (inFlight.has(sessionId)) {
    rerunRequested.add(sessionId)
    return
  }
  inFlight.add(sessionId)
  try {
    const resolved = await resolveElevateSessionAudio(sessionId, {
      requireCompleteSegments: true,
    })
    if (!resolved?.audioPath) {
      // A pending segment, transient ffprobe failure, or missing local file is
      // not a terminal no-op. Persist the retry so a process restart cannot
      // strand the session. Keep already-certified evidence only when its
      // signature still matches the current DB input set.
      await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        const currentSignature = await resolveElevateAudioInputSignature(sessionId, tx)
        const latest = await tx.sessionMetrics.findUnique({
          where: { sessionId },
          select: {
            processingStatus: true,
            communicationSignals: true,
            deliveryMetrics: true,
            totalTurns: true,
          },
        })
        if (!latest) return
        const status =
          latest.processingStatus &&
          typeof latest.processingStatus === 'object' &&
          !Array.isArray(latest.processingStatus)
            ? (latest.processingStatus as Record<string, unknown>)
            : {}
        if (
          hasRealProsody(latest.communicationSignals) &&
          status.audioInputSignature === currentSignature
        ) {
          return
        }
        const attempts = Math.max(0, Number(status.audioEnrichmentAttempts) || 0) + 1
        const communicationSignals = withoutProsody(latest.communicationSignals)
        const skillScores = recalculateScores(communicationSignals, latest.totalTurns)
        const deliveryIsCurrent =
          status.deliveryAudioInputSignature === currentSignature
        const hasCurrentDelivery =
          deliveryIsCurrent && Boolean(latest.deliveryMetrics)
        await tx.sessionMetrics.update({
          where: { sessionId },
          data: {
            communicationSignals: JSON.parse(JSON.stringify(communicationSignals)),
            ...(skillScores
              ? { skillScores: JSON.parse(JSON.stringify(skillScores)) }
              : {}),
            ...(!deliveryIsCurrent && latest.deliveryMetrics
              ? {
                  deliveryMetrics: Prisma.JsonNull,
                  performanceInsights: Prisma.JsonNull,
                }
              : {}),
            processingStatus: {
              ...status,
              audio_processed: hasCurrentDelivery,
              audioInputSignature: null,
              audioEnrichmentStatus: 'retry',
              audioEnrichmentAttempts: attempts,
              audioEnrichmentNextRetryAt: new Date(
                Date.now() + retryDelayMs(attempts),
              ).toISOString(),
              audioEnrichmentLeaseId: null,
              audioEnrichmentLeaseUntil: null,
              delivery_metrics_stale:
                !deliveryIsCurrent && Boolean(latest.deliveryMetrics),
              ...(!deliveryIsCurrent
                ? { deliveryAudioInputSignature: null }
                : {}),
            },
          },
        })
      })
      return
    }

    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: {
        communicationSignals: true,
        processingStatus: true,
        deliveryMetrics: true,
      },
    })
    if (!metrics) return
    const currentStatus =
      metrics.processingStatus &&
      typeof metrics.processingStatus === 'object' &&
      !Array.isArray(metrics.processingStatus)
        ? (metrics.processingStatus as Record<string, unknown>)
        : {}
    if (
      hasRealProsody(metrics.communicationSignals) &&
      currentStatus.audioInputSignature === resolved.inputSignature
    ) {
      const deliveryNeedsInvalidation =
        Boolean(metrics.deliveryMetrics) &&
        currentStatus.deliveryAudioInputSignature !== resolved.inputSignature
      if (
        currentStatus.audioEnrichmentStatus !== 'completed' ||
        deliveryNeedsInvalidation
      ) {
        await prisma.$transaction(async (tx) => {
          await lockWritableSession(tx, sessionId)
          const latest = await tx.sessionMetrics.findUnique({
            where: { sessionId },
            select: {
              processingStatus: true,
              communicationSignals: true,
              deliveryMetrics: true,
            },
          })
          const latestStatus =
            latest?.processingStatus &&
            typeof latest.processingStatus === 'object' &&
            !Array.isArray(latest.processingStatus)
              ? (latest.processingStatus as Record<string, unknown>)
              : {}
          if (
            latest &&
            hasRealProsody(latest.communicationSignals) &&
            latestStatus.audioInputSignature === resolved.inputSignature
          ) {
            await tx.sessionMetrics.update({
              where: { sessionId },
              data: {
                ...(latest.deliveryMetrics &&
                latestStatus.deliveryAudioInputSignature !== resolved.inputSignature
                  ? {
                      deliveryMetrics: Prisma.JsonNull,
                      performanceInsights: Prisma.JsonNull,
                    }
                  : {}),
                processingStatus: {
                  ...latestStatus,
                  audioEnrichmentStatus: 'completed',
                  audioEnrichmentAttempts: 0,
                  audioEnrichmentNextRetryAt: null,
                  audioEnrichmentLeaseId: null,
                  audioEnrichmentLeaseUntil: null,
                  delivery_metrics_stale:
                    Boolean(latest.deliveryMetrics) &&
                    latestStatus.deliveryAudioInputSignature !== resolved.inputSignature,
                  ...(latestStatus.deliveryAudioInputSignature !==
                  resolved.inputSignature
                    ? { deliveryAudioInputSignature: null }
                    : {}),
                },
              },
            })
          }
        })
      }
      return
    }

    const prosody = await fetchProsodyForPath(sessionId, resolved.audioPath)
    if (!hasRealProsody({ prosody })) {
      await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        const latestSignature = await resolveElevateAudioInputSignature(sessionId, tx)
        if (latestSignature !== resolved.inputSignature) {
          rerunRequested.add(sessionId)
          return
        }
        const latest = await tx.sessionMetrics.findUnique({
          where: { sessionId },
          select: {
            processingStatus: true,
            communicationSignals: true,
            totalTurns: true,
            deliveryMetrics: true,
          },
        })
        if (!latest) return
        const status =
          latest.processingStatus &&
          typeof latest.processingStatus === 'object' &&
          !Array.isArray(latest.processingStatus)
            ? (latest.processingStatus as Record<string, unknown>)
            : {}
        // Another worker or manual analysis may have completed this exact
        // input while our network request was in flight. A later failed
        // request must never erase that committed success.
        if (
          hasRealProsody(latest.communicationSignals) &&
          status.audioInputSignature === resolved.inputSignature
        ) {
          if (status.audioEnrichmentStatus !== 'completed') {
            await tx.sessionMetrics.update({
              where: { sessionId },
              data: {
                processingStatus: {
                  ...status,
                  audioEnrichmentStatus: 'completed',
                  audioEnrichmentAttempts: 0,
                  audioEnrichmentNextRetryAt: null,
                  audioEnrichmentLeaseId: null,
                  audioEnrichmentLeaseUntil: null,
                },
              },
            })
          }
          return
        }
        const attempts = Math.max(0, Number(status.audioEnrichmentAttempts) || 0) + 1
        const communicationSignals = withoutProsody(latest.communicationSignals)
        const skillScores = recalculateScores(communicationSignals, latest.totalTurns)
        const deliveryIsCurrent =
          status.deliveryAudioInputSignature === resolved.inputSignature
        const hasCurrentDelivery =
          deliveryIsCurrent && Boolean(latest.deliveryMetrics)
        await tx.sessionMetrics.update({
          where: { sessionId },
          data: {
            communicationSignals: JSON.parse(JSON.stringify(communicationSignals)),
            ...(skillScores
              ? { skillScores: JSON.parse(JSON.stringify(skillScores)) }
              : {}),
            ...(!deliveryIsCurrent && latest.deliveryMetrics
              ? {
                  deliveryMetrics: Prisma.JsonNull,
                  performanceInsights: Prisma.JsonNull,
                }
              : {}),
            processingStatus: {
              ...status,
              audioStatus: 'available',
              audio_processed: hasCurrentDelivery,
              audioInputSignature: null,
              audioEnrichmentStatus: 'retry',
              audioEnrichmentAttempts: attempts,
              audioEnrichmentNextRetryAt: new Date(
                Date.now() + retryDelayMs(attempts),
              ).toISOString(),
              audioEnrichmentLeaseId: null,
              audioEnrichmentLeaseUntil: null,
              delivery_metrics_stale:
                !deliveryIsCurrent && Boolean(latest.deliveryMetrics),
              ...(!deliveryIsCurrent
                ? { deliveryAudioInputSignature: null }
                : {}),
            },
          },
        })
      })
      return
    }

    await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const latestSignature = await resolveElevateAudioInputSignature(sessionId, tx)
      if (latestSignature !== resolved.inputSignature) {
        rerunRequested.add(sessionId)
        return
      }
      const latest = await tx.sessionMetrics.findUnique({
        where: { sessionId },
        select: {
          communicationSignals: true,
          processingStatus: true,
          totalTurns: true,
          deliveryMetrics: true,
        },
      })
      if (!latest) return
      const latestStatus =
        latest.processingStatus &&
        typeof latest.processingStatus === 'object' &&
        !Array.isArray(latest.processingStatus)
          ? (latest.processingStatus as Record<string, unknown>)
          : {}
      if (
        hasRealProsody(latest.communicationSignals) &&
        latestStatus.audioInputSignature === resolved.inputSignature
      ) {
        return
      }
      const existing =
        latest.communicationSignals && typeof latest.communicationSignals === 'object'
          ? (latest.communicationSignals as Record<string, unknown>)
          : {}
      const communicationSignals = { ...existing, prosody }
      const skillScores = recalculateScores(communicationSignals, latest.totalTurns)
      const deliveryIsCurrent =
        latestStatus.deliveryAudioInputSignature === resolved.inputSignature
      await tx.sessionMetrics.update({
        where: { sessionId },
        data: {
          communicationSignals: JSON.parse(JSON.stringify(communicationSignals)),
          ...(skillScores
            ? { skillScores: JSON.parse(JSON.stringify(skillScores)) }
            : {}),
          ...(!deliveryIsCurrent && latest.deliveryMetrics
            ? {
                deliveryMetrics: Prisma.JsonNull,
                performanceInsights: Prisma.JsonNull,
              }
            : {}),
          processingStatus: {
            ...mergeProcessingStatus(latest.processingStatus, {
              audioStatus: resolveAudioStatus({ hasReadableRecording: true }),
              audioProcessed: true,
            }),
            audioInputSignature: resolved.inputSignature,
            audioEnrichmentStatus: 'completed',
            audioEnrichmentAttempts: 0,
            audioEnrichmentNextRetryAt: null,
            audioEnrichmentLeaseId: null,
            audioEnrichmentLeaseUntil: null,
            delivery_metrics_stale:
              !deliveryIsCurrent && Boolean(latest.deliveryMetrics),
            ...(!deliveryIsCurrent
              ? { deliveryAudioInputSignature: null }
              : {}),
          },
        },
      })
    })
  } catch (error) {
    console.warn(`[analytics] audio enrichment skipped for ${sessionId}:`, error)
  } finally {
    inFlight.delete(sessionId)
    if (rerunRequested.delete(sessionId)) {
      queueMicrotask(() => {
        void enrichElevateSessionAudio(sessionId)
      })
    }
  }
}

export async function sweepAudioEnrichmentRetries(now = new Date()): Promise<void> {
  if (retrySweepRunning) return
  retrySweepRunning = true
  try {
    let cursor: string | undefined
    const dueSessionIds: string[] = []
    for (;;) {
      const rows = await prisma.sessionMetrics.findMany({
        where: {
          OR: [
            {
              processingStatus: {
                path: ['audioEnrichmentStatus'],
                equals: 'retry',
              },
            },
            {
              processingStatus: {
                path: ['audioEnrichmentStatus'],
                equals: 'processing',
              },
            },
          ],
        },
        orderBy: { sessionId: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { sessionId: cursor }, skip: 1 } : {}),
        select: { sessionId: true, processingStatus: true },
      })
      for (const row of rows) {
        const status = row.processingStatus as Record<string, unknown> | null
        const state = status?.audioEnrichmentStatus
        const retryAt = Date.parse(String(status?.audioEnrichmentNextRetryAt ?? ''))
        const leaseUntil = Date.parse(String(status?.audioEnrichmentLeaseUntil ?? ''))
        const due =
          state === 'processing'
            ? !Number.isFinite(leaseUntil) || leaseUntil <= now.getTime()
            : !Number.isFinite(retryAt) || retryAt <= now.getTime()
        if (due) {
          dueSessionIds.push(row.sessionId)
          if (dueSessionIds.length >= 10) break
        }
      }
      if (dueSessionIds.length >= 10 || rows.length < 100) break
      cursor = rows[rows.length - 1].sessionId
    }
    await Promise.all(
      dueSessionIds.map(async (sessionId) => {
        if (await claimAudioEnrichmentRetry(sessionId, now)) {
          await enrichElevateSessionAudio(sessionId)
        }
      }),
    )
  } finally {
    retrySweepRunning = false
  }
}

async function claimAudioEnrichmentRetry(
  sessionId: string,
  now: Date,
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await lockWritableSession(tx, sessionId)
    const metrics = await tx.sessionMetrics.findUnique({
      where: { sessionId },
      select: { processingStatus: true },
    })
    if (!metrics) return false
    const status =
      metrics.processingStatus &&
      typeof metrics.processingStatus === 'object' &&
      !Array.isArray(metrics.processingStatus)
        ? (metrics.processingStatus as Record<string, unknown>)
        : {}
    const state = status.audioEnrichmentStatus
    const retryAt = Date.parse(String(status.audioEnrichmentNextRetryAt ?? ''))
    const leaseUntil = Date.parse(String(status.audioEnrichmentLeaseUntil ?? ''))
    const eligible =
      (state === 'retry' &&
        (!Number.isFinite(retryAt) || retryAt <= now.getTime())) ||
      (state === 'processing' &&
        (!Number.isFinite(leaseUntil) || leaseUntil <= now.getTime()))
    if (!eligible) return false
    await tx.sessionMetrics.update({
      where: { sessionId },
      data: {
        processingStatus: {
          ...status,
          audioEnrichmentStatus: 'processing',
          audioEnrichmentLeaseId: randomUUID(),
          audioEnrichmentLeaseUntil: new Date(
            now.getTime() + 5 * 60_000,
          ).toISOString(),
        },
      },
    })
    return true
  })
}

export function startAudioEnrichmentRetryWorker(): void {
  if (retryTimer) return
  void sweepAudioEnrichmentRetries()
  retryTimer = setInterval(() => {
    void sweepAudioEnrichmentRetries()
  }, 60_000)
  retryTimer.unref?.()
}
