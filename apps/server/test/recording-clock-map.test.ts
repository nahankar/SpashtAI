import { deflateSync } from 'zlib'
import { describe, expect, it } from 'vitest'
import { applyAlignedDelivery, validateAlignmentResult } from '../src/analytics/alignedDelivery'
import {
  correlateStreamLag, envelopeFromPcm16, mapLiveRecordingEvidence, mergeStreamClockSnapshots,
  readStreamClocks, streamClockSignature,
} from '../src/analytics/recordingClockMap'

function pattern(length: number, seed: number): Uint8Array {
  let state = seed >>> 0
  const out = new Uint8Array(length)
  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    out[index] = 30 + (state % 180)
  }
  return out
}

function clock(epoch: number, envelope: Uint8Array) {
  return {
    version: 'elevate-stream-clock-v1', epoch, sampleRate: 16000, hopSec: 0.02,
    encoding: 'uint8', envelope: Buffer.from(envelope).toString('base64'), hops: envelope.length,
  }
}

function evidence(epoch: number, offset: number, words: Array<{ w: string, start: number, end: number }>) {
  return {
    version: 'elevate-live-words-v1', provider: 'transcribe', state: 'source_only',
    reason: 'unanchored_stt_stream', clock: 'stt_stream', mapping: null,
    epoch, streamOffsetSec: offset, words,
  }
}

