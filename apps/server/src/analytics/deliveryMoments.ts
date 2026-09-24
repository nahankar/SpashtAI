import { createHash } from 'crypto'
import { applyAlignedDelivery } from './alignedDelivery'
import {
  resolveElevateSessionAudio,
  type ResolvedAudioSegment,
} from './insightProviders/resolveSessionAudio'
import { isFeatureAccessible } from '../lib/featureFlags'
import { prisma } from '../lib/prisma'
import {
  appliedCaptureSettings,
  captureFingerprint,
  captureSettingsForDelivery,
  type StoredCaptureSettings,
} from './deliveryCapture'

/**
 * P3.1a is deliberately a small, conservative first delivery-evidence slice.
 * A pause is eligible only when it is bounded by real word timestamps from a
 * committed user turn and the complete user recording is available.  It is
 * not a claim about personality, emotion, or vocal health.
 */

const ACTUAL_WORD_TIMING = new Set(['actual', 'forced_alignment'])
const MIN_ALIGNMENT_COVERAGE = 0.95
const MIN_TURN_WORDS = 8
const MIN_HELPFUL_PAUSE_SEC = 0.45
const MAX_HELPFUL_PAUSE_SEC = 1.5
const MIN_MID_THOUGHT_PAUSE_SEC = 0.9
const MAX_MID_THOUGHT_PAUSE_SEC = 2
const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')
const DELIVERY_ANALYZER_VERSION = 'delivery-raw-v1'
const deliveryEvidenceInFlight = new Map<string, Promise<DeliveryEvidenceDisplay>>()
const deliveryEvidenceCache = new Map<string, {
  expiresAt: number
  value: DeliveryEvidenceDisplay
}>()
const DELIVERY_EVIDENCE_CACHE_TTL_MS = 5 * 60_000
const DELIVERY_EVIDENCE_CACHE_LIMIT = 100

export type DeliveryMomentKind = 'sentence_boundary_pause' | 'mid_thought_pause'
export type DeliveryMomentPolarity = 'strength' | 'opportunity'

export interface DeliveryMoment {
  id: string
  turnId: string
  turnIndex: number
  kind: DeliveryMomentKind
  polarity: DeliveryMomentPolarity
  startSec: number
  endSec: number
  clipStartSec: number
  clipEndSec: number
  pauseSeconds: number
  confidence: number
  observation: string
  interpretation: string
  retry: string
  quality: {
    alignmentCoverage: number
    timingOrigin: 'actual' | 'forced_alignment'
    completeAudio: true
  }
}

export interface DeliveryMomentStatus {
  enabled: boolean
  state: 'available' | 'pending' | 'suppressed'
  reason:
    | 'feature_disabled'
    | 'complete_recording_required'
    | 'complete_recording_unavailable'
    | 'committed_user_turns_required'
    | 'validated_word_alignment_required'
    | 'alignment_processing'
    | 'alignment_unavailable'
    | 'no_notable_pause'
    | null
  inputSignature: string | null
  validTurnCount: number
  momentCount: number
}

interface WordTiming {
  w: string
  start: number
  end: number
  timingOrigin: 'actual' | 'forced_alignment'
}

interface CandidateTurn {
  id: string
  turnIndex: number
  segmentId: string | null
  role: string
  text: string
  audioStart: number | null
  audioEnd: number | null
  words: unknown
}

export interface DeliveryMomentInspection {
  status: DeliveryMomentStatus
  moments: DeliveryMoment[]
  deliveryEvidence?: DeliveryEvidenceDisplay
}

export type DeliveryEvidenceMetric = 'pause_duration' | 'mean_f0' | 'f0_spread' | 'intensity'

interface DeliveryEvidenceDisplayBase {
  id: string
  clip: { startSeconds: number; durationSeconds: number; availability: 'available' | 'unavailable' }
  provenance: { audioInputSignature: string; analyzerVersion: string }
  capture: { agc: 'on' | 'off' | 'unknown'; noiseSuppression: 'on' | 'off' | 'unknown' }
  captureFingerprint: string
  calibration: { state: 'experimental' }
}

