export type PaceSource = 'word_timestamps' | 'validated_turn_audio'
export type PaceStatus = 'available' | 'insufficient_evidence'
export type PaceConfidence = 'high' | 'medium' | 'low'

export interface PaceEvidence {
  source: PaceSource | null
  status: PaceStatus
  confidence: PaceConfidence
  totalWords: number
  speakingSeconds: number
  samples: number
  estimatedSamples: number
  coverage: number
  observedWords: number
  observedSpeakingSeconds: number
  observedSamples: number
  observedEstimatedSamples: number
  excludedMicroTurnCount: number
  excludedUnreliableTurnCount: number
  timestampedWordCount: number
  transcriptWordCount: number
  invalidTimestampCount: number
  outOfOrderTimestampCount: number
  timestampCoverage: number
}

export interface PaceAssessment extends PaceEvidence {
  wpm: number | null
}

const MIN_WORDS = 20
const MIN_SAMPLES = 2
const MIN_COVERAGE = 0.85
const MIN_PLAUSIBLE_WPM = 40
const MAX_PLAUSIBLE_WPM = 300

function finiteNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function unavailable(overrides: Partial<PaceEvidence> = {}): PaceAssessment {
  return {
    source: null,
    status: 'insufficient_evidence',
    confidence: 'low',
    totalWords: 0,
    speakingSeconds: 0,
    samples: 0,
    estimatedSamples: 0,
    coverage: 0,
    observedWords: 0,
    observedSpeakingSeconds: 0,
    observedSamples: 0,
    observedEstimatedSamples: 0,
    excludedMicroTurnCount: 0,
    excludedUnreliableTurnCount: 0,
    timestampedWordCount: 0,
    transcriptWordCount: 0,
    invalidTimestampCount: 0,
    outOfOrderTimestampCount: 0,
    timestampCoverage: 0,
    ...overrides,
    wpm: null,
  }
}

/**
 * Validate agent timing evidence before it can affect the headline WPM or the
 * Pacing skill. Text-only estimates and merged silence spans are deliberately
 * not accepted here.
 */
export function assessPaceEvidence(
  raw: unknown,
  expectedWords: number,
): PaceAssessment {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return unavailable()
  const value = raw as Record<string, unknown>
  const source: PaceSource | null =
    value.source === 'word_timestamps' || value.source === 'validated_turn_audio'
      ? value.source
      : null
  const totalWords = Math.max(0, finiteNumber(value.totalWords))
  const speakingSeconds = Math.max(0, finiteNumber(value.speakingSeconds))
  const samples = Math.max(0, Math.floor(finiteNumber(value.samples)))
  const estimatedSamples = Math.max(0, Math.floor(finiteNumber(value.estimatedSamples)))
  const observedWords = Math.max(0, finiteNumber(value.observedWords))
  const observedSpeakingSeconds = Math.max(0, finiteNumber(value.observedSpeakingSeconds))
  const observedSamples = Math.max(0, Math.floor(finiteNumber(value.observedSamples)))
  const observedEstimatedSamples = Math.max(
    0,
    Math.floor(finiteNumber(value.observedEstimatedSamples)),
  )
  const excludedMicroTurnCount = Math.max(
    0,
    Math.floor(finiteNumber(value.excludedMicroTurnCount)),
  )
  const excludedUnreliableTurnCount = Math.max(
    0,
    Math.floor(finiteNumber(value.excludedUnreliableTurnCount)),
  )
  const timestampedWordCount = Math.max(0, finiteNumber(value.timestampedWordCount))
  const transcriptWordCount = Math.max(0, finiteNumber(value.transcriptWordCount))
  const invalidTimestampCount = Math.max(
    0,
    Math.floor(finiteNumber(value.invalidTimestampCount)),
  )
  const outOfOrderTimestampCount = Math.max(
    0,
    Math.floor(finiteNumber(value.outOfOrderTimestampCount)),
  )
  const timestampCoverage =
    transcriptWordCount > 0
      ? Math.min(1, timestampedWordCount / transcriptWordCount)
      : 0
  const coverage =
    expectedWords > 0 && totalWords > 0
      ? Math.min(totalWords, expectedWords) / Math.max(totalWords, expectedWords)
      : 0
  const wpm = speakingSeconds > 0 ? (totalWords / speakingSeconds) * 60 : 0

  const valid =
    source != null &&
    value.status === 'available' &&
    totalWords >= MIN_WORDS &&
    samples >= MIN_SAMPLES &&
    speakingSeconds > 0 &&
    estimatedSamples === 0 &&
    coverage >= MIN_COVERAGE &&
    wpm >= MIN_PLAUSIBLE_WPM &&
    wpm <= MAX_PLAUSIBLE_WPM &&
    (source !== 'word_timestamps' ||
      (timestampCoverage >= 0.95 &&
        invalidTimestampCount === 0 &&
        outOfOrderTimestampCount === 0))

  const evidence = {
    source,
    totalWords,
    speakingSeconds,
    samples,
    estimatedSamples,
    coverage,
    observedWords,
    observedSpeakingSeconds,
    observedSamples,
    observedEstimatedSamples,
    excludedMicroTurnCount,
    excludedUnreliableTurnCount,
    timestampedWordCount,
    transcriptWordCount,
    invalidTimestampCount,
    outOfOrderTimestampCount,
    timestampCoverage,
  }

  if (!valid) {
    return unavailable(evidence)
  }

  return {
    ...evidence,
    status: 'available',
    confidence: source === 'word_timestamps' ? 'high' : 'medium',
    wpm,
  }
}

export function readPersistedPaceEvidence(processingStatus: unknown): unknown {
  if (!processingStatus || typeof processingStatus !== 'object' || Array.isArray(processingStatus)) {
    return null
  }
  return (processingStatus as Record<string, unknown>).pace ?? null
}

/** Weighted coefficient of variation from substantive, measured user turns. */
export function measuredTurnVariability(
  turns: Array<{ role: string; metrics: unknown }>,
  minWords = 8,
): number | null {
  const samples = turns.flatMap((turn) => {
    if (turn.role !== 'user' || !turn.metrics || typeof turn.metrics !== 'object') return []
    const metrics = turn.metrics as Record<string, unknown>
    const words = Number(metrics.word_count)
    const wpm = Number(metrics.wpm)
    const speakingSeconds = Number(metrics.speaking_seconds)
    const source = metrics.pace_source
    if (
      !Number.isFinite(words) ||
      words < minWords ||
      !Number.isFinite(wpm) ||
      wpm <= 0 ||
      !Number.isFinite(speakingSeconds) ||
      speakingSeconds <= 0 ||
      (source !== 'word_timestamps' && source !== 'validated_turn_audio')
    ) {
      return []
    }
    return [{ words, wpm }]
  })
  if (samples.length < 2) return null
  const totalWeight = samples.reduce((sum, sample) => sum + sample.words, 0)
  if (totalWeight <= 0) return null
  const mean =
    samples.reduce((sum, sample) => sum + sample.wpm * sample.words, 0) / totalWeight
  if (mean <= 0) return null
  const variance =
    samples.reduce(
      (sum, sample) => sum + sample.words * (sample.wpm - mean) ** 2,
      0,
    ) / totalWeight
  return Math.sqrt(variance) / mean
}
