import { z } from 'zod'

const sourceWord = z.object({
  w: z.string().min(1).max(512),
  start: z.number().finite().nonnegative(),
  end: z.number().finite().nonnegative(),
  recognitionConfidence: z.number().finite().min(0).max(1).optional(),
}).refine(word => word.end > word.start)

const sourceEvidence = z.object({
  version: z.literal('elevate-live-words-v1'),
  provider: z.string().min(1).max(256),
  state: z.enum(['source_only', 'unavailable']),
  reason: z.string().min(1).max(120),
  clock: z.literal('stt_stream'),
  words: z.array(sourceWord).max(10_000),
  streamId: z.string().max(256).optional(),
  resultIds: z.array(z.string().max(256)).max(10_000).optional(),
  mapping: z.null(),
})

export type LiveWordEvidence = z.infer<typeof sourceEvidence>

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

/** The live stream and browser MediaRecorder do not share a proven sample clock. */
export function readLiveWordEvidence(value: unknown): LiveWordEvidence | null {
  if (value == null) return null
  const parsed = sourceEvidence.safeParse(value)
  if (!parsed.success) return null
  let end = 0
  for (const word of parsed.data.words) {
    if (word.start < end) return null
    end = word.end
  }
  return parsed.data
}

export function incomingTimingMetrics(metrics: unknown, context: string): Record<string, unknown> {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    console.warn(`[live-delivery] ${context}: invalid turn metrics; recording alignment required`)
    return {}
  }
  const result = { ...object(metrics) }
  if (result.live_word_evidence != null) {
    const evidence = readLiveWordEvidence(result.live_word_evidence)
    if (evidence) {
      result.live_word_evidence = evidence
    } else {
      console.warn(`[live-delivery] ${context}: invalid source evidence; recording alignment required`)
      result.live_word_evidence = {
        version: 'elevate-live-words-v1', provider: 'unknown', state: 'unavailable',
        reason: 'invalid_source_evidence', clock: 'stt_stream', words: [], mapping: null,
      } satisfies LiveWordEvidence
    }
  }
  if (result.timing_validation != null) {
    result.timing_validation = {
      ...object(result.timing_validation), eligibleForDeliveryEvidence: false,
    }
  }
  return result
}

/**
 * Persisted agent word offsets have at most approximate playback meaning.
 * Only the server's signature-bound alignment overlay may certify them.
 */
export function approximatePlaybackWords(words: unknown): unknown {
  if (!Array.isArray(words)) return words
  return words.map(word => ({
    ...object(word),
    timingOrigin: 'synthetic',
  }))
}

export function withApproximatePlaybackTiming<T extends { words?: unknown }>(turns: T[]): T[] {
  return turns.map(turn => ({ ...turn, words: approximatePlaybackWords(turn.words) }))
}

/** Raw source words are internal evidence, not an alternate transcript export. */
export function publicTurnMetrics(metrics: unknown): unknown {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return metrics
  const { live_word_evidence: _source, ...publicMetrics } = object(metrics)
  return publicMetrics
}

export function liveEvidenceSummary(turns: Array<{ metrics?: unknown }>) {
  let sourceOnlyTurns = 0
  let unavailableTurns = 0
  for (const turn of turns) {
    const evidence = readLiveWordEvidence(object(turn.metrics).live_word_evidence)
    if (evidence?.state === 'source_only') sourceOnlyTurns += 1
    else unavailableTurns += 1
  }
  return { sourceOnlyTurns, unavailableTurns, recordingClockMapped: false as const }
}

export function publicAlignmentReason(reason: string | null): string | null {
  if (reason == null) return null
  return [
    'waiting_for_complete_transcript', 'waiting_for_recording_or_transcript',
    'complete_user_audio_required', 'alignment_coverage_insufficient',
    'alignment_timeout', 'alignment_service_failed', 'alignment_process_unavailable',
  ].includes(reason) ? reason : 'alignment_failed'
}
