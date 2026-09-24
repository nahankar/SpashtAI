import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  sessionMetrics: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
  sessionTranscript: { findUnique: vi.fn(), upsert: vi.fn() },
  sessionTurn: { findMany: vi.fn() }, sessionSegment: { findMany: vi.fn() },
  progressPulse: { count: vi.fn() }, resolve: vi.fn(), signature: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => {
  const db = { ...mocks, $queryRaw: vi.fn(async () => [{ discardedAt: null }]) }
  return { prisma: { ...db, $transaction: (fn: (tx: unknown) => unknown) => fn(db) } }
})
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => ({
  resolveElevateSessionAudio: mocks.resolve, resolveElevateAudioInputSignature: mocks.signature,
}))
vi.mock('../src/analytics/insightGenerator', () => ({
  resolveElevateSessionAudio: mocks.resolve, generateCoachingInsights: vi.fn(async () => ({})),
}))
vi.mock('../src/analytics/audioEnrichment', () => ({
  fetchProsodyForPath: vi.fn(async () => null), scheduleElevateSessionAudioEnrichmentIfAnalyzed: vi.fn(),
}))
vi.mock('../src/lib/featureFlags', () => ({ isFeatureAccessible: vi.fn(async () => true) }))
vi.mock('../src/lib/paceReconciliationWorker', () => ({
  queuePaceReconciliation: vi.fn(), requeuePaceReconciliationData: () => ({}),
}))

import { analyzeSession } from '../src/routes/analytics'
import { saveSessionTranscript } from '../src/routes/metrics'
import { inspectDeliveryMoments } from '../src/analytics/deliveryMoments'
import { validateAlignmentResult } from '../src/analytics/alignedDelivery'

const text = 'First we make one clear point. Then explain the whole plan.'
const turns = [0, 1].map(i => ({ id: `t${i}`, role: 'user', text, segmentId: 'seg', metrics: { pace_source: 'estimated' } }))
const segments = [{ segmentId: 'seg', segmentIndex: 0, replayOffsetSec: 0, durationSec: 25 }]
const result = validateAlignmentResult({ version: 'delivery-alignment-v1', turns: turns.map((t, n) => ({ id: t.id,
  words: text.split(' ').map((w, i) => ({ w, start: n * 10 + i * .5, end: n * 10 + i * .5 + .4, timingOrigin: 'forced_alignment' })),
})) }, turns, segments, 'audio')
const conversationData = { messages: turns.map(t => ({ role: t.role, content: t.text })) }
const signals = {
  speechRate: { wpm: 0, variability: null, totalWords: 22 },
  fillers: { count: 0, rate: 0, byType: {} }, hedging: { count: 0, rate: 0, phrases: [] },
  sentenceComplexity: { avgLength: 11, subordinateRatio: .2, readability: 60, fleschKincaid: 8, gunningFog: 8 },
  vocabDiversity: { ratio: .6, uniqueWords: 13, totalWords: 22, sophistication: 5 },
  topicCoherence: { avgSimilarity: .8, driftCount: 0 }, questionHandling: { questionsReceived: 0, avgResponseTime: 0, relevanceScores: [] },
  talkListenBalance: { userRatio: .5 }, interactionSignals: { questionsAsked: 0, participantReferences: 0, followUps: 0 },
  ideaStructure: { markerCount: 2, markerTypes: {} },
}
const session = { id: 'session', endedAt: new Date(), durationSec: 25, turns,
  segments: [], transcript: { conversationData }, deliveryAlignmentResult: result, deliveryAlignmentStatus: 'completed' }

describe('delivery alignment route integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.findUnique.mockResolvedValue(session)
    mocks.session.updateMany.mockResolvedValue({ count: 1 })
    mocks.sessionMetrics.findUnique.mockResolvedValue(null)
    mocks.sessionTranscript.findUnique.mockResolvedValue(null)
    mocks.sessionTranscript.upsert.mockImplementation(async ({ create }) => create)
    mocks.sessionTurn.findMany.mockResolvedValue([])
    mocks.sessionSegment.findMany.mockResolvedValue([{ id: 'seg', audioStatus: 'pending' }])
    mocks.progressPulse.count.mockResolvedValue(0)
    mocks.resolve.mockResolvedValue({ audioPath: '/tmp/fixture.wav', inputSignature: 'audio', segments })
    mocks.signature.mockResolvedValue('audio')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ signals: structuredClone(signals) }) })))
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each([false, true])('preserves aligned scoring on analyze, including completion during the request: %s', async (late) => {
    if (late) mocks.session.findUnique.mockResolvedValueOnce({ ...session, deliveryAlignmentResult: null })
    const app = express(); app.use(express.json()); app.post('/sessions/:sessionId/analyze', analyzeSession)
    const response = await request(app).post('/sessions/session/analyze').send({})
    expect(response.status).toBe(200)
    expect(response.body.skillScores.pacing).toBeTypeOf('number')
    const saved = mocks.sessionMetrics.upsert.mock.calls[0][0].update
    expect(saved.communicationSignals.speechRate.variability).toBeCloseTo(0)
    expect(saved.processingStatus.pace.origin).toBe('post_session_alignment')
    expect(response.body.signalsSummary.wpm).toBeCloseTo(saved.userWpm)
  })

  it.each([null, { audioPath: '/tmp/fixture.wav', inputSignature: 'audio', segments }])(
    'reports terminal unavailability for missing audio or turns, and becomes pending after requeue: %s', async (audio) => {
      mocks.resolve.mockResolvedValue(audio)
      mocks.session.findUnique.mockResolvedValue({ deliveryAlignmentStatus: 'unavailable' })
      expect((await inspectDeliveryMoments('session')).status).toMatchObject({ state: 'suppressed', reason: 'alignment_unavailable' })
      mocks.session.findUnique.mockResolvedValue({ deliveryAlignmentStatus: 'pending' })
      expect((await inspectDeliveryMoments('session')).status.state).toBe('pending')
    },
  )

  it('requeues a late full transcript and clears its previous alignment; identical retries do not invalidate it', async () => {
    const app = express(); app.use(express.json()); app.post('/sessions/:sessionId/transcript', saveSessionTranscript)
    expect((await request(app).post('/sessions/session/transcript').send(conversationData)).status).toBe(200)
    expect(mocks.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      deliveryAlignmentStatus: 'pending', deliveryAlignmentResult: expect.anything(),
    }) }))
    mocks.session.updateMany.mockClear()
    mocks.sessionTranscript.findUnique.mockResolvedValue({ conversationData })
    expect((await request(app).post('/sessions/session/transcript').send(conversationData)).status).toBe(200)
    expect(mocks.session.updateMany).not.toHaveBeenCalled()
  })
})
