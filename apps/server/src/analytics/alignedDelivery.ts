import { createHash } from 'crypto'
import { assessPaceEvidence, derivePaceEvidenceFromTurns, measuredTurnVariability, readPersistedPaceEvidence, selectBestPaceEvidence, selectPreferredPaceAssessment } from './pace'
import { clockSignatureFromStatus, LIVE_RECORDING_CLOCK_VERSION } from './recordingClockMap'
import type { ResolvedAudioSegment } from './insightProviders/resolveSessionAudio'

export const ALIGNMENT_VERSION = 'delivery-alignment-v1'
export const HYBRID_ALIGNMENT_VERSION = 'delivery-alignment-hybrid-v1'
const MAX_UNMATCHED_WORDS = 2
const MIN_WORD_COVERAGE = 0.9
export interface AlignmentTurn {
  id: string
  role: string
  text: string
  segmentId: string | null
  words?: unknown
  metrics?: unknown
  audioStart?: number | null
  audioEnd?: number | null
}
interface AlignedWord {
  w: string
  start: number
  end: number
  timingOrigin: 'forced_alignment' | 'actual'
  tokenIndex: number
}
export interface AlignmentResult {
  version: string
  inputSignature: string
  transcriptSignature: string
  timelineSignature: string
  clockSignature?: string
  turns: Array<{ id: string; words: AlignedWord[] }>
}
function originForVersion(version: unknown): AlignedWord['timingOrigin'] | null {
  if (version === ALIGNMENT_VERSION) return 'forced_alignment'
  if (version === LIVE_RECORDING_CLOCK_VERSION) return 'actual'
  return null
}
function originForWord(version: unknown, wordOrigin: unknown): AlignedWord['timingOrigin'] | null {
  if (version === HYBRID_ALIGNMENT_VERSION) {
    return wordOrigin === 'actual' || wordOrigin === 'forced_alignment' ? wordOrigin : null
  }
  const expected = originForVersion(version)
  return wordOrigin === expected ? expected : null
}
function tokens(text: string): string[] {
  return text.split(/\s+/).map((word) => word.toLowerCase().replace(/[^\p{L}\p{N}_']/gu, '')).filter(Boolean)
}

/** Compare content, not endpoint boundaries: a logical response may span rows. */
export function fullUserTranscriptTokens(data: unknown): string[] | null {
  if (!data || typeof data !== 'object') return null
  const value = data as Record<string, unknown>
  const messages = Array.isArray(value.messages) ? value.messages : value.conversation
  if (!Array.isArray(messages)) return null
  const words: string[] = []
  for (const message of messages) {
    if (!message || typeof message !== 'object') return null
    if ((message.role ?? message.speaker) !== 'user') continue
    const text = message.content ?? message.text
    if (typeof text !== 'string') return null
    words.push(...tokens(text))
  }
  return words.length ? words : null
}

export function committedTranscriptMatches(turns: AlignmentTurn[], data: unknown): boolean {
  const full = fullUserTranscriptTokens(data)
  const committed = turns.filter(t => t.role === 'user').flatMap(t => tokens(t.text))
  return full != null && full.length === committed.length && full.every((word, i) => word === committed[i])
}
export function transcriptSignature(turns: AlignmentTurn[]): string {
  return createHash('sha256').update(JSON.stringify(turns.filter(t => t.role === 'user')
    .map(t => [t.id, t.segmentId, t.text]))).digest('hex')
}
export function timelineSignature(segments: ResolvedAudioSegment[]): string {
  return createHash('sha256').update(JSON.stringify(segments)).digest('hex')
}

/** Worker output is untrusted until lexical, provenance and segment checks pass. */
export function validateAlignmentResult(
  raw: unknown, turns: AlignmentTurn[], segments: ResolvedAudioSegment[], inputSignature: string,
): AlignmentResult {
  const value = raw as Partial<AlignmentResult> | null
  const knownVersion = value?.version === ALIGNMENT_VERSION
    || value?.version === LIVE_RECORDING_CLOCK_VERSION
    || value?.version === HYBRID_ALIGNMENT_VERSION
  if (!value || !knownVersion || !Array.isArray(value.turns)) {
    throw new Error('invalid_alignment_result')
  }
  const clockBound = value.version === LIVE_RECORDING_CLOCK_VERSION || value.version === HYBRID_ALIGNMENT_VERSION
  const clockSignature = clockBound ? value.clockSignature : undefined
  if (clockBound && (typeof clockSignature !== 'string' || !clockSignature)) {
    throw new Error('invalid_alignment_result')
  }
  const durations = new Map(segments.map(s => [s.segmentId, s.durationSec]))
  const seen = new Set<string>()
  const byId = new Map(turns.filter(t => t.role === 'user').map(t => [t.id, t]))
  const validated = value.turns.map(item => {
    const turn = byId.get(item.id)
    if (!turn || seen.has(item.id) || !Array.isArray(item.words) || !item.words.length) {
      throw new Error('invalid_alignment_turn')
    }
    seen.add(item.id)
    const duration = durations.get(turn.segmentId ?? '')
    const expected = tokens(turn.text)
    if (!duration || !expected.length || item.words.length > expected.length) throw new Error('incomplete_turn_alignment')
    const missing = expected.length - item.words.length
    if (missing > MAX_UNMATCHED_WORDS || (missing > 0 && item.words.length / expected.length < MIN_WORD_COVERAGE)) {
      throw new Error('incomplete_turn_alignment')
    }
    let end = 0
    let previousIndex = -1
    const words = item.words.map((w, i): AlignedWord => {
      const origin = originForWord(value.version, w.timingOrigin)
      const tokenIndex = typeof w.tokenIndex === 'number' && Number.isInteger(w.tokenIndex) ? w.tokenIndex : i
      if (!origin || typeof w.w !== 'string' || tokenIndex <= previousIndex || tokenIndex >= expected.length ||
          tokens(w.w).join('') !== expected[tokenIndex] || typeof w.start !== 'number' || typeof w.end !== 'number' ||
          !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < end || w.end <= w.start || w.end > duration ||
          (missing > 0 && w.tokenIndex !== tokenIndex)) {
        throw new Error('invalid_alignment_word')
      }
      end = w.end
      previousIndex = tokenIndex
      return { w: w.w, start: w.start, end: w.end, timingOrigin: origin, tokenIndex }
    })
    if (missing > 0 && (words[0].tokenIndex !== 0 || words[words.length - 1].tokenIndex !== expected.length - 1)) {
      throw new Error('incomplete_turn_alignment')
    }
    if (missing === 0 && words.some((word, index) => word.tokenIndex !== index)) {
      throw new Error('invalid_alignment_word')
    }
    return { id: item.id, words }
  })
  // The first/last word of consecutive turns may never overlap in a segment.
  const ends = new Map<string, number>()
  const resultById = new Map(validated.map(t => [t.id, t]))
  for (const turn of turns) {
    const aligned = resultById.get(turn.id)
    if (!aligned || !turn.segmentId) continue
    if (aligned.words[0].start < (ends.get(turn.segmentId) ?? 0)) throw new Error('overlapping_alignment_turns')
    ends.set(turn.segmentId, aligned.words.at(-1)!.end)
  }
  return { version: value.version!, inputSignature, transcriptSignature: transcriptSignature(turns),
    timelineSignature: timelineSignature(segments), ...(clockSignature ? { clockSignature } : {}), turns: validated }
}

/** Overlay only evidence certified for these exact audio and transcript inputs. */
export function applyAlignedDelivery<T extends AlignmentTurn>(
  turns: T[], raw: unknown, inputSignature: string, segments: ResolvedAudioSegment[],
  clockSignature: string | null = null,
): T[] {
  const stored = raw as AlignmentResult | null
  if (!stored || stored.inputSignature !== inputSignature || stored.transcriptSignature !== transcriptSignature(turns) ||
      stored.timelineSignature !== timelineSignature(segments)) return turns
  if ((stored.version === LIVE_RECORDING_CLOCK_VERSION || stored.version === HYBRID_ALIGNMENT_VERSION)
      && stored.clockSignature !== clockSignature) return turns
  let validated: AlignmentResult
  try { validated = validateAlignmentResult(stored, turns, segments, inputSignature) } catch { return turns }
  const byId = new Map(validated.turns.map(t => [t.id, t.words]))
  return turns.map(turn => {
    const words = byId.get(turn.id)
    if (!words) return turn
    const audioStart = words[0].start
    const audioEnd = words.at(-1)!.end
    const seconds = audioEnd - audioStart // speech rate includes within-turn pauses
    return { ...turn, words, audioStart, audioEnd, metrics: {
      ...(turn.metrics && typeof turn.metrics === 'object' ? turn.metrics : {}),
      word_count: words.length, speaking_seconds: seconds,
      wpm: words.length * 60 / seconds, pace_source: 'word_timestamps',
      pace_alignment_version: stored.version,
    } }
  })
}

export function paceFromAlignment(turns: AlignmentTurn[], result: AlignmentResult) {
  const evidence = derivePaceEvidenceFromTurns(acceptedAlignmentTurns(turns, result)
    .map(t => ({ role: t.role, metrics: t.metrics })))
  const expectedWords = turns.filter(t => t.role === 'user').reduce((n, t) => n + tokens(t.text).length, 0)
  return assessPaceEvidence({ ...evidence, origin: 'post_session_alignment', source: 'word_timestamps',
    timestampedWordCount: evidence.totalWords, transcriptWordCount: evidence.totalWords,
  }, expectedWords)
}

export function fullyTimedTurnIds(turns: AlignmentTurn[], result: AlignmentResult | null): Set<string> {
  const ids = new Set<string>()
  if (!result) return ids
  const aligned = new Map(result.turns.map(turn => [turn.id, turn.words.length]))
  for (const turn of turns) {
    const expected = tokens(turn.text).length
    if (expected && aligned.get(turn.id) === expected) ids.add(turn.id)
  }
  return ids
}

/** Prefer a fully timed live turn. Otherwise keep whichever source timed more words. */
export function selectAlignmentTurns(
  turns: AlignmentTurn[],
  live: AlignmentResult | null,
  gentle: AlignmentResult | null,
): AlignmentResult['turns'] {
  const liveById = new Map(live?.turns.map(turn => [turn.id, turn]) ?? [])
  const gentleById = new Map(gentle?.turns.map(turn => [turn.id, turn]) ?? [])
  const selected: AlignmentResult['turns'] = []
  for (const turn of turns) {
    if (turn.role !== 'user' || !tokens(turn.text).length) continue
    const liveTurn = liveById.get(turn.id)
    const gentleTurn = gentleById.get(turn.id)
    const expected = tokens(turn.text).length
    if (liveTurn && liveTurn.words.length === expected) {
      selected.push(liveTurn)
      continue
    }
    const liveCount = liveTurn?.words.length ?? -1
    const gentleCount = gentleTurn?.words.length ?? -1
    if (gentleTurn && gentleCount > liveCount) selected.push(gentleTurn)
    else if (liveTurn) selected.push(liveTurn)
  }
  return selected
}

export function alignmentVersionFor(turns: AlignmentResult['turns']): string {
  const origins = new Set(turns.flatMap(turn => turn.words.map(word => word.timingOrigin)))
  if (origins.has('actual') && origins.has('forced_alignment')) return HYBRID_ALIGNMENT_VERSION
  if (origins.has('actual')) return LIVE_RECORDING_CLOCK_VERSION
  return ALIGNMENT_VERSION
}

/** A turn counts as complete only when every committed word has a timestamp. */
export function alignmentCoverage(turns: AlignmentTurn[], result: AlignmentResult) {
  const byId = new Map(result.turns.map(turn => [turn.id, turn]))
  const userTurns = turns.filter(turn => turn.role === 'user' && tokens(turn.text).length)
  let accepted = 0
  let complete = 0
  for (const turn of userTurns) {
    const aligned = byId.get(turn.id)
    if (!aligned) continue
    accepted += 1
    if (aligned.words.length === tokens(turn.text).length) complete += 1
  }
  return { accepted, complete, total: userTurns.length }
}

/** The exact same eligibility set powers rate and variability. */
export function acceptedAlignmentTurns<T extends AlignmentTurn>(turns: T[], result: AlignmentResult): T[] {
  const accepted = new Set(result.turns.map(t => t.id))
  return turns.filter(t => {
    const m = t.metrics as Record<string, unknown> | undefined
    const wpm = Number(m?.wpm)
    return t.role === 'user' && accepted.has(t.id) && m?.pace_source === 'word_timestamps' &&
      Number(m.word_count) >= 8 && Number(m.speaking_seconds) >= 4 && wpm >= 40 && wpm <= 300
  })
}

/** Shared by the asynchronous worker and later analytics runs, including commit-time rereads. */
export function resolveCanonicalDeliveryPace(input: {
  turns: AlignmentTurn[]
  result: unknown
  inputSignature: string | null
  segments: ResolvedAudioSegment[]
  transcript: unknown
  processingStatus: unknown
  expectedWords: number
}) {
  const raw = readPersistedPaceEvidence(input.processingStatus)
  // An alignment-derived aggregate is valid only when its underlying result
  // still matches the current recording AND complete committed transcript.
  const previous = raw && typeof raw === 'object' && (raw as { origin?: string }).origin === 'post_session_alignment'
    ? null : raw
  const live = selectBestPaceEvidence(previous, input.turns.map(t => ({ role: t.role, metrics: t.metrics })), input.expectedWords)
  let candidate = assessPaceEvidence(null, input.expectedWords)
  let accepted: AlignmentTurn[] = []
  if (input.inputSignature && committedTranscriptMatches(input.turns, input.transcript)) {
    const overlaid = applyAlignedDelivery(input.turns, input.result, input.inputSignature, input.segments,
      clockSignatureFromStatus(input.processingStatus))
    if (overlaid !== input.turns) {
      const result = input.result as AlignmentResult
      candidate = paceFromAlignment(overlaid, result)
      accepted = acceptedAlignmentTurns(overlaid, result)
    }
  }
  const pace = selectPreferredPaceAssessment(live, candidate)
  const sampleTurns = pace === candidate ? accepted : input.turns
  return { pace, variability: pace.status === 'available'
    ? measuredTurnVariability(sampleTurns.map(t => ({ role: t.role, metrics: t.metrics }))) : null }
}