export type DeliveryEvidenceDisplayMoment = DeliveryEvidenceDisplayBase & (
  | {
      evidence: {
        quality: 'verified'
        method: 'validated_acoustic_extraction' | 'word_aligned_recording'
        measurement: { metric: DeliveryEvidenceMetric; value: number; unit: 'seconds' | 'Hz' | 'dB' }
      }
    }
  | { evidence: { quality: 'insufficient'; reason: 'insufficient_signal' } }
)

export type DeliveryEvidenceDisplay =
  | { state: 'ready'; moments: DeliveryEvidenceDisplayMoment[] }
  | { state: 'empty' }
  | { state: 'insufficient_evidence'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; message: string }

/** Only an in-flight upload merits a retrying UI state. */
export function unresolvedAudioState(
  segments: Array<{ audioStatus: string }>,
): 'pending' | 'suppressed' {
  return segments.some((segment) => segment.audioStatus === 'pending')
    ? 'pending'
    : 'suppressed'
}

function wordToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9']/g, '')
}

function transcriptTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map(wordToken)
    .filter(Boolean)
}

function isSentenceBoundary(word: string): boolean {
  return /[.!?…][”"')\]]*$/.test(word.trim())
}

function isClauseBoundary(word: string): boolean {
  return /[,;:—–-][”"')\]]*$/.test(word.trim())
}

function timingOrigin(value: Record<string, unknown>): 'actual' | 'forced_alignment' | null {
  const raw = typeof value.timingOrigin === 'string'
    ? value.timingOrigin
    : typeof value.timing_origin === 'string'
      ? value.timing_origin
      : ''
  return ACTUAL_WORD_TIMING.has(raw) ? (raw as 'actual' | 'forced_alignment') : null
}

/** Returns word timing only after strict transcript, ordering, and containment checks. */
export function validateTurnWordTiming(turn: CandidateTurn): {
  words: WordTiming[]
  coverage: number
} | null {
  if (turn.role !== 'user' || !Array.isArray(turn.words)) return null
  const expected = transcriptTokens(turn.text)
  if (expected.length < MIN_TURN_WORDS) return null

  const words: WordTiming[] = []
  let previousEnd = -1
  for (const raw of turn.words) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const value = raw as Record<string, unknown>
    const w = typeof value.w === 'string'
      ? value.w
      : typeof value.word === 'string'
        ? value.word
        : ''
    if (typeof value.start !== 'number' || typeof value.end !== 'number') return null
    const start = value.start
    const end = value.end
    const origin = timingOrigin(value)
    if (!w || !origin || !Number.isFinite(start) || !Number.isFinite(end)) return null
    if (start < 0 || end <= start || start < previousEnd) return null
    if (
      (turn.audioStart != null && start < turn.audioStart - 0.25) ||
      (turn.audioEnd != null && end > turn.audioEnd + 0.25)
    ) return null
    words.push({ w, start, end, timingOrigin: origin })
    previousEnd = end
  }

  const actual = words.map((word) => wordToken(word.w)).filter(Boolean)
  const coverage = expected.length ? actual.length / expected.length : 0
  if (coverage < MIN_ALIGNMENT_COVERAGE || coverage > 1.05) return null
  const comparable = Math.min(expected.length, actual.length)
  const positionalMatch = comparable
    ? actual.slice(0, comparable).filter((word, index) => word === expected[index]).length / comparable
    : 0
  if (positionalMatch < 0.9) return null
  return { words, coverage }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function roundedSeconds(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Convert raw agent observations into the browser DTO.  This is intentionally
 * the sole translation boundary: browser code must not infer signatures,
 * calibration, units, or evidence quality from arbitrary worker JSON.
 */
export function toDeliveryEvidenceDisplay(
  response: unknown,
  inputSignature: string,
  capturesByTurn = new Map<string, StoredCaptureSettings | null>(),
): DeliveryEvidenceDisplay {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    return { state: 'error', message: 'The delivery analyzer returned an invalid response.' }
  }
  const body = response as Record<string, unknown>
  if (body.state === 'suppressed') {
    return {
      state: 'unavailable',
      reason: typeof body.reason === 'string' ? body.reason : 'Delivery evidence was suppressed.',
    }
  }
  if (body.state !== 'available' && body.state !== 'insufficient_evidence') {
    return { state: 'error', message: 'The delivery analyzer returned an unknown evidence state.' }
  }
  if (!Array.isArray(body.observations)) {
    return { state: 'error', message: 'The delivery analyzer returned no observation list.' }
  }
  if (body.state === 'insufficient_evidence') {
    const observations = body.observations.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item),
    )
    const reason = observations.some((item) => item.evidence_state === 'insufficient_evidence')
      ? 'insufficient_voiced_signal'
      : typeof body.reason === 'string'
        ? body.reason
        : typeof observations[0]?.suppression_reason === 'string'
          ? observations[0].suppression_reason
          : 'verified_measurements_unavailable'
    return { state: 'insufficient_evidence', reason }
  }

  const moments: DeliveryEvidenceDisplayMoment[] = []
  for (const raw of body.observations) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const observation = raw as Record<string, unknown>
    if (
      observation.audio_input_signature !== inputSignature ||
      observation.analyzer_version !== DELIVERY_ANALYZER_VERSION
    ) continue
    if (observation.evidence_state !== 'available' &&
        observation.evidence_state !== 'insufficient_evidence') continue
    const turnId = typeof observation.turn_id === 'string' ? observation.turn_id : null
    const clipStart = finite(observation.clip_start_sec)
    const clipEnd = finite(observation.clip_end_sec)
    const rawFeatures = observation.raw_features
    if (!turnId || clipStart == null || clipEnd == null || clipEnd <= clipStart ||
      !rawFeatures || typeof rawFeatures !== 'object' || Array.isArray(rawFeatures)) continue
    const features = rawFeatures as Record<string, unknown>
    // The agent can return other data in the future, but this surface is
    // deliberately limited to measurements extracted from verified word
    // spans. Do not let a turn-wide or synthetic measurement acquire the
    // stronger "verified" label just because its field names look familiar.
    if (features.measurement_basis !== 'verified_word_spans') continue
    const caveats = Array.isArray(observation.capture_caveats)
      ? observation.capture_caveats.map(String)
      : []
    const settings = capturesByTurn.get(turnId)
    const flag = (value: boolean | null | undefined) =>
      value === true ? 'on' as const : value === false ? 'off' as const : 'unknown' as const
    const capture = settings
      ? {
          agc: flag(settings.autoGainControl.applied),
          noiseSuppression: flag(settings.noiseSuppression.applied),
        }
      : {
          agc: caveats.includes('automatic_gain_control_enabled') ? 'on' as const : 'unknown' as const,
          noiseSuppression: caveats.includes('noise_suppression_enabled') ? 'on' as const : 'unknown' as const,
        }
    const base = {
      clip: {
        startSeconds: roundedSeconds(clipStart),
        durationSeconds: roundedSeconds(clipEnd - clipStart),
        availability: 'available' as const,
      },
      provenance: {
        audioInputSignature: inputSignature,
        analyzerVersion: DELIVERY_ANALYZER_VERSION,
      },
      capture,
      captureFingerprint: settings
        ? captureFingerprint(settings)
        : `agc:${capture.agc}|noise:${capture.noiseSuppression}|capture:unknown`,
      calibration: { state: 'experimental' as const },
    }
    if (observation.evidence_state === 'insufficient_evidence') {
      moments.push({
        id: `${turnId}:insufficient-voice`,
        ...base,
        evidence: { quality: 'insufficient', reason: 'insufficient_signal' },
      })
      continue
    }
    const add = (
      suffix: string,
      metric: DeliveryEvidenceMetric,
      value: number | null,
      unit: 'seconds' | 'Hz' | 'dB',
      method: 'validated_acoustic_extraction' | 'word_aligned_recording',
    ) => {
      if (value == null ||
          (metric === 'mean_f0' && value <= 0) ||
          (metric === 'f0_spread' && value < 0) ||
          (metric === 'pause_duration' && value <= 0)) return
      moments.push({
        id: `${turnId}:${suffix}`,
        ...base,
        evidence: { quality: 'verified', method, measurement: { metric, value, unit } },
      })
    }
    add('mean-f0', 'mean_f0', finite(features.mean_f0_hz), 'Hz', 'validated_acoustic_extraction')
    add('f0-spread', 'f0_spread', finite(features.f0_spread_hz), 'Hz', 'validated_acoustic_extraction')
    add('intensity', 'intensity', finite(features.intensity_mean_db), 'dB', 'validated_acoustic_extraction')
    const pauses = Array.isArray(features.pause_intervals) ? features.pause_intervals : []
    pauses.forEach((pause, index) => {
      if (!pause || typeof pause !== 'object' || Array.isArray(pause)) return
      const interval = pause as Record<string, unknown>
      const start = finite(interval.start_sec)
      const end = finite(interval.end_sec)
      const duration = finite(interval.duration_sec)
      if (
        start == null || end == null || duration == null || duration <= 0 || end <= start ||
        start < clipStart - 1e-6 || end > clipEnd + 1e-6 ||
        Math.abs((end - start) - duration) > 1e-3
      ) return
      const pauseClipStart = Math.max(0, start - 0.8)
      const pauseClipEnd = Math.min(clipEnd, end + 0.8)
      moments.push({
        id: `${turnId}:pause:${index}`,
        ...base,
        clip: {
          startSeconds: roundedSeconds(pauseClipStart),
          durationSeconds: roundedSeconds(pauseClipEnd - pauseClipStart),
          availability: 'available',
        },
        evidence: {
          quality: 'verified',
          method: 'word_aligned_recording',
          measurement: { metric: 'pause_duration', value: duration, unit: 'seconds' },
        },
      })
    })
  }
  if (moments.length) return { state: 'ready', moments }
  if (body.observations.length === 0) return { state: 'empty' }
  const mismatchedInput = body.observations.some((item) =>
    item && typeof item === 'object' && !Array.isArray(item) &&
    (item.audio_input_signature !== inputSignature ||
      item.analyzer_version !== DELIVERY_ANALYZER_VERSION)
  )
  return mismatchedInput
    ? { state: 'unavailable', reason: 'audio_signature_mismatch' }
    : { state: 'insufficient_evidence', reason: 'verified_measurements_unavailable' }
}

