import { createHash } from 'crypto'
import { inflateSync } from 'zlib'
import { z } from 'zod'
import type { AlignmentTurn } from './alignedDelivery'
import type { ResolvedAudioSegment } from './insightProviders/resolveSessionAudio'

export const STREAM_CLOCK_VERSION = 'elevate-stream-clock-v1'
export const LIVE_RECORDING_CLOCK_VERSION = 'elevate-recording-clock-v1'
export const RECORDING_CLOCK_HOP_SEC = 0.02
export const RECORDING_CLOCK_RMS_SCALE = 128
const MIN_OVERLAP_HOPS = 50
const MIN_PEAK = 0.55
const MIN_MARGIN = 0.12
const MAX_HOPS = 45 * 60 * 50
const MAX_ENVELOPE_CHARS = 80_000

const streamClock = z.object({
  version: z.literal(STREAM_CLOCK_VERSION),
  epoch: z.number().int().nonnegative().max(1_000_000),
  sampleRate: z.number().int().min(8_000).max(96_000),
  hopSec: z.literal(RECORDING_CLOCK_HOP_SEC),
  encoding: z.enum(['uint8', 'zlib']),
  envelope: z.string().min(1).max(MAX_ENVELOPE_CHARS),
  hops: z.number().int().min(MIN_OVERLAP_HOPS).max(MAX_HOPS),
}).strict()

export interface DecodedStreamClock {
  epoch: number
  sampleRate: number
  hopSec: number
  envelope: Uint8Array
  signaturePart: string
}

