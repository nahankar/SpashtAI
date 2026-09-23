import { resolveElevateSessionAudio } from './insightProviders/resolveSessionAudio'
import { prisma } from '../lib/prisma'

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
}

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

function deliveryMomentsEnabled(): boolean {
  // Explicitly enable in production. Development stays on so the vertical
  // slice can be exercised locally without changing a developer's environment.
  return process.env.DELIVERY_MOMENTS_ENABLED === 'true' || process.env.NODE_ENV !== 'production'
}

/**
 * Inspect current evidence on read rather than persisting claims that can become
 * stale after a late segment upload. This is intentionally a P3.1a-only API;
 * later Northstar phases can promote the same shape into a durable moment store.
 */
export async function inspectDeliveryMoments(sessionId: string): Promise<DeliveryMomentInspection> {
  if (!deliveryMomentsEnabled()) {
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

  const [resolved, turns, segments] = await Promise.all([
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
      select: { audioStatus: true },
    }),
  ])

  if (!resolved) {
    const state = unresolvedAudioState(segments)
    return {
      status: {
        enabled: true,
        state,
        reason:
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
        state: 'pending',
        reason: 'committed_user_turns_required',
        inputSignature: resolved.inputSignature,
        validTurnCount: 0,
        momentCount: 0,
      },
      moments: [],
    }
  }

  const typedTurns = turns as CandidateTurn[]
  const validTurnCount = typedTurns.filter((turn) => validateTurnWordTiming(turn)).length
  if (!validTurnCount) {
    return {
      status: {
        enabled: true,
        state: 'suppressed',
        reason: 'validated_word_alignment_required',
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
  }
}