export async function extractDeliveryEvidence(input: {
  sessionId: string
  audioPath: string
  inputSignature: string
  segments: ResolvedAudioSegment[]
  turns: CandidateTurn[]
  capturesBySegment: Map<string, StoredCaptureSettings | null>
}): Promise<DeliveryEvidenceDisplay> {
  const turns = input.turns.flatMap((turn) => {
    const validated = validateTurnWordTiming(turn)
    if (!validated || turn.audioStart == null || turn.audioEnd == null) return []
    return [{
      turnId: turn.id,
      segmentId: turn.segmentId,
      audioStart: turn.audioStart,
      audioEnd: turn.audioEnd,
      alignmentCoverage: validated.coverage,
      words: validated.words.map((word) => ({
        w: word.w,
        start: word.start,
        end: word.end,
        timingOrigin: word.timingOrigin,
      })),
    }]
  })
  if (!turns.length) {
    return { state: 'insufficient_evidence', reason: 'validated_turn_audio_timing_unavailable' }
  }
  const segmentInputs = input.segments.map((segment) => ({
    segmentId: segment.segmentId,
    replayOffsetSec: segment.replayOffsetSec,
    durationSec: segment.durationSec,
    audioAvailable: true,
    capture: appliedCaptureSettings(input.capturesBySegment.get(segment.segmentId) ?? null),
  }))
  const evidenceFingerprint = createHash('sha256')
    .update(JSON.stringify({
      turns,
      segmentInputs,
      captureFingerprints: input.segments.map((segment) =>
        captureFingerprint(input.capturesBySegment.get(segment.segmentId) ?? null),
      ),
    }))
    .digest('hex')
  const cacheKey = `${input.sessionId}:${input.inputSignature}:${evidenceFingerprint}`
  const cached = deliveryEvidenceCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) deliveryEvidenceCache.delete(cacheKey)
  const current = deliveryEvidenceInFlight.get(cacheKey)
  if (current) return current
  const task: Promise<DeliveryEvidenceDisplay> = (async (): Promise<DeliveryEvidenceDisplay> => {
    try {
      const response = await fetch(`${SIGNAL_API_URL}/extract-delivery-features`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-agent-token': INTERNAL_AGENT_TOKEN,
        },
        body: JSON.stringify({
          sessionId: input.sessionId,
          audioPath: input.audioPath,
          audioInputSignature: input.inputSignature,
          expectedAudioInputSignature: input.inputSignature,
          analyzerVersion: DELIVERY_ANALYZER_VERSION,
          completeSegmentAudio: true,
          segments: segmentInputs,
          turns,
        }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) {
        return { state: 'error', message: 'Delivery evidence could not be analyzed.' }
      }
      const capturesByTurn = new Map(turns.map((turn) => [
        turn.turnId,
        input.capturesBySegment.get(turn.segmentId ?? '') ?? null,
      ]))
      return toDeliveryEvidenceDisplay(await response.json(), input.inputSignature, capturesByTurn)
    } catch (error) {
      console.warn(`[delivery] raw observation extraction failed for ${input.sessionId}:`, error)
      return { state: 'error', message: 'Delivery evidence could not be analyzed.' }
    }
  })()
  deliveryEvidenceInFlight.set(cacheKey, task)
  try {
    const result = await task
    // The signature is derived from every expected recording segment, so a
    // late upload produces a distinct key rather than serving stale evidence.
    // Do not cache transport/analyzer errors: a transient outage should retry.
    if (result.state !== 'error') {
      deliveryEvidenceCache.set(cacheKey, {
        value: result,
        expiresAt: Date.now() + DELIVERY_EVIDENCE_CACHE_TTL_MS,
      })
      while (deliveryEvidenceCache.size > DELIVERY_EVIDENCE_CACHE_LIMIT) {
        const oldest = deliveryEvidenceCache.keys().next().value
        if (oldest === undefined) break
        deliveryEvidenceCache.delete(oldest)
      }
    }
    return result
  } finally {
    deliveryEvidenceInFlight.delete(cacheKey)
  }
}

