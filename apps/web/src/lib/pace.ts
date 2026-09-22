export interface PaceContract {
  origin?: 'live_logical_turns' | 'reconciled_committed_turns' | null
  source?: 'word_timestamps' | 'validated_turn_audio' | null
  status?: 'available' | 'insufficient_evidence'
  confidence?: 'high' | 'medium' | 'low'
  totalWords?: number
  speakingSeconds?: number
  samples?: number
  estimatedSamples?: number
  coverage?: number
  observedWords?: number
  observedSpeakingSeconds?: number
  observedSamples?: number
  observedEstimatedSamples?: number
  excludedMicroTurnCount?: number
  excludedShortDurationCount?: number
  excludedUnreliableTurnCount?: number
  timestampedWordCount?: number
  transcriptWordCount?: number
  invalidTimestampCount?: number
  outOfOrderTimestampCount?: number
  timestampCoverage?: number
}

export interface PaceProcessingStatus {
  pace?: PaceContract | null
}

export function hasAvailablePace(
  processingStatus: PaceProcessingStatus | null | undefined,
): boolean {
  const pace = processingStatus?.pace
  return (
    pace?.status === 'available' &&
    (pace.source === 'word_timestamps' || pace.source === 'validated_turn_audio') &&
    pace.confidence !== 'low'
  )
}

export function isSubstantivePaceTurn(metrics: Record<string, unknown> | null | undefined): boolean {
  if (!metrics) return false
  const words = Number(metrics.word_count)
  const wpm = Number(metrics.wpm)
  const speakingSeconds = Number(metrics.speaking_seconds)
  const source = metrics.pace_source
  return (
    Number.isFinite(words) &&
    words >= 8 &&
    Number.isFinite(wpm) &&
    wpm > 0 &&
    Number.isFinite(speakingSeconds) &&
    speakingSeconds >= 4 &&
    (source === 'word_timestamps' || source === 'validated_turn_audio')
  )
}

/** User-facing fastest/slowest moments need more evidence than a chart point. */
export function isQualifiedPaceHighlight(
  metrics: Record<string, unknown> | null | undefined,
): boolean {
  if (!isSubstantivePaceTurn(metrics)) return false
  const words = Number(metrics?.word_count)
  const speakingSeconds = Number(metrics?.speaking_seconds)
  return words >= 15 && speakingSeconds >= 4
}