describe('live recording clock', () => {
  it('uses the same RMS scale as the agent envelope', () => {
    const samples = new Int16Array(320)
    samples.fill(1280)
    expect(envelopeFromPcm16(samples, 16000)).toEqual(new Uint8Array([10]))
  })

  it('finds a recording that starts before or after the STT stream', () => {
    const stream = pattern(240, 11)
    const later = stream.slice(40, 200)
    expect(correlateStreamLag(stream, later)?.lagHops).toBe(40)
    const earlier = new Uint8Array(30 + stream.length)
    earlier.set(stream, 30)
    expect(correlateStreamLag(stream, earlier)?.lagHops).toBe(-30)
    expect(correlateStreamLag(pattern(80, 1), pattern(80, 2))).toBeNull()
  })

  it('maps two segments and a reconnect onto the merged recording timeline', () => {
    const first = pattern(360, 4)
    const second = pattern(360, 9)
    const segmentA = first.slice(20, 260)
    const segmentB = second.slice(15, 250)
    const durationA = segmentA.length * 0.02
    const durationB = segmentB.length * 0.02
    const segments = [
      { segmentId: 'a', segmentIndex: 0, replayOffsetSec: 0, durationSec: durationA },
      { segmentId: 'b', segmentIndex: 1, replayOffsetSec: durationA, durationSec: durationB },
    ]
    const offset = 3
    const turn = (id: string, segmentId: string, epoch: number, localStart: number) => ({
      id, role: 'user', segmentId, text: 'hello there',
      metrics: { live_word_evidence: evidence(epoch, offset, [
        { w: 'hello', start: offset + localStart, end: offset + localStart + 0.3 },
        { w: 'there', start: offset + localStart + 0.4, end: offset + localStart + 0.7 },
      ]) },
    })
    const turns = [
      turn('t0', 'a', 1, 0.5),
      turn('t1', 'b', 2, 0.4),
    ]
    const clocks = readStreamClocks([clock(1, first), clock(2, second)])
    const mapped = mapLiveRecordingEvidence({
      turns, segments, clocks,
      envelopes: new Map([['a', segmentA], ['b', segmentB]]),
      inputSignature: 'audio-v1',
    })
    expect(mapped.result).toBeTruthy()
    const validated = validateAlignmentResult(mapped.result, turns, segments, 'audio-v1')
    expect(validated.version).toBe('elevate-recording-clock-v1')
    expect(validated.turns[0].words[0]).toMatchObject({ timingOrigin: 'actual', start: 0.1 })
    const clipStart = segments[1].replayOffsetSec + validated.turns[1].words[0].start
    expect(clipStart).toBeCloseTo(durationA + 0.1, 5)
    expect(validated.turns[1].words[1].end - validated.turns[1].words[0].start).toBeCloseTo(0.7, 5)

    const applied = applyAlignedDelivery(turns, validated, 'audio-v1', segments, streamClockSignature(clocks))
    expect(applied[1].words?.[0]).toMatchObject({ timingOrigin: 'actual' })
    expect(applyAlignedDelivery(turns, validated, 'audio-v1', segments, 'stale-clock')[0].words).toBeUndefined()
    const changed = turns.map(item => ({ ...item, text: 'hello friend' }))
    expect(applyAlignedDelivery(changed, validated, 'audio-v1', segments, streamClockSignature(clocks))[0].words)
      .toBeUndefined()
  })

  it('keeps same-numbered epochs separate across pause and resume segments', () => {
    const first = pattern(260, 31)
    const second = pattern(260, 47)
    const stored = mergeStreamClockSnapshots([], [clock(1, first)], 'segment-a')
    const merged = mergeStreamClockSnapshots(stored, [clock(1, second)], 'segment-b')
    const clocks = readStreamClocks(merged)
    expect(clocks.map(item => [item.segmentId, item.epoch])).toEqual([
      ['segment-a', 1],
      ['segment-b', 1],
    ])

    const segments = [
      { segmentId: 'segment-a', segmentIndex: 0, replayOffsetSec: 0, durationSec: 4 },
      { segmentId: 'segment-b', segmentIndex: 1, replayOffsetSec: 4, durationSec: 4 },
    ]
    const turn = (id: string, segmentId: string) => ({
      id, role: 'user', segmentId, text: 'hello there',
      metrics: { live_word_evidence: evidence(1, 0, [
        { w: 'hello', start: 0.2, end: 0.5 },
        { w: 'there', start: 0.6, end: 0.9 },
      ]) },
    })
    const mapped = mapLiveRecordingEvidence({
      turns: [turn('before', 'segment-a'), turn('after', 'segment-b')],
      segments,
      clocks,
      envelopes: new Map([['segment-a', first], ['segment-b', second]]),
      inputSignature: 'audio',
    })
    expect(mapped.result?.turns.map(item => item.id)).toEqual(['before', 'after'])
  })

  it('rejects an unmapped, mismatched, or incomplete turn and keeps Gentle responsible', () => {
    const stream = pattern(200, 6)
    const segments = [{ segmentId: 'a', segmentIndex: 0, replayOffsetSec: 0, durationSec: 4 }]
    const clocks = readStreamClocks([clock(1, stream)])
    const base = {
      id: 't', role: 'user', segmentId: 'a', text: 'hello there',
      metrics: { live_word_evidence: evidence(1, 0, [
        { w: 'hello', start: 0.2, end: 0.5 },
        { w: 'there', start: 0.6, end: 0.9 },
      ]) },
    }
    const envelopes = new Map([['a', stream]])
    expect(mapLiveRecordingEvidence({
      turns: [base], segments, clocks, envelopes, inputSignature: 'audio',
    }).result).toBeTruthy()
    expect(mapLiveRecordingEvidence({
      turns: [{ ...base, metrics: { live_word_evidence: { ...evidence(1, 0, [
        { w: 'hello', start: 0.2, end: 0.5 },
        { w: 'other', start: 0.6, end: 0.9 },
      ]), } } }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })).toMatchObject({ result: null, reason: 'lexical_or_timing_mismatch' })
    expect(mapLiveRecordingEvidence({
      turns: [{ ...base, metrics: { live_word_evidence: {
        ...evidence(1, 0, [{ w: 'hello', start: 0.2, end: 0.5 }]),
      } } }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })).toMatchObject({ result: null, reason: 'incomplete_words' })
    expect(mapLiveRecordingEvidence({
      turns: [{ ...base, metrics: { live_word_evidence: evidence(9, 0, [
        { w: 'hello', start: 0.2, end: 0.5 },
        { w: 'there', start: 0.6, end: 0.9 },
      ]) } }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })).toMatchObject({ result: null, reason: 'missing_stream_clock' })
    expect(mapLiveRecordingEvidence({
      turns: [{ ...base, metrics: { live_word_evidence: evidence(1, 0, [
        { w: 'hello', start: 8, end: 8.2 },
        { w: 'there', start: 8.3, end: 8.5 },
      ]) } }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })).toMatchObject({ result: null, reason: 'out_of_bounds' })
    const zlibClock = {
      ...clock(1, stream), encoding: 'zlib',
      envelope: deflateSync(Buffer.from(stream)).toString('base64'),
    }
    expect(readStreamClocks([zlibClock])[0].envelope).toEqual(stream)
    expect(readStreamClocks([{ ...clock(1, stream), hops: stream.length - 1 }])).toEqual([])
  })

  it('keeps a matched turn when another turn has a minor gap', () => {
    const stream = pattern(200, 6)
    const segments = [{ segmentId: 'a', segmentIndex: 0, replayOffsetSec: 0, durationSec: 4 }]
    const clocks = readStreamClocks([clock(1, stream)])
    const full = {
      id: 'kept', role: 'user', segmentId: 'a', text: 'hello there',
      metrics: { live_word_evidence: evidence(1, 0, [
        { w: 'hello', start: 0.2, end: 0.5 },
        { w: 'there', start: 0.6, end: 0.9 },
      ]) },
    }
    const gapped = {
      id: 'gapped', role: 'user', segmentId: 'a', text: 'hello there friend',
      metrics: { live_word_evidence: evidence(1, 0, [
        { w: 'hello', start: 1.2, end: 1.5 },
        { w: 'friend', start: 1.8, end: 2.1 },
      ]) },
    }
    const mapped = mapLiveRecordingEvidence({
      turns: [full, gapped], segments, clocks,
      envelopes: new Map([['a', stream]]), inputSignature: 'audio',
    })
    expect(mapped.result).toBeTruthy()
    expect(mapped.unmappedTurnIds).toEqual(['gapped'])
    expect(mapped.result?.turns).toHaveLength(1)
    expect(mapped.result?.turns[0].id).toBe('kept')
  })

  it('joins a hyphenated transcript word to one or two timed items', () => {
    const stream = pattern(200, 8)
    const segments = [{ segmentId: 'a', segmentIndex: 0, replayOffsetSec: 0, durationSec: 4 }]
    const clocks = readStreamClocks([clock(1, stream)])
    const envelopes = new Map([['a', stream]])
    const single = mapLiveRecordingEvidence({
      turns: [{
        id: 'one', role: 'user', segmentId: 'a', text: 'a part-time role',
        metrics: { live_word_evidence: evidence(1, 0, [
          { w: 'a', start: 0.2, end: 0.4 },
          { w: 'part-time', start: 0.5, end: 0.9 },
          { w: 'role', start: 1.0, end: 1.3 },
        ]) },
      }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })
    expect(single.result?.turns[0].words.map(word => word.w)).toEqual(['a', 'part-time', 'role'])
    const split = mapLiveRecordingEvidence({
      turns: [{
        id: 'two', role: 'user', segmentId: 'a', text: 'a part-time role',
        metrics: { live_word_evidence: evidence(1, 0, [
          { w: 'a', start: 0.2, end: 0.4 },
          { w: 'part', start: 0.5, end: 0.7 },
          { w: 'time', start: 0.7, end: 0.9 },
          { w: 'role', start: 1.0, end: 1.3 },
        ]) },
      }],
      segments, clocks, envelopes, inputSignature: 'audio',
    })
    expect(split.result?.turns[0].words).toMatchObject([
      { w: 'a', tokenIndex: 0 },
      { w: 'part-time', start: 0.5, end: 0.9, tokenIndex: 1 },
      { w: 'role', tokenIndex: 2 },
    ])
  })
})
