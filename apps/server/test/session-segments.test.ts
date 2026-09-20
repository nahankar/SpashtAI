import { describe, expect, it } from 'vitest'
import {
  activeSegmentDurationSec,
  compareSegmentTurns,
  mergeSegmentAudioStatus,
  recordingPayloadMatches,
  segmentRecordingFilename,
} from '../src/analytics/sessionSegments'

describe('Elevate session segments', () => {
  it('keeps pending only while work may still arrive', () => {
    expect(mergeSegmentAudioStatus('pending', 'pending')).toBe('pending')
    expect(mergeSegmentAudioStatus('pending', 'failed')).toBe('failed')
    expect(mergeSegmentAudioStatus('pending', 'unavailable')).toBe('unavailable')
    expect(mergeSegmentAudioStatus('failed', 'pending')).toBe('failed')
    expect(mergeSegmentAudioStatus('unavailable', 'pending')).toBe('unavailable')
    expect(mergeSegmentAudioStatus('failed', 'available')).toBe('available')
    expect(mergeSegmentAudioStatus('available', 'failed')).toBe('available')
  })

  it('accepts an idempotent retry only when hash, bytes, and MIME all match', () => {
    const canonical = {
      contentHash: 'sha256-a',
      fileSize: 1234,
      mimeType: 'audio/webm',
    }
    expect(recordingPayloadMatches(canonical, canonical)).toBe(true)
    expect(
      recordingPayloadMatches(canonical, { ...canonical, contentHash: 'sha256-b' }),
    ).toBe(false)
    expect(recordingPayloadMatches(canonical, { ...canonical, fileSize: 1235 })).toBe(false)
    expect(
      recordingPayloadMatches(canonical, { ...canonical, mimeType: 'audio/ogg' }),
    ).toBe(false)
  })

  it('uses one deterministic canonical path for each segment', () => {
    const first = segmentRecordingFilename('segment-123')
    expect(first).toMatch(/^elevate-segment-[a-f0-9]{64}\.audio$/)
    expect(segmentRecordingFilename('segment-123')).toBe(first)
    expect(segmentRecordingFilename('../segment/123')).not.toBe(first)
  })

  it('counts active segment time without including the gap between segments', () => {
    const first = activeSegmentDurationSec(
      new Date('2026-09-20T10:00:00Z'),
      new Date('2026-09-20T10:02:00Z'),
    )
    const second = activeSegmentDurationSec(
      new Date('2026-09-20T10:12:00Z'),
      new Date('2026-09-20T10:15:00Z'),
    )
    expect(first + second).toBe(300)
  })

  it('orders turns by segment before agent-local turn index', () => {
    const arrivedOutOfOrder = [
      { id: 'second-1', segmentIndex: 1, localTurnIndex: 1 },
      { id: 'first-1', segmentIndex: 0, localTurnIndex: 1 },
      { id: 'second-0', segmentIndex: 1, localTurnIndex: 0 },
      { id: 'first-0', segmentIndex: 0, localTurnIndex: 0 },
    ]
    arrivedOutOfOrder.sort(compareSegmentTurns)
    expect(arrivedOutOfOrder.map((turn) => turn.id)).toEqual([
      'first-0',
      'first-1',
      'second-0',
      'second-1',
    ])
  })
})
