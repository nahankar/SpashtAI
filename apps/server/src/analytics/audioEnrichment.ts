import { prisma } from '../lib/prisma'
import { resolveElevateSessionAudio } from './insightProviders/resolveSessionAudio'
import {
  hasRealProsody,
  isUsableProsody,
  mergeProcessingStatus,
  resolveAudioStatus,
} from './audioStatus'
import { lockWritableSession } from '../lib/sessionDiscard'

const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')

const inFlight = new Set<string>()

export async function fetchProsodyForPath(sessionId: string, audioPath: string) {
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
  const data = await prosodyRes.json()
  const prosody = data?.prosody ?? null
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
  if (inFlight.has(sessionId)) return
  inFlight.add(sessionId)
  try {
    const resolved = await resolveElevateSessionAudio(sessionId)
    if (!resolved?.audioPath) return

    const metrics = await prisma.sessionMetrics.findUnique({
      where: { sessionId },
      select: { communicationSignals: true, processingStatus: true },
    })
    if (!metrics) return
    if (hasRealProsody(metrics.communicationSignals)) return

    const prosody = await fetchProsodyForPath(sessionId, resolved.audioPath)
    if (!hasRealProsody({ prosody })) {
      await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        const latest = await tx.sessionMetrics.findUnique({
          where: { sessionId },
          select: { processingStatus: true },
        })
        if (!latest) return
        await tx.sessionMetrics.update({
          where: { sessionId },
          data: {
            processingStatus: mergeProcessingStatus(latest.processingStatus, {
              audioStatus: 'available',
              audioProcessed: false,
            }),
          },
        })
      })
      return
    }

    await prisma.$transaction(async (tx) => {
      await lockWritableSession(tx, sessionId)
      const latest = await tx.sessionMetrics.findUnique({
        where: { sessionId },
        select: { communicationSignals: true, processingStatus: true },
      })
      if (!latest || hasRealProsody(latest.communicationSignals)) return
      const existing =
        latest.communicationSignals && typeof latest.communicationSignals === 'object'
          ? (latest.communicationSignals as Record<string, unknown>)
          : {}
      await tx.sessionMetrics.update({
        where: { sessionId },
        data: {
          communicationSignals: { ...existing, prosody },
          processingStatus: mergeProcessingStatus(latest.processingStatus, {
            audioStatus: resolveAudioStatus({ hasReadableRecording: true }),
            audioProcessed: true,
          }),
        },
      })
    })
  } catch (error) {
    console.warn(`[analytics] audio enrichment skipped for ${sessionId}:`, error)
  } finally {
    inFlight.delete(sessionId)
  }
}