/** Build at most one clearly helpful boundary pause and one disruptive mid-thought pause. */
export function findDeliveryPauseMoments(
  turns: CandidateTurn[],
  replayOffsets = new Map<string, number>(),
  totalDurationSec = Number.POSITIVE_INFINITY,
  segmentDurations = new Map<string, number>(),
): DeliveryMoment[] {
  const strengths: DeliveryMoment[] = []
  const opportunities: DeliveryMoment[] = []

  for (const turn of turns) {
    const validated = validateTurnWordTiming(turn)
    if (!validated) continue
    const segmentDuration = turn.segmentId
      ? segmentDurations.get(turn.segmentId)
      : undefined
    if (
      segmentDuration != null &&
      (!Number.isFinite(segmentDuration) ||
        validated.words.some((word) => word.end > segmentDuration + 0.25))
    ) {
      continue
    }
    const offset = turn.segmentId ? replayOffsets.get(turn.segmentId) ?? 0 : 0
    for (let index = 0; index < validated.words.length - 1; index += 1) {
      const previous = validated.words[index]
      const next = validated.words[index + 1]
      const pauseSeconds = next.start - previous.end
      const startSec = previous.end + offset
      const endSec = next.start + offset
      const confidence = Math.min(0.98, 0.8 + validated.coverage * 0.15)
      const common = {
        turnId: turn.id,
        turnIndex: turn.turnIndex,
        startSec,
        endSec,
        clipStartSec: Math.max(0, startSec - 0.8),
        clipEndSec: Math.min(totalDurationSec, endSec + 0.8),
        pauseSeconds,
        confidence,
        quality: {
          alignmentCoverage: validated.coverage,
          timingOrigin: previous.timingOrigin,
          completeAudio: true as const,
        },
      }

      if (
        isSentenceBoundary(previous.w) &&
        pauseSeconds >= MIN_HELPFUL_PAUSE_SEC &&
        pauseSeconds <= MAX_HELPFUL_PAUSE_SEC
      ) {
        strengths.push({
          id: `${turn.id}:sentence-boundary:${index}`,
          kind: 'sentence_boundary_pause',
          polarity: 'strength',
          observation: `A ${pauseSeconds.toFixed(1)} second pause followed a completed sentence.`,
          interpretation: 'This gave the listener a brief moment to absorb the point.',
          retry: 'Use a similarly brief pause after your next key sentence.',
          ...common,
        })
      }

      if (
        !isSentenceBoundary(previous.w) &&
        // A deliberate comma/semicolon pause may be good delivery, not an
        // interruption. P3.1a does not yet have enough context to classify it.
        !isClauseBoundary(previous.w) &&
        index >= 2 &&
        index + 3 < validated.words.length &&
        pauseSeconds >= MIN_MID_THOUGHT_PAUSE_SEC &&
        pauseSeconds <= MAX_MID_THOUGHT_PAUSE_SEC
      ) {
        opportunities.push({
          id: `${turn.id}:mid-thought:${index}`,
          kind: 'mid_thought_pause',
          polarity: 'opportunity',
          observation: `A ${pauseSeconds.toFixed(1)} second pause occurred within a sentence.`,
          interpretation: 'The pause may interrupt the flow of this phrase.',
          retry: 'Try linking these two parts of the sentence with a shorter pause.',
          ...common,
        })
      }
    }
  }

  const longest = <T extends DeliveryMoment>(items: T[]) =>
    items.reduce<T | null>((best, item) => (!best || item.pauseSeconds > best.pauseSeconds ? item : best), null)
  return [longest(strengths), longest(opportunities)]
    .filter((moment): moment is DeliveryMoment => moment != null)
    .sort((a, b) => a.startSec - b.startSec)
}

