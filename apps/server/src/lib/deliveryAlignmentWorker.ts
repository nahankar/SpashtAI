import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { resolveAgentPython } from './agentPython'
import { lockWritableSession } from './sessionDiscard'
import { resolveElevateAudioInputSignature, resolveElevateSessionAudio } from '../analytics/insightProviders/resolveSessionAudio'
import { ALIGNMENT_VERSION, committedTranscriptMatches, resolveCanonicalDeliveryPace, timelineSignature, transcriptSignature, validateAlignmentResult } from '../analytics/alignedDelivery'
import { calculateSkillScores, type TextSignals } from '../analytics/skillScores'
import { assessPaceEvidence } from '../analytics/pace'

const LEASE_MS = 20 * 60_000
const JOB_TIMEOUT_MS = 15 * 60_000
const MAX_ATTEMPTS = 5
const script = join(dirname(fileURLToPath(import.meta.url)), '../../../agent/align_delivery.py')
let running = false
let timer: NodeJS.Timeout | null = null
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
const object = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}

export function alignmentRetry(attempts: number, reason: string) {
  return {
    deliveryAlignmentStatus: attempts >= MAX_ATTEMPTS ? 'unavailable' : 'retry',
    deliveryAlignmentError: reason,
    deliveryAlignmentNextAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** attempts)),
  }
}

/** Call under the existing session lock when inputs change. No network work. */
export async function requestDeliveryAlignment(tx: Prisma.TransactionClient, sessionId: string, clearResult = false) {
  const scheduled = await tx.session.updateMany({
    where: { id: sessionId, module: 'elevate', discardedAt: null, endedAt: { not: null } },
    data: { deliveryAlignmentStatus: 'pending', deliveryAlignmentAttempts: 0,
      deliveryAlignmentError: null, deliveryAlignmentNextAt: new Date(Date.now() + 15_000),
      ...(clearResult ? { deliveryAlignmentResult: Prisma.DbNull } : {}) },
  })
  if (!scheduled.count) return
  const metrics = await tx.sessionMetrics.findUnique({ where: { sessionId } })
  const status = object(metrics?.processingStatus)
  if (object(status.pace).origin === 'post_session_alignment') {
    const pace = assessPaceEvidence(null, 0)
    const signals = object(metrics?.communicationSignals)
    const communicationSignals = { ...signals, speechRate: {
      ...object(signals.speechRate), wpm: 0, status: pace.status, source: null,
      confidence: 'low', variability: null, evidence: pace,
    } }
    const oldScores = object(metrics?.skillScores)
    await tx.sessionMetrics.update({ where: { sessionId }, data: {
      userWpm: 0, userSpeakingTime: 0,
      processingStatus: json({ ...status, pace }),
      ...(metrics?.communicationSignals ? { communicationSignals: json(communicationSignals) } : {}),
      ...(metrics?.skillScores ? { skillScores: json({ ...oldScores,
        scores: { ...object(oldScores.scores), pacing: null },
        components: { ...object(oldScores.components), pacing: null },
      }) } : {}),
    } })
  }
}

/** The session row is the durable queue; a global lease limits CPU work across replicas. */
export function queueDeliveryAlignment(sessionId: string): void {
  void prisma.$transaction(async tx => {
    await lockWritableSession(tx, sessionId)
    await requestDeliveryAlignment(tx, sessionId)
  }).catch(error => console.warn(`[delivery-alignment] could not schedule ${sessionId}:`, error))
}

