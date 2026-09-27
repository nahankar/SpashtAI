import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), lease: vi.fn(), findJob: vi.fn(), findSession: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), metrics: vi.fn(), metricUpdate: vi.fn(),
  upsert: vi.fn(), resolve: vi.fn(), signature: vi.fn(), spawn: vi.fn(),
  envelopes: vi.fn(),
}))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../src/lib/agentPython', () => ({ resolveAgentPython: () => 'python' }))
vi.mock('../src/lib/sessionDiscard', () => ({ lockWritableSession: vi.fn() }))
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => ({
  resolveElevateSessionAudio: mocks.resolve, resolveElevateAudioInputSignature: mocks.signature,
}))
vi.mock('../src/analytics/recordingClockAudio', () => ({ loadSegmentEnvelopes: mocks.envelopes }))
vi.mock('../src/lib/prisma', () => {
  const tx = {
    deliveryAlignmentLease: { updateMany: mocks.claim, findUnique: mocks.lease },
    session: { findFirst: mocks.findJob, findUnique: mocks.findSession,
      update: mocks.update, updateMany: mocks.updateMany },
    sessionMetrics: { upsert: mocks.upsert, findUnique: mocks.metrics, update: mocks.metricUpdate },
  }
  return { prisma: { ...tx, $transaction: (fn: (db: unknown) => unknown) => fn(tx) } }
})

import { alignmentRetry, requestDeliveryAlignment, sweepDeliveryAlignment } from '../src/lib/deliveryAlignmentWorker'
import { validateAlignmentResult } from '../src/analytics/alignedDelivery'

const text = 'First we make one clear point. Then explain the whole plan.'
const turns = [0, 1].map(i => ({ id: `t${i}`, role: 'user', text, segmentId: 'seg', metrics: {} }))
const result = { version: 'delivery-alignment-v1', turns: turns.map((t, n) => ({ id: t.id,
  words: text.split(' ').map((w, i) => ({ w, start: n * 10 + i * 0.5,
    end: n * 10 + i * 0.5 + 0.4, timingOrigin: 'forced_alignment' })),
})) }
const snapshot = () => ({ id: 'session', endedAt: new Date(), discardedAt: null, turns,
  transcript: { conversationData: { messages: turns.map(t => ({ role: 'user', content: t.text })) } },
  segments: [{ id: 'seg', recording: { recordingType: 'user' } }], metrics: {
    totalTurns: 4, processingStatus: { content_processed: true }, communicationSignals: null,
  } })