export async function deliveryMomentsEnabled(): Promise<boolean> {
  // Admin is the single release control.  Failing closed avoids exposing a
  // partially released analytical capability when the flag store is down.
  try {
    return await isFeatureAccessible('delivery_moments')
  } catch (error) {
    console.error('Delivery Moments feature flag check failed:', error)
    return false
  }
}

/**
 * Inspect current evidence on read rather than persisting claims that can become
 * stale after a late segment upload. This is intentionally a P3.1a-only API;
 * later Northstar phases can promote the same shape into a durable moment store.
 */
export async function inspectDeliveryMoments(sessionId: string): Promise<DeliveryMomentInspection> {
  if (!(await deliveryMomentsEnabled())) {
    return {
      status: {
        enabled: false,
        state: 'suppressed',
        reason: 'feature_disabled',
        inputSignature: null,
        validTurnCount: 0,
        momentCount: 0,
      },
      moments: [],
    }
  }

  const [resolved, turns, segments, alignment] = await Promise.all([
    resolveElevateSessionAudio(sessionId, { requireCompleteSegments: true }),
    prisma.sessionTurn.findMany({
      where: { sessionId, role: 'user' },
      orderBy: { sequenceNo: 'asc' },
      select: {
        id: true,
        turnIndex: true,
        segmentId: true,
        role: true,
        text: true,
        audioStart: true,
        audioEnd: true,
        words: true,
      },
    }),
    prisma.sessionSegment.findMany({
      where: { sessionId },
      select: { id: true, audioStatus: true, captureSettings: true },
    }),
    prisma.session.findUnique({ where: { id: sessionId }, select: {
      deliveryAlignmentStatus: true, deliveryAlignmentResult: true,
    } }),
  ])

  if (!resolved) {
    const exhausted = alignment?.deliveryAlignmentStatus === 'unavailable'
    const state = exhausted ? 'suppressed' : unresolvedAudioState(segments)
    return {
      status: {
        enabled: true,
        state,
        reason: exhausted ? 'alignment_unavailable' :
          state === 'pending'
            ? 'complete_recording_required'
            : 'complete_recording_unavailable',
        inputSignature: null,
        validTurnCount: 0,
        momentCount: 0,
      },
      moments: [],
    }
  }
  if (turns.length === 0) {
    return {
      status: {
        enabled: true,
        state: alignment?.deliveryAlignmentStatus === 'unavailable' ? 'suppressed' : 'pending',
        reason: alignment?.deliveryAlignmentStatus === 'unavailable' ? 'alignment_unavailable' : 'committed_user_turns_required',
        inputSignature: resolved.inputSignature,
        validTurnCount: 0,
        momentCount: 0,
      },
      moments: [],
    }
  }

  const typedTurns = applyAlignedDelivery(turns as CandidateTurn[], alignment?.deliveryAlignmentResult,
    resolved.inputSignature, resolved.segments)
  const validTurnCount = typedTurns.filter((turn) => validateTurnWordTiming(turn)).length
  if (!validTurnCount) {
    return {
      status: {
        enabled: true,
        state: ['pending', 'processing', 'retry'].includes(alignment?.deliveryAlignmentStatus ?? '') ? 'pending' : 'suppressed',
        reason: ['pending', 'processing', 'retry'].includes(alignment?.deliveryAlignmentStatus ?? '')
          ? 'alignment_processing'
          : alignment?.deliveryAlignmentStatus === 'unavailable'
            ? 'alignment_unavailable' : 'validated_word_alignment_required',
        inputSignature: resolved.inputSignature,
        validTurnCount: 0,
        momentCount: 0,
      },
      moments: [],
    }
  }

  const offsets = new Map(resolved.segments.map((segment) => [segment.segmentId, segment.replayOffsetSec]))
  const segmentDurations = new Map(
    resolved.segments.map((segment) => [segment.segmentId, segment.durationSec]),
  )
  const totalDuration = resolved.segments.reduce(
    (end, segment) => Math.max(end, segment.replayOffsetSec + segment.durationSec),
    0,
  )
  const moments = findDeliveryPauseMoments(
    typedTurns,
    offsets,
    totalDuration || Number.POSITIVE_INFINITY,
    segmentDurations,
  )
  const deliveryEvidence = await extractDeliveryEvidence({
    sessionId,
    audioPath: resolved.audioPath,
    inputSignature: resolved.inputSignature,
    segments: resolved.segments,
    turns: typedTurns,
    capturesBySegment: new Map(segments.map((segment) => [
      segment.id,
      captureSettingsForDelivery(segment.id, segment.captureSettings),
    ])),
  })
  return {
    status: {
      enabled: true,
      state: 'available',
      reason: moments.length ? null : 'no_notable_pause',
      inputSignature: resolved.inputSignature,
      validTurnCount,
      momentCount: moments.length,
    },
    moments,
    deliveryEvidence,
  }
}