function tokens(text: string): string[] {
  return text.split(/\s+/).map(word => word.toLowerCase().replace(/[^\p{L}\p{N}_']/gu, '')).filter(Boolean)
}

export function envelopeFromPcm16(samples: Int16Array, sampleRate: number): Uint8Array {
  const hop = Math.max(1, Math.round(sampleRate * RECORDING_CLOCK_HOP_SEC))
  const hops = Math.floor(samples.length / hop)
  const out = new Uint8Array(hops)
  for (let index = 0; index < hops; index += 1) {
    let total = 0
    const start = index * hop
    for (let sample = start; sample < start + hop; sample += 1) {
      const value = samples[sample]
      total += value * value
    }
    out[index] = Math.min(255, Math.floor(Math.sqrt(total / hop) / RECORDING_CLOCK_RMS_SCALE))
  }
  return out
}

export function decodeStreamEnvelope(encoding: 'uint8' | 'zlib', envelope: string, hops: number): Uint8Array | null {
  let bytes: Buffer
  try {
    const raw = Buffer.from(envelope, 'base64')
    bytes = encoding === 'zlib' ? inflateSync(raw) : raw
  } catch {
    return null
  }
  if (bytes.length !== hops || hops > MAX_HOPS) return null
  return new Uint8Array(bytes)
}

/** Drop an invalid snapshot. An empty list means Gentle remains the timing path. */
export function readStreamClocks(value: unknown): DecodedStreamClock[] {
  if (!Array.isArray(value)) return []
  const clocks: DecodedStreamClock[] = []
  const seen = new Set<number>()
  for (const item of value) {
    const parsed = streamClock.safeParse(item)
    if (!parsed.success || seen.has(parsed.data.epoch)) return []
    const envelope = decodeStreamEnvelope(parsed.data.encoding, parsed.data.envelope, parsed.data.hops)
    if (!envelope) return []
    seen.add(parsed.data.epoch)
    clocks.push({
      epoch: parsed.data.epoch,
      sampleRate: parsed.data.sampleRate,
      hopSec: parsed.data.hopSec,
      envelope,
      signaturePart: JSON.stringify([
        parsed.data.epoch, parsed.data.hopSec, parsed.data.sampleRate, parsed.data.envelope,
      ]),
    })
  }
  return clocks
}

export function streamClockSignature(clocks: DecodedStreamClock[]): string | null {
  if (!clocks.length) return null
  return createHash('sha256').update(clocks.map(clock => clock.signaturePart).join('|')).digest('hex')
}

export function clockSignatureFromStatus(processingStatus: unknown): string | null {
  const status = processingStatus && typeof processingStatus === 'object' && !Array.isArray(processingStatus)
    ? processingStatus as Record<string, unknown> : {}
  return streamClockSignature(readStreamClocks(status.liveStreamClocks))
}

function pearson(stream: Float64Array, segment: Float64Array, lag: number): number {
  let count = 0
  let dot = 0
  let streamSum = 0
  let segmentSum = 0
  let streamSquare = 0
  let segmentSquare = 0
  for (let index = 0; index < segment.length; index += 1) {
    const streamIndex = lag + index
    if (streamIndex < 0 || streamIndex >= stream.length) continue
    const left = stream[streamIndex]
    const right = segment[index]
    count += 1
    dot += left * right
    streamSum += left
    segmentSum += right
    streamSquare += left * left
    segmentSquare += right * right
  }
  if (count < MIN_OVERLAP_HOPS) return -2
  const numerator = count * dot - streamSum * segmentSum
  const denominator = Math.sqrt(
    (count * streamSquare - streamSum * streamSum) * (count * segmentSquare - segmentSum * segmentSum),
  )
  if (!Number.isFinite(denominator) || denominator <= 1e-6) return -2
  return numerator / denominator
}

function downsample(data: Uint8Array, factor: number): Float64Array {
  const length = Math.floor(data.length / factor)
  const out = new Float64Array(length)
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    const start = index * factor
    for (let hop = 0; hop < factor; hop += 1) sum += data[start + hop]
    out[index] = sum / factor
  }
  return out
}

function asFloat(data: Uint8Array): Float64Array {
  const out = new Float64Array(data.length)
  for (let index = 0; index < data.length; index += 1) out[index] = data[index]
  return out
}

/**
 * Lag is the stream hop where the segment's first hop aligns.
 * Negative means the recording started before this STT stream.
 */
export function correlateStreamLag(
  stream: Uint8Array, segment: Uint8Array,
): { lagHops: number, peak: number, margin: number } | null {
  if (stream.length < MIN_OVERLAP_HOPS || segment.length < MIN_OVERLAP_HOPS) return null
  const factor = stream.length > 2_000 || segment.length > 2_000 ? 10 : 1
  const coarseStream = factor === 1 ? asFloat(stream) : downsample(stream, factor)
  const coarseSegment = factor === 1 ? asFloat(segment) : downsample(segment, factor)
  if (coarseStream.length < 5 || coarseSegment.length < 5) return null
  const first = -(coarseSegment.length - 5)
  const last = coarseStream.length - 5
  let bestLag = 0
  let best = -2
  for (let lag = first; lag <= last; lag += 1) {
    const score = pearson(coarseStream, coarseSegment, lag)
    if (score > best) {
      best = score
      bestLag = lag
    }
  }
  const origin = bestLag * factor
  const fineStream = asFloat(stream)
  const fineSegment = asFloat(segment)
  const fineFirst = Math.max(-(segment.length - MIN_OVERLAP_HOPS), origin - factor * 2)
  const fineLast = Math.min(stream.length - MIN_OVERLAP_HOPS, origin + factor * 2)
  let lagHops = origin
  let peak = -2
  for (let lag = fineFirst; lag <= fineLast; lag += 1) {
    const score = pearson(fineStream, fineSegment, lag)
    if (score > peak) {
      peak = score
      lagHops = lag
    }
  }
  let rival = -2
  const rivalStep = factor === 1 ? 1 : factor
  for (let lag = -(segment.length - MIN_OVERLAP_HOPS); lag <= stream.length - MIN_OVERLAP_HOPS; lag += rivalStep) {
    if (Math.abs(lag - lagHops) <= 10) continue
    rival = Math.max(rival, pearson(fineStream, fineSegment, lag))
  }
  if (peak < MIN_PEAK || peak - rival < MIN_MARGIN) return null
  return { lagHops, peak, margin: peak - rival }
}

function evidenceOf(metrics: unknown): Record<string, unknown> | null {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return null
  const evidence = (metrics as Record<string, unknown>).live_word_evidence
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null
  return evidence as Record<string, unknown>
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const MAX_UNMATCHED_WORDS = 2
const MIN_WORD_COVERAGE = 0.9
const MAX_COMPOUND_PIECES = 3

interface SpokenToken { surface: string, norm: string }
interface MappedLiveWord {
  w: string
  start: number
  end: number
  timingOrigin: 'actual'
  tokenIndex: number
}

function spokenTokens(text: string): SpokenToken[] {
  return text.split(/\s+/).filter(Boolean).map(surface => ({
    surface, norm: tokens(surface).join(''),
  })).filter(token => token.norm)
}

function evidenceWord(value: unknown): { norm: string, start: number, end: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const label = typeof raw.w === 'string' ? raw.w : ''
  const start = finite(raw.start)
  const end = finite(raw.end)
  const norm = tokens(label).join('')
  if (!norm || start == null || end == null || end <= start) return null
  return { norm, start, end }
}

/**
 * Match provider words onto the committed transcript.
 * Hyphenated compounds may be one timed item or several adjacent items.
 * Up to two unmatched transcript words can remain, and they get no timestamp.
 */
function mapTurnEvidence(
  expected: SpokenToken[],
  rawWords: unknown[],
  offset: number,
  lagSec: number,
  duration: number,
  previousEnd: number,
): { words: MappedLiveWord[] } | { words: null, reason: string } {
  let index = 0
  let cursor = 0
  let missing = 0
  let previous = previousEnd
  const words: MappedLiveWord[] = []
  while (cursor < rawWords.length) {
    let placed = false
    const remainingSkips = MAX_UNMATCHED_WORDS - missing
    for (let width = 1; width <= MAX_COMPOUND_PIECES && cursor + width <= rawWords.length; width += 1) {
      const slice = rawWords.slice(cursor, cursor + width).map(evidenceWord)
      if (slice.some(word => word == null)) return { words: null, reason: 'invalid_live_word' }
      const pieces = slice as Array<{ norm: string, start: number, end: number }>
      for (let piece = 1; piece < pieces.length; piece += 1) {
        if (pieces[piece].start < pieces[piece - 1].end) return { words: null, reason: 'unordered_or_overlap' }
      }
      const joined = pieces.map(word => word.norm).join('')
      for (let skip = 0; skip <= remainingSkips && index + skip < expected.length; skip += 1) {
        if (joined !== expected[index + skip].norm) continue
        let recordingStart = pieces[0].start - offset - lagSec
        let recordingEnd = pieces[pieces.length - 1].end - offset - lagSec
        if (recordingStart < -RECORDING_CLOCK_HOP_SEC || recordingEnd > duration + RECORDING_CLOCK_HOP_SEC) {
          return { words: null, reason: 'out_of_bounds' }
        }
        recordingStart = Math.max(0, Math.round(recordingStart * 1_000_000) / 1_000_000)
        recordingEnd = Math.min(duration, Math.round(recordingEnd * 1_000_000) / 1_000_000)
        if (recordingEnd <= recordingStart || recordingStart < previous) {
          return { words: null, reason: 'unordered_or_overlap' }
        }
        missing += skip
        const tokenIndex = index + skip
        words.push({
          w: expected[tokenIndex].surface,
          start: recordingStart,
          end: recordingEnd,
          timingOrigin: 'actual',
          tokenIndex,
        })
        previous = recordingEnd
        index = tokenIndex + 1
        cursor += width
        placed = true
        break
      }
      if (placed) break
    }
    if (!placed) return { words: null, reason: 'lexical_or_timing_mismatch' }
  }
  missing += expected.length - index
  if (!words.length) return { words: null, reason: 'incomplete_words' }
  if (missing > MAX_UNMATCHED_WORDS || (missing > 0 && words.length / expected.length < MIN_WORD_COVERAGE)) {
    return { words: null, reason: 'incomplete_words' }
  }
  if (missing > 0 && (words[0].tokenIndex !== 0 || words[words.length - 1].tokenIndex !== expected.length - 1)) {
    return { words: null, reason: 'incomplete_words' }
  }
  return { words }
}

/**
 * Map each turn independently once its recording segment correlates.
 * A turn that fails lexical or coverage checks is left for Gentle.
 * The correlation gate itself stays strict.
 */
export function mapLiveRecordingEvidence(input: {
  turns: AlignmentTurn[]
  segments: ResolvedAudioSegment[]
  clocks: DecodedStreamClock[]
  envelopes: Map<string, Uint8Array>
  inputSignature: string
}): { result: Record<string, unknown>, unmappedTurnIds: string[] } | { result: null, reason: string, unmappedTurnIds: string[] } {
  const userTurns = input.turns.filter(turn => turn.role === 'user' && spokenTokens(turn.text).length)
  if (!userTurns.length) return { result: null, reason: 'no_user_turns', unmappedTurnIds: [] }
  const byEpoch = new Map(input.clocks.map(clock => [clock.epoch, clock]))
  const lagBySegmentEpoch = new Map<string, number>()
  const failedPairs = new Map<string, string>()
  const pairs = new Map<string, { segmentId: string, epoch: number }>()
  for (const turn of userTurns) {
    const epoch = evidenceOf(turn.metrics)?.epoch
    if (!turn.segmentId || typeof epoch !== 'number' || !Number.isInteger(epoch)) continue
    pairs.set(`${turn.segmentId}:${epoch}`, { segmentId: turn.segmentId, epoch })
  }
  for (const pair of pairs.values()) {
    const key = `${pair.segmentId}:${pair.epoch}`
    const envelope = input.envelopes.get(pair.segmentId)
    const clock = byEpoch.get(pair.epoch)
    if (!envelope || !clock) {
      failedPairs.set(key, envelope ? 'missing_stream_clock' : 'recording_envelope_unavailable')
      continue
    }
    const correlated = correlateStreamLag(clock.envelope, envelope)
    if (!correlated) {
      failedPairs.set(key, 'correlation_rejected')
      continue
    }
    lagBySegmentEpoch.set(key, correlated.lagHops * RECORDING_CLOCK_HOP_SEC)
  }

  const durations = new Map(input.segments.map(segment => [segment.segmentId, segment.durationSec]))
  const mapped: Array<{ id: string, words: MappedLiveWord[] }> = []
  const ends = new Map<string, number>()
  const unmappedTurnIds: string[] = []
  let failure = 'incomplete_coverage'
  for (const turn of input.turns) {
    if (turn.role !== 'user') continue
    const expected = spokenTokens(turn.text)
    if (!expected.length) continue
    const segmentId = turn.segmentId
    const duration = segmentId ? durations.get(segmentId) : undefined
    const evidence = evidenceOf(turn.metrics)
    const epoch = evidence?.epoch
    const key = segmentId && typeof epoch === 'number' ? `${segmentId}:${epoch}` : ''
    const lagSec = key ? lagBySegmentEpoch.get(key) : undefined
    if (!duration || lagSec == null || !evidence || evidence.state !== 'source_only' || !Array.isArray(evidence.words)) {
      unmappedTurnIds.push(turn.id)
      failure = failedPairs.get(key) ?? (evidence ? 'unmapped_turn' : 'unmapped_turn')
      continue
    }
    const offset = finite(evidence.streamOffsetSec)
    if (offset == null || offset < 0) {
      unmappedTurnIds.push(turn.id)
      failure = 'unanchored_stream_offset'
      continue
    }
    const placed = mapTurnEvidence(expected, evidence.words, offset, lagSec, duration, ends.get(segmentId!) ?? 0)
    if (!placed.words) {
      unmappedTurnIds.push(turn.id)
      failure = placed.reason
      continue
    }
    ends.set(segmentId!, placed.words[placed.words.length - 1].end)
    mapped.push({ id: turn.id, words: placed.words })
  }
  if (!mapped.length) return { result: null, reason: failure, unmappedTurnIds }
  const signature = streamClockSignature(input.clocks)
  if (!signature) return { result: null, reason: 'missing_stream_clock', unmappedTurnIds: userTurns.map(turn => turn.id) }
  return {
    unmappedTurnIds,
    result: {
      version: LIVE_RECORDING_CLOCK_VERSION,
      inputSignature: input.inputSignature,
      clockSignature: signature,
      turns: mapped,
    },
  }
}
