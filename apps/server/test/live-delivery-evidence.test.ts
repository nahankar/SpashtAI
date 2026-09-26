import { describe, expect, it, vi } from 'vitest'
import {
  incomingTimingMetrics, liveEvidenceSummary, publicAlignmentReason, publicTurnMetrics,
  readLiveWordEvidence, withApproximatePlaybackTiming,
} from '../src/analytics/liveDeliveryEvidence'
import { applyAlignedDelivery, validateAlignmentResult } from '../src/analytics/alignedDelivery'
import { findDeliveryPauseMoments } from '../src/analytics/deliveryMoments'
import { buildReprocessTimelineWords } from '../src/analytics/reprocessTimeline'

const source = {
  version: 'elevate-live-words-v1', provider: 'aws-transcribe',
  state: 'source_only', reason: 'recording_clock_unmapped', clock: 'stt_stream',
  words: [{ w: 'one', start: 1, end: 1.4, recognitionConfidence: 0.99 }],
  streamId: 'stream-1', resultIds: ['result-1'], mapping: null,
}
const text = 'First we make one clear point. Then explain the whole plan.'
const segments = [
  { segmentId: 'a', segmentIndex: 0, replayOffsetSec: 0, durationSec: 30 },
  { segmentId: 'b', segmentIndex: 1, replayOffsetSec: 30, durationSec: 25 },
]
const turns = segments.map((segment, n) => ({
  id: `turn-${n}`, role: 'user', segmentId: segment.segmentId, turnIndex: n, text,
  audioStart: 0, audioEnd: 8,
  words: text.split(' ').map((w, i) => ({
    w, start: i * 0.5 + (i > 5 ? 0.7 : 0),
    end: i * 0.5 + 0.4 + (i > 5 ? 0.7 : 0), timingOrigin: 'actual',
  })),
  metrics: { live_word_evidence: source, filler_count: 1 },
}))

describe('live source evidence is not a recording clock', () => {
  it('retains genuine source confidence without promoting it', () => {
    expect(readLiveWordEvidence(source)).toEqual(source)
    expect(liveEvidenceSummary(turns)).toEqual({
      sourceOnlyTurns: 2, unavailableTurns: 0, recordingClockMapped: false,
    })
    const noConfidence = { ...source, words: [{ w: 'one', start: 0, end: 1 }] }
    expect(readLiveWordEvidence(noConfidence)?.words[0]).not.toHaveProperty('recognitionConfidence')
  })

  it.each([
    { ...source, mapping: { offsetSeconds: 4, verified: true } },
    { ...source, state: 'verified' },
    { ...source, words: [{ w: 'one', start: NaN, end: 1 }] },
    { ...source, words: [{ w: 'one', start: 1, end: 0 }] },
    { ...source, words: [{ w: 'one', start: 0, end: 1, recognitionConfidence: 2 }] },
    { ...source, words: [{ w: 'one', start: 0, end: 2 }, { w: 'two', start: 1, end: 3 }] },
  ])('rejects invalid or self-certified metadata', value => {
    expect(readLiveWordEvidence(value)).toBeNull()
  })

  it('logs invalid source evidence and preserves unrelated turn metrics', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const metrics = incomingTimingMetrics({
      live_word_evidence: { ...source, mapping: { offset: 2 } },
      filler_count: 3, timing_validation: { eligibleForDeliveryEvidence: true },
    }, 'session/turn')
    expect(metrics).toMatchObject({
      filler_count: 3, timing_validation: { eligibleForDeliveryEvidence: false },
      live_word_evidence: { state: 'unavailable', reason: 'invalid_source_evidence', mapping: null },
    })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('keeps source word text out of the public metrics DTO', () => {
    expect(publicTurnMetrics(turns[0].metrics)).toEqual({ filler_count: 1 })
    expect(publicTurnMetrics(null)).toBeNull()
  })

  it('refuses legacy shifted actual words as pause or manual reprocess evidence', () => {
    const approximate = withApproximatePlaybackTiming(turns)
    expect(turns[0].words[0].timingOrigin).toBe('actual')
    expect(approximate[0].words[0].timingOrigin).toBe('synthetic')
    expect(findDeliveryPauseMoments(approximate)).toEqual([])
    expect(buildReprocessTimelineWords(segments, approximate).every(w => w.timingOrigin === 'synthetic')).toBe(true)
  })

  it('uses signature-bound alignment after fallback, with resumed segment offsets exactly once', () => {
    const raw = { version: 'delivery-alignment-v1', turns: turns.map(t => ({
      id: t.id, words: t.words.map(w => ({ ...w, timingOrigin: 'forced_alignment' })),
    })) }
    const result = validateAlignmentResult(raw, turns, segments, 'audio-1')
    const approximate = withApproximatePlaybackTiming(turns)
    const aligned = applyAlignedDelivery(approximate, result, 'audio-1', segments)
    const offsets = new Map(segments.map(s => [s.segmentId, s.replayOffsetSec]))
    const first = findDeliveryPauseMoments(aligned.slice(0, 1), offsets, 55)
    const second = findDeliveryPauseMoments(aligned.slice(1), offsets, 55)
    expect(first).toHaveLength(1)
    expect(second[0].clipStartSec - first[0].clipStartSec).toBeCloseTo(30, 9)
    expect(second[0].pauseSeconds).toBeCloseTo(0.8, 9)
    expect(findDeliveryPauseMoments(applyAlignedDelivery(approximate, result, 'audio-changed', segments)))
      .toEqual([])
    const changedText = approximate.map(t => ({ ...t, text: t.text + ' Changed.' }))
    expect(findDeliveryPauseMoments(applyAlignedDelivery(changedText, result, 'audio-1', segments))).toEqual([])
  })

  it('returns safe machine reasons, not subprocess paths or transcript errors', () => {
    expect(publicAlignmentReason('waiting_for_complete_transcript')).toBe('waiting_for_complete_transcript')
    expect(publicAlignmentReason('Cannot open /private/recording.wav')).toBe('alignment_failed')
    expect(publicAlignmentReason(null)).toBeNull()
  })
})
