import { createHash } from 'crypto'

export type SegmentAudioStatus = 'pending' | 'available' | 'failed' | 'unavailable'

export function mergeSegmentAudioStatus(
  current: string,
  incoming?: SegmentAudioStatus | null,
): SegmentAudioStatus {
  if (current === 'available') return 'available'
  if (
    (current === 'failed' || current === 'unavailable') &&
    incoming === 'pending'
  ) {
    return current
  }
  return incoming ?? (current as SegmentAudioStatus)
}

export function activeSegmentDurationSec(
  startedAt: Date,
  endedAt: Date,
): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
}

/** Client clocks may be a little fast; authorization and staleness always use server time. */
export const EVENT_CLOCK_SKEW_MS = 2 * 60 * 1000

export function acceptedEventTime(raw: unknown, now: Date): Date | null {
  if (raw == null || raw === '') return now
  const value = new Date(typeof raw === 'string' || typeof raw === 'number' ? raw : String(raw))
  if (Number.isNaN(value.getTime())) return null
  if (value.getTime() - now.getTime() > EVENT_CLOCK_SKEW_MS) return null
  return value
}

export function recordingPayloadMatches(
  canonical: {
    contentHash: string | null
    fileSize: number
    mimeType: string | null
  },
  incoming: { contentHash: string; fileSize: number; mimeType: string },
): boolean {
  return (
    canonical.contentHash === incoming.contentHash &&
    canonical.fileSize === incoming.fileSize &&
    canonical.mimeType === incoming.mimeType
  )
}

export function segmentRecordingFilename(segmentId: string): string {
  const key = createHash('sha256').update(segmentId).digest('hex')
  return `elevate-segment-${key}.audio`
}

export function compareSegmentTurns(
  a: { segmentIndex: number | null; localTurnIndex: number },
  b: { segmentIndex: number | null; localTurnIndex: number },
): number {
  return (
    (a.segmentIndex ?? -1) - (b.segmentIndex ?? -1) ||
    a.localTurnIndex - b.localTurnIndex
  )
}
