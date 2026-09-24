import { describe, expect, it } from 'vitest'
import { ALIGNMENT_VERSION, applyAlignedDelivery, committedTranscriptMatches, paceFromAlignment, resolveCanonicalDeliveryPace, validateAlignmentResult } from '../src/analytics/alignedDelivery'
import { findDeliveryPauseMoments } from '../src/analytics/deliveryMoments'

const segments = [{ segmentId: 's1', segmentIndex: 0, replayOffsetSec: 0, durationSec: 15 },
  { segmentId: 's2', segmentIndex: 1, replayOffsetSec: 15, durationSec: 15 }]
const text = 'First we define a clear outcome. Then we explain the plan.'
const turns = ['s1', 's2'].map((segmentId, i) => ({ id: `t${i}`, role: 'user', text, segmentId,
  turnIndex: i, metrics: { filler_count: 1 }, words: null, audioStart: 0, audioEnd: 1 }))
const raw = { version: ALIGNMENT_VERSION, turns: turns.map(t => ({ id: t.id,
  words: text.split(' ').map((w, i) => ({ w, start: i * 0.5 + (i > 5 ? 0.6 : 0),
    end: i * 0.5 + 0.4 + (i > 5 ? 0.6 : 0), timingOrigin: 'forced_alignment' as const })),
})) }

describe('automatic delivery alignment consumer contract', () => {
  it('requires exact full user content, allowing different turn boundaries', () => {
    expect(committedTranscriptMatches(turns, { messages: [{ role: 'user', content: `${text} ${text}` }] })).toBe(true)
    expect(committedTranscriptMatches(turns, { messages: [{ role: 'user', content: `${text} ${text} Missing response.` }] })).toBe(false)
    expect(committedTranscriptMatches(turns, null)).toBe(false)
    expect(committedTranscriptMatches(turns, { messages: [] })).toBe(false)
    expect(committedTranscriptMatches(turns, { messages: [{ role: 'user', content: `${text} ${text.replace('clear', 'other')}` }] })).toBe(false)
  })

  it('uses the same accepted samples for headline pace and variability', () => {
    const sourceTurns = [100, 100, 30].map((n, i) => ({ id: `t${i}`, role: 'user', segmentId: 's',
      text: Array(n).fill('word').join(' '), metrics: { pace_source: 'estimated' } }))
    const timeline = [{ segmentId: 's', segmentIndex: 0, replayOffsetSec: 0, durationSec: 140 }]
    const output = { version: ALIGNMENT_VERSION, turns: sourceTurns.map((t, i) => ({ id: t.id,
      words: t.text.split(' ').map((w, j) => ({ w, start: i * 55 + j * (i === 2 ? .14 : .5),
        end: i * 55 + j * (i === 2 ? .14 : .5) + .1, timingOrigin: 'forced_alignment' })),
    })) }
    const result = validateAlignmentResult(output, sourceTurns, timeline, 'sig')
    const input = { turns: sourceTurns, result, inputSignature: 'sig', segments: timeline,
      transcript: { messages: sourceTurns.map(t => ({ role: 'user', content: t.text })) },
      processingStatus: null, expectedWords: 230 }
    const first = resolveCanonicalDeliveryPace(input)
    expect(first.pace).toMatchObject({ status: 'available', samples: 2 })
    expect(first.pace.wpm).toBeCloseTo(120.97, 2)
    expect(first.variability).toBeCloseTo(0)
    // A later analytics call still sees original estimated rows, not the overlay.
    const later = resolveCanonicalDeliveryPace({ ...input, processingStatus: { pace: first.pace } })
    expect(later).toEqual(first)
    expect(resolveCanonicalDeliveryPace({ ...input, inputSignature: 'changed',
      processingStatus: { pace: first.pace } }).pace.status).toBe('insufficient_evidence')
  })
  it('carries actual word gaps into playable resumed-segment moments and pace', () => {
    const result = validateAlignmentResult(raw, turns, segments, 'audio-v1')
    const overlaid = applyAlignedDelivery(turns, result, 'audio-v1', segments)
    expect(overlaid[0].metrics).toMatchObject({ filler_count: 1, pace_source: 'word_timestamps' })
    expect(overlaid[0].audioEnd).toBeCloseTo(6)
    const pace = paceFromAlignment(overlaid, result)
    expect(pace).toMatchObject({ status: 'available', source: 'word_timestamps',
      origin: 'post_session_alignment', samples: 2, totalWords: 22, timestampCoverage: 1 })
    expect(pace.wpm).toBeCloseTo(110)
    const moments = findDeliveryPauseMoments(overlaid, new Map([['s1', 0], ['s2', 15]]), 30,
      new Map([['s1', 15], ['s2', 15]]))
    expect(moments).toHaveLength(1) // existing UI selects one moment per category
    const resumed = findDeliveryPauseMoments(overlaid.slice(1), new Map([['s2', 15]]), 30,
      new Map([['s2', 15]]))
    expect(resumed[0].startSec - moments[0].startSec).toBeCloseTo(15)
    expect(moments[0].pauseSeconds).toBeCloseTo(0.7)
  })

  it('does not serve alignment for changed audio, text or timeline', () => {
    const result = validateAlignmentResult(raw, turns, segments, 'audio-v1')
    expect(applyAlignedDelivery(turns, result, 'audio-v2', segments)).toBe(turns)
    const changed = turns.map(t => ({ ...t, text: t.text + ' Changed.' }))
    expect(applyAlignedDelivery(changed, result, 'audio-v1', segments)).toBe(changed)
    expect(applyAlignedDelivery(turns, result, 'audio-v1', segments.map(s => ({ ...s, durationSec: 14 })))).toBe(turns)
  })

  it('rejects synthetic, overlapping, mismatched and incomplete worker output', () => {
    for (const modify of [
      (r: typeof raw) => { r.turns[0].words[0].timingOrigin = 'synthetic' as any },
      (r: typeof raw) => { r.turns[0].words[1].start = 0.1 },
      (r: typeof raw) => { r.turns[0].words[0].w = 'wrong' },
      (r: typeof raw) => { r.turns[0].words.pop() },
      (r: typeof raw) => { r.turns.push(r.turns[0]) },
    ]) {
      const copy = structuredClone(raw)
      modify(copy)
      expect(() => validateAlignmentResult(copy, turns, segments, 'sig')).toThrow()
    }
  })

  it('does not promote partial transcript coverage to a headline pace', () => {
    const result = validateAlignmentResult({ ...raw, turns: raw.turns.slice(0, 1) }, turns, segments, 'sig')
    const aligned = applyAlignedDelivery(turns, result, 'sig', segments)
    expect(paceFromAlignment(aligned, result).status).toBe('insufficient_evidence')
  })
})
