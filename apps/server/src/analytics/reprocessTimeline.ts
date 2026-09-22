import type { ResolvedAudioSegment } from './insightProviders/resolveSessionAudio'

interface ReprocessTurn {
  id: string
  segmentId: string | null
  text?: string
  words: unknown
}

export interface ReprocessTimelineWord extends Record<string, unknown> {
  start: number
  end: number
  utterance_id: string
  timingOrigin: string
}

/**
 * Shift segment-local turn words onto the same concatenated timeline used by
 * Replay and the deterministic merged recording.
 */
export function buildReprocessTimelineWords(
  segments: ResolvedAudioSegment[],
  turns: ReprocessTurn[],
): ReprocessTimelineWord[] {
  const orderedSegments = [...segments].sort((a, b) => a.segmentIndex - b.segmentIndex)
  const offsets = new Map(
    orderedSegments.map((segment) => [segment.segmentId, segment.replayOffsetSec]),
  )

  return turns.flatMap((turn) => {
    if (!turn.segmentId || !offsets.has(turn.segmentId) || !Array.isArray(turn.words)) {
      return []
    }
    const offset = offsets.get(turn.segmentId) ?? 0
    return turn.words.flatMap((word) => {
      if (!word || typeof word !== 'object' || Array.isArray(word)) return []
      const value = word as Record<string, unknown>
      const start = Number(value.start)
      const end = Number(value.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) return []
      const timingOrigin =
        typeof value.timingOrigin === 'string'
          ? value.timingOrigin
          : typeof value.timing_origin === 'string'
            ? value.timing_origin
            : 'unknown'
      return [{
        ...value,
        start: start + offset,
        end: end + offset,
        utterance_id: turn.id,
        timingOrigin,
      }]
    })
  })
}

export function buildReprocessTimelineTranscript(
  segments: ResolvedAudioSegment[],
  turns: ReprocessTurn[],
): string {
  const included = new Set(segments.map((segment) => segment.segmentId))
  return turns
    .filter((turn) => turn.segmentId && included.has(turn.segmentId))
    .map((turn) => (turn.text ?? '').trim())
    .filter(Boolean)
    .join(' ')
}

export function buildReprocessTranscripts(
  fullContentTranscript: string,
  segments: ResolvedAudioSegment[],
  turns: ReprocessTurn[],
): { contentTranscript: string; deliveryTranscript: string | null } {
  const resolvedTranscript = buildReprocessTimelineTranscript(segments, turns)
  const deliveryTranscript =
    resolvedTranscript || (segments.length === 0 ? fullContentTranscript : null)
  return {
    contentTranscript: fullContentTranscript,
    deliveryTranscript,
  }
}
