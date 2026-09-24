import { EventEmitter } from 'events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(), lease: vi.fn(), findJob: vi.fn(), findSession: vi.fn(),
  update: vi.fn(), updateMany: vi.fn(), metrics: vi.fn(), metricUpdate: vi.fn(),
  upsert: vi.fn(), resolve: vi.fn(), signature: vi.fn(), spawn: vi.fn(),
}))
vi.mock('child_process', () => ({ spawn: mocks.spawn }))
vi.mock('../src/lib/agentPython', () => ({ resolveAgentPython: () => 'python' }))
vi.mock('../src/lib/sessionDiscard', () => ({ lockWritableSession: vi.fn() }))
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => ({
  resolveElevateSessionAudio: mocks.resolve, resolveElevateAudioInputSignature: mocks.signature,
}))
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
    })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'completed', deliveryAlignmentResult: expect.objectContaining({ inputSignature: 'audio-v1' }),
    }) }))
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
    mocks.metrics.mockResolvedValue({ processingStatus: { content_processed: true, pace: { origin: 'post_session_alignment' } },
      communicationSignals: { speechRate: { wpm: 120 } }, skillScores: { scores: { clarity: 8, pacing: 9 } } })
    const tx: any = { session: { updateMany: mocks.updateMany }, sessionMetrics: { findUnique: mocks.metrics, update: mocks.metricUpdate } }
    await requestDeliveryAlignment(tx, 'session')
    expect(mocks.metricUpdate.mock.calls[0][0].data).toMatchObject({ userWpm: 0,
      processingStatus: { content_processed: true, pace: { status: 'insufficient_evidence' } },
      skillScores: { scores: { clarity: 8, pacing: null } },
    })
    expect(alignmentRetry(5, 'unreachable')).toMatchObject({ deliveryAlignmentStatus: 'unavailable', deliveryAlignmentNextAt: null })
  })
})