export function runAlignmentProcess(payload: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // stdin avoids transcript/paths in process listings and argument-size limits.
    const child = spawn(resolveAgentPython(), [script], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    let forceKill: NodeJS.Timeout | undefined
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      error ? reject(error) : resolve(result)
    }
    const stop = (reason: string) => {
      child.kill('SIGTERM') // Python unwinds its temporary-directory context.
      forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000)
      forceKill.unref?.()
      finish(new Error(reason))
    }
    const timeout = setTimeout(() => stop('alignment_timeout'), JOB_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      output += chunk.toString()
      if (!settled && output.length > 8_000_000) stop('alignment_output_limit')
    })
    child.stderr.resume() // Python errors deliberately exclude transcripts.
    child.stdin.on('error', () => finish(new Error('alignment_input_failed')))
    child.on('error', () => finish(new Error('alignment_process_unavailable')))
    child.on('close', code => {
      if (forceKill) clearTimeout(forceKill)
      if (code !== 0) return finish(new Error('alignment_service_failed'))
      try { finish(undefined, JSON.parse(output)) } catch { finish(new Error('invalid_alignment_output')) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

async function processSession(sessionId: string, owner: string): Promise<void> {
  const snapshot = await prisma.session.findUnique({ where: { id: sessionId }, include: {
    transcript: true,
    turns: { where: { role: 'user' }, orderBy: { sequenceNo: 'asc' } },
    segments: { include: { recording: true } },
  } })
  if (!snapshot?.endedAt || snapshot.discardedAt) return
  if (!committedTranscriptMatches(snapshot.turns, snapshot.transcript?.conversationData)) {
    throw new Error('waiting_for_complete_transcript')
  }
  const resolved = await resolveElevateSessionAudio(sessionId, { requireCompleteSegments: true })
  if (!resolved || !snapshot.turns.length) throw new Error('waiting_for_recording_or_transcript')
  // Room/composite recordings contain coach speech and cannot certify user delivery.
  const inputs = new Set(resolved.segments.map(s => s.segmentId))
  if (!inputs.size || snapshot.turns.some(t => !t.segmentId || !inputs.has(t.segmentId)) ||
      snapshot.segments.filter(s => inputs.has(s.id)).some(s => s.recording?.recordingType !== 'user')) {
    throw new Error('complete_user_audio_required')
  }
  const signature = transcriptSignature(snapshot.turns)
  const payload = { audioPath: resolved.audioPath, segments: resolved.segments,
    turns: snapshot.turns.map(t => ({ id: t.id, segmentId: t.segmentId, text: t.text })) }
  const stored = object(snapshot.deliveryAlignmentResult)
  const reusable = stored.version === ALIGNMENT_VERSION && stored.inputSignature === resolved.inputSignature &&
    stored.transcriptSignature === signature && stored.timelineSignature === timelineSignature(resolved.segments)
  const raw = reusable ? stored : await runAlignmentProcess(payload)
  const result = validateAlignmentResult(raw, snapshot.turns, resolved.segments, resolved.inputSignature)
  if (!result.turns.length) throw new Error('alignment_coverage_insufficient')

  await prisma.$transaction(async tx => {
    await lockWritableSession(tx, sessionId)
    const lease = await tx.deliveryAlignmentLease.findUnique({ where: { id: 'automatic' } })
    if (lease?.owner !== owner || !lease.expiresAt || lease.expiresAt.getTime() <= Date.now()) return
    const latest = await tx.session.findUnique({ where: { id: sessionId }, include: {
      turns: { where: { role: 'user' }, orderBy: { sequenceNo: 'asc' } }, metrics: true, transcript: true,
    } })
    if (!latest?.endedAt || latest.discardedAt) return
    if (!committedTranscriptMatches(latest.turns, latest.transcript?.conversationData) ||
        transcriptSignature(latest.turns) !== signature ||
        await resolveElevateAudioInputSignature(sessionId, tx) !== resolved.inputSignature) {
      await requestDeliveryAlignment(tx, sessionId)
      return
    }
    const currentStatus = object(latest.metrics?.processingStatus)
    const expectedWords = latest.turns.reduce((sum, t) => sum + t.text.trim().split(/\s+/).length, 0)
    const { pace, variability } = resolveCanonicalDeliveryPace({
      turns: latest.turns, result, inputSignature: resolved.inputSignature, segments: resolved.segments,
      transcript: latest.transcript?.conversationData, processingStatus: currentStatus, expectedWords,
    })
    const signals = object(latest.metrics?.communicationSignals)
    const communicationSignals = { ...signals, speechRate: { ...object(signals.speechRate),
      wpm: pace.wpm ?? 0, status: pace.status, source: pace.source, confidence: pace.confidence,
      totalWords: latest.turns.reduce((sum, t) => sum + t.text.trim().split(/\s+/).length, 0),
      variability, evidence: pace,
    } }
    // Content signals may not exist yet. Later /analyze picks up the pace block.
    let scores: unknown = undefined
    if (signals.fillers && signals.vocabDiversity && signals.sentenceComplexity && signals.hedging &&
        signals.ideaStructure && signals.topicCoherence && signals.interactionSignals &&
        signals.talkListenBalance && signals.questionHandling) {
      scores = calculateSkillScores(communicationSignals as unknown as TextSignals, latest.metrics?.totalTurns ?? latest.turns.length)
    }
    const data = {
      processingStatus: json({ ...currentStatus, pace }),
      ...(pace.wpm != null ? { userWpm: pace.wpm, userSpeakingTime: pace.speakingSeconds } : {}),
      ...(latest.metrics?.communicationSignals ? { communicationSignals: json(communicationSignals) } : {}),
      ...(scores ? { skillScores: json(scores) } : {}),
    }
    await tx.sessionMetrics.upsert({ where: { sessionId }, create: { sessionId, ...data }, update: data })
    await tx.session.update({ where: { id: sessionId }, data: {
      deliveryAlignmentStatus: 'completed', deliveryAlignmentError: null,
      deliveryAlignmentNextAt: null, deliveryAlignmentResult: json(result),
    } })
  })
}

export async function sweepDeliveryAlignment(): Promise<void> {
  if (running || process.env.AUTO_DELIVERY_ALIGNMENT_ENABLED === 'false') return
  running = true
  const owner = randomUUID()
  let claimed = false
  try {
    const now = new Date()
    const claim = await prisma.deliveryAlignmentLease.updateMany({ where: {
      id: 'automatic', OR: [{ expiresAt: null }, { expiresAt: { lte: now } }],
    }, data: { owner, expiresAt: new Date(Date.now() + LEASE_MS) } })
    if (!claim.count) return
    claimed = true
    // One job per tick keeps startup and resource use bounded. Expired processing
    // jobs resume after the global lease expires, including after API restarts.
    const job = await prisma.session.findFirst({ where: {
      module: 'elevate', endedAt: { not: null }, discardedAt: null,
      deliveryAlignmentStatus: { in: ['pending', 'retry', 'processing'] },
      OR: [{ deliveryAlignmentNextAt: null }, { deliveryAlignmentNextAt: { lte: now } }],
    }, orderBy: [{ deliveryAlignmentNextAt: 'asc' }, { id: 'asc' }] })
    if (!job) return
    await prisma.session.updateMany({ where: { id: job.id, discardedAt: null }, data: {
      deliveryAlignmentStatus: 'processing', deliveryAlignmentAttempts: { increment: 1 },
    } })
    try { await processSession(job.id, owner) } catch (error) {
      const reason = error instanceof Error ? error.message : 'alignment_failed'
      await prisma.$transaction(async tx => {
        // Fence failure updates too: an upload may have requeued this session.
        const lease = await tx.deliveryAlignmentLease.findUnique({ where: { id: 'automatic' } })
        if (lease?.owner !== owner) return
        await tx.session.updateMany({ where: { id: job.id, discardedAt: null, deliveryAlignmentStatus: 'processing' },
          data: alignmentRetry(job.deliveryAlignmentAttempts + 1, reason) })
      })
      console.warn(`[delivery-alignment] ${job.id}: ${reason}`)
    }
  } catch (error) {
    console.error('[delivery-alignment] sweep failed:', error)
  } finally {
    if (claimed) await prisma.deliveryAlignmentLease.updateMany({ where: { id: 'automatic', owner },
      data: { owner: null, expiresAt: null } }).catch(() => {})
    running = false
  }
}

export function startDeliveryAlignmentWorker(): void {
  if (timer) return
  void sweepDeliveryAlignment()
  timer = setInterval(() => { void sweepDeliveryAlignment() }, 60_000)
  timer.unref?.()
}