describe('durable automatic delivery alignment', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.claim.mockImplementation(async ({ data }) => {
      if (data.owner) mocks.lease.mockResolvedValue({ owner: data.owner, expiresAt: data.expiresAt })
      return { count: 1 }
    })
    mocks.findJob.mockResolvedValue({ id: 'session', deliveryAlignmentAttempts: 0 })
    mocks.findSession.mockImplementation(async () => snapshot())
    mocks.updateMany.mockResolvedValue({ count: 1 })
    mocks.metrics.mockResolvedValue(null)
    mocks.signature.mockResolvedValue('audio-v1')
    mocks.resolve.mockResolvedValue({ audioPath: '/tmp/test.wav', inputSignature: 'audio-v1',
      segments: [{ segmentId: 'seg', segmentIndex: 0, durationSec: 25, replayOffsetSec: 0 }] })
    mocks.envelopes.mockResolvedValue(null)
    mocks.spawn.mockImplementation(() => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = { resume: vi.fn() }
      child.stdin = new EventEmitter()
      child.stdin.end = () => queueMicrotask(() => {
        child.stdout.emit('data', Buffer.from(JSON.stringify(result)))
        child.emit('close', 0)
      })
      child.kill = vi.fn()
      return child
    })
  })

  it('certifies current complete user audio and preserves concurrent status keys', async () => {
    await sweepDeliveryAlignment()
    expect(mocks.upsert).toHaveBeenCalledOnce()
    expect(mocks.upsert.mock.calls[0][0].update.processingStatus).toMatchObject({
      content_processed: true, pace: { status: 'available', source: 'word_timestamps', samples: 2 },
      deliveryTiming: { state: 'complete', source: 'forced_alignment', acceptedTurnCount: 2,
        totalTurnCount: 2, liveSource: { recordingClockMapped: false } },
    })

    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'completed', deliveryAlignmentResult: expect.objectContaining({ inputSignature: 'audio-v1' }),
    }) }))
  })

  it('reuses accepted recording-bound alignment instead of spawning another alignment job', async () => {
    const timeline = [{ segmentId: 'seg', segmentIndex: 0, durationSec: 25, replayOffsetSec: 0 }]
    const stored = validateAlignmentResult(result, turns, timeline, 'audio-v1')
    mocks.findSession.mockResolvedValue({ ...snapshot(), deliveryAlignmentResult: stored })
    await sweepDeliveryAlignment()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.upsert).toHaveBeenCalledOnce()
  })

  it('recomputes corrupt cached alignment rather than retrying that cache indefinitely', async () => {
    const timeline = [{ segmentId: 'seg', segmentIndex: 0, durationSec: 25, replayOffsetSec: 0 }]
    const stored = validateAlignmentResult(result, turns, timeline, 'audio-v1')
    stored.turns[0].words[0].end = -1
    mocks.findSession.mockResolvedValue({ ...snapshot(), deliveryAlignmentResult: stored })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sweepDeliveryAlignment()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.upsert).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('stored alignment failed validation'))
    warn.mockRestore()
  })

  it('skips Gentle when every turn maps onto the retained recording', async () => {
    const { readStreamClocks } = await import('../src/analytics/recordingClockMap')
    let state = 4
    const envelope = new Uint8Array(400)
    for (let index = 0; index < envelope.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      envelope[index] = 30 + (state % 180)
    }
    const payload = {
      version: 'elevate-stream-clock-v1', epoch: 1, sampleRate: 16000, hopSec: 0.02,
      encoding: 'uint8', envelope: Buffer.from(envelope).toString('base64'), hops: envelope.length,
    }
    const wordsFor = (origin: number) => text.split(' ').map((w, index) => ({
      w, start: origin + index * 0.5, end: origin + 0.3 + index * 0.5,
    }))
    const sample = snapshot()
    sample.turns = turns.map((turn, index) => ({ ...turn, metrics: { live_word_evidence: {
      version: 'elevate-live-words-v1', provider: 'transcribe', state: 'source_only',
      reason: 'unanchored_stt_stream', clock: 'stt_stream', mapping: null,
      epoch: 1, streamOffsetSec: 0, words: wordsFor(index === 0 ? 1 : 10),
    } } }))
    sample.metrics = { ...sample.metrics, processingStatus: { content_processed: true, liveStreamClocks: [payload] } }
    mocks.findSession.mockResolvedValue(sample)
    mocks.envelopes.mockResolvedValue(new Map([['seg', envelope]]))
    await sweepDeliveryAlignment()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(readStreamClocks([payload])).toHaveLength(1)
    expect(mocks.upsert.mock.calls[0][0].update.processingStatus.deliveryTiming).toMatchObject({
      state: 'complete', source: 'live_recording_clock', acceptedTurnCount: 2, totalTurnCount: 2,
      liveSource: { recordingClockMapped: true },
    })
  })

  it('keeps live timing for matched turns and asks Gentle only for the rest', async () => {
    const { readStreamClocks } = await import('../src/analytics/recordingClockMap')
    let state = 4
    const envelope = new Uint8Array(400)
    for (let index = 0; index < envelope.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      envelope[index] = 30 + (state % 180)
    }
    const payload = {
      version: 'elevate-stream-clock-v1', epoch: 1, sampleRate: 16000, hopSec: 0.02,
      encoding: 'uint8', envelope: Buffer.from(envelope).toString('base64'), hops: envelope.length,
    }
    const wordsFor = (origin: number, dropMiddle = false) => text.split(' ').flatMap((w, index) => (
      dropMiddle && index === 3 ? [] : [{ w, start: origin + index * 0.5, end: origin + 0.3 + index * 0.5 }]
    ))
    const sample = snapshot()
    sample.turns = turns.map((turn, index) => ({ ...turn, metrics: { live_word_evidence: {
      version: 'elevate-live-words-v1', provider: 'transcribe', state: 'source_only',
      reason: 'unanchored_stt_stream', clock: 'stt_stream', mapping: null,
      epoch: 1, streamOffsetSec: 0, words: wordsFor(index === 0 ? 1 : 10, index === 0),
    } } }))
    sample.metrics = { ...sample.metrics, processingStatus: { content_processed: true, liveStreamClocks: [payload] } }
    mocks.findSession.mockResolvedValue(sample)
    mocks.envelopes.mockResolvedValue(new Map([['seg', envelope]]))
    let requestedTurns = 0
    mocks.spawn.mockImplementation(() => {
      const child: any = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = { resume: vi.fn() }
      child.stdin = new EventEmitter()
      child.stdin.end = (body: string) => {
        requestedTurns = JSON.parse(body).turns.length
        queueMicrotask(() => {
          child.stdout.emit('data', Buffer.from(JSON.stringify(result)))
          child.emit('close', 0)
        })
      }
      child.kill = vi.fn()
      return child
    })
    await sweepDeliveryAlignment()
    expect(requestedTurns).toBe(1)
    expect(readStreamClocks([payload])).toHaveLength(1)
    expect(mocks.upsert.mock.calls[0][0].update.processingStatus.deliveryTiming).toMatchObject({
      state: 'complete', source: 'mixed', acceptedTurnCount: 2, totalTurnCount: 2,
    })
    const stored = mocks.update.mock.calls[0][0].data.deliveryAlignmentResult
    expect(stored.version).toBe('delivery-alignment-hybrid-v1')
    expect(stored.turns.find((turn: { id: string }) => turn.id === 't1').words[0].timingOrigin).toBe('actual')
    expect(stored.turns.find((turn: { id: string }) => turn.id === 't0').words[0].timingOrigin).toBe('forced_alignment')
  })

  it('does not bypass Gentle for source-only words without a recording-clock anchor', async () => {
    const sample = snapshot()
    sample.turns = turns.map(t => ({ ...t, metrics: { live_word_evidence: {
      version: 'elevate-live-words-v1', provider: 'aws-transcribe', state: 'source_only',
      reason: 'recording_clock_unmapped', clock: 'stt_stream', mapping: null,
      words: [{ w: 'First', start: 0, end: 0.5, recognitionConfidence: 1 }],
    } } }))
    mocks.findSession.mockResolvedValue(sample)
    await sweepDeliveryAlignment()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.upsert.mock.calls[0][0].update.processingStatus.deliveryTiming.liveSource)
      .toMatchObject({ sourceOnlyTurns: 2, recordingClockMapped: false })
  })

  it('leaves a running replica alone and recovers processing jobs through the durable selector', async () => {
    mocks.claim.mockResolvedValue({ count: 0 })
    await sweepDeliveryAlignment()
    expect(mocks.findJob).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('rejects changed audio and requeues instead of certifying the old result', async () => {
    mocks.signature.mockResolvedValue('audio-v2')
    await sweepDeliveryAlignment()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'pending',
    }) }))
  })

  it('rejects a late transcript change even if word count is unchanged', async () => {
    mocks.findSession.mockResolvedValueOnce(snapshot()).mockResolvedValue({ ...snapshot(),
      turns: turns.map(t => ({ ...t, text: t.text.replace('clear', 'other') })) })
    await sweepDeliveryAlignment()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('waits when committed turns are only part of the full transcript', async () => {
    const full = snapshot()
    full.transcript.conversationData.messages.push({ role: 'user', content: 'This final response has not been persisted as a turn yet.' })
    mocks.findSession.mockResolvedValue(full)
    await sweepDeliveryAlignment()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'retry', deliveryAlignmentError: 'waiting_for_complete_transcript',
    }) }))
  })

  it('rechecks the full transcript under lock before committing', async () => {
    const changed = snapshot()
    changed.transcript.conversationData.messages.push({ role: 'user', content: 'A late final response.' })
    mocks.findSession.mockResolvedValueOnce(snapshot()).mockResolvedValue(changed)
    await sweepDeliveryAlignment()
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(mocks.upsert).not.toHaveBeenCalled()
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'pending',
    }) }))
  })

  it('does not write after lease takeover or discard', async () => {
    mocks.claim.mockResolvedValue({ count: 1 })
    mocks.lease.mockResolvedValue({ owner: 'another-worker', expiresAt: new Date(Date.now() + 999999) })
    await sweepDeliveryAlignment()
    expect(mocks.upsert).not.toHaveBeenCalled()
    mocks.findSession.mockResolvedValue({ ...snapshot(), discardedAt: new Date() })
    await sweepDeliveryAlignment()
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('retries absent uploads and refuses coach+user audio before invoking alignment', async () => {
    mocks.resolve.mockResolvedValueOnce(null)
    await sweepDeliveryAlignment()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'retry', deliveryAlignmentError: 'waiting_for_recording_or_transcript',
    }) }))
    mocks.findSession.mockResolvedValue({ ...snapshot(), segments: [{ id: 'seg', recording: { recordingType: 'room_composite' } }] })
    await sweepDeliveryAlignment()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('requeues late evidence and invalidates earlier alignment-derived pace', async () => {
    mocks.metrics.mockResolvedValue({ processingStatus: { content_processed: true,
      deliveryTiming: { state: 'complete', acceptedTurnCount: 2 },
      pace: { origin: 'post_session_alignment' } },
      communicationSignals: { speechRate: { wpm: 120 } }, skillScores: { scores: { clarity: 8, pacing: 9 } } })
    const tx: any = { session: { updateMany: mocks.updateMany }, sessionMetrics: { findUnique: mocks.metrics, update: mocks.metricUpdate } }
    await requestDeliveryAlignment(tx, 'session')
    expect(mocks.metricUpdate.mock.calls[0][0].data).toMatchObject({ userWpm: 0,
      processingStatus: { content_processed: true, pace: { status: 'insufficient_evidence' } },
      skillScores: { scores: { clarity: 8, pacing: null } },
    })
    expect(mocks.metricUpdate.mock.calls[0][0].data.processingStatus).not.toHaveProperty('deliveryTiming')
    expect(alignmentRetry(5, 'unreachable')).toMatchObject({ deliveryAlignmentStatus: 'unavailable', deliveryAlignmentNextAt: null })
  })

  it('stops retrying when alignment output is deterministically rejected', () => {
    expect(alignmentRetry(1, 'alignment_rejected')).toMatchObject({
      deliveryAlignmentStatus: 'unavailable', deliveryAlignmentError: 'alignment_rejected', deliveryAlignmentNextAt: null,
    })
    expect(alignmentRetry(1, 'alignment_coverage_insufficient')).toMatchObject({ deliveryAlignmentStatus: 'unavailable' })
    expect(alignmentRetry(1, 'alignment_service_failed')).toMatchObject({ deliveryAlignmentStatus: 'retry' })
  })

  it('invalidates stale coverage even when the selected pace came from live durations', async () => {
    mocks.metrics.mockResolvedValue({ processingStatus: {
      deliveryTiming: { state: 'partial', acceptedTurnCount: 1 },
      pace: { origin: 'live_logical_turns', status: 'available' },
    } })
    const tx: any = { session: { updateMany: mocks.updateMany },
      sessionMetrics: { findUnique: mocks.metrics, update: mocks.metricUpdate } }
    await requestDeliveryAlignment(tx, 'session')
    expect(mocks.metricUpdate.mock.calls[0][0].data.processingStatus).toEqual({
      pace: { origin: 'live_logical_turns', status: 'available' },
    })
  })
})
