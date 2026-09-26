import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  session: vi.fn(), turns: vi.fn(), latest: vi.fn(), upsert: vi.fn(),
  segments: vi.fn(), segment: vi.fn(), resolve: vi.fn(), flags: vi.fn(), align: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => {
  const db = {
    session: { findUnique: mocks.session },
    sessionTurn: { findMany: mocks.turns, findFirst: mocks.latest, upsert: mocks.upsert },
    sessionSegment: { findMany: mocks.segments, findUnique: mocks.segment },
    $executeRaw: vi.fn(),
  }
  return { prisma: { ...db, $transaction: (fn: (tx: unknown) => unknown) => fn(db) } }
})
vi.mock('../src/lib/sessionDiscard', () => ({
  lockWritableSession: vi.fn(), SessionDiscardedError: class extends Error {},
  SessionMissingError: class extends Error {},
}))
vi.mock('../src/lib/userExportFlags', () => ({
  getElevateSessionOwnerId: vi.fn(async () => 'owner'),
  resolveRequestExportFlags: mocks.flags,
  exportDenied: (res: express.Response, error: string) => res.status(403).json({ error }),
}))
vi.mock('../src/lib/paceReconciliationWorker', () => ({
  queuePaceReconciliation: vi.fn(), requeuePaceReconciliationData: () => ({}),
}))
vi.mock('../src/lib/deliveryAlignmentWorker', () => ({ requestDeliveryAlignment: vi.fn() }))
vi.mock('../src/analytics/insightProviders/resolveSessionAudio', () => ({
  resolveElevateSessionAudio: mocks.resolve, resolveSessionSegmentAudio: mocks.resolve,
}))
vi.mock('../src/lib/audioAlignment', () => ({
  alignTurnsToAudio: mocks.align,
  buildSkipIntervalsFromTurnWords: () => [],
  buildSkipPlaybackRegions: () => [],
  detectSpeechRegions: async () => [],
}))

import { getSessionTurns, saveSessionTurnsForAgent } from '../src/routes/turns'

const source = {
  version: 'elevate-live-words-v1', provider: 'transcribe', state: 'source_only',
  reason: 'recording_clock_unmapped', clock: 'stt_stream', mapping: null,
  words: [{ w: 'private-word', start: 1, end: 2 }],
}
const turn = {
  id: 'turn-1', turnIndex: 0, role: 'user', text: 'private-word',
  audioStart: 1, audioEnd: 2, segmentId: null,
  words: [{ w: 'private-word', start: 1, end: 2, timingOrigin: 'actual' }],
  metrics: { filler_count: 0, live_word_evidence: source },
}
const app = express()
app.use(express.json())
app.get('/sessions/:sessionId/turns', getSessionTurns)
app.post('/internal/sessions/:sessionId/turns', saveSessionTurnsForAgent)

describe('live evidence turn API boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.mockResolvedValue({ recordingStartedAt: new Date(0), endedAt: null })
    mocks.flags.mockResolvedValue({ flags: { hideTranscriptText: false }, accessDenied: false })
    mocks.turns.mockResolvedValue([structuredClone(turn)])
    mocks.segments.mockResolvedValue([])
    mocks.resolve.mockResolvedValue({ audioPath: '/synthetic.wav', inputSignature: 'audio', segments: [] })
    mocks.align.mockResolvedValue({ aligned: false, turns: [], regionCount: 0, userTurnCount: 1 })
  })

  it('retains source metadata internally but only approximate positions in turn words', async () => {
    const response = await request(app).post('/internal/sessions/s/turns')
      .set('x-internal-agent-token', 'dev-internal-agent-token')
      .send({ turns: [turn], sttEpochMs: 5000 })
    expect(response.status).toBe(201)
    const saved = mocks.upsert.mock.calls[0][0].create
    expect(saved.metrics.live_word_evidence.words[0].start).toBe(1)
    expect(saved.words[0]).toMatchObject({ start: 6, timingOrigin: 'synthetic' })
    expect(saved.audioStart).toBe(6)
  })

  it('does not accept source evidence from an unauthenticated caller', async () => {
    expect((await request(app).post('/internal/sessions/s/turns').send({ turns: [turn] })).status).toBe(401)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('keeps raw words private on every public metrics response, including restricted transcripts', async () => {
    const visible = await request(app).get('/sessions/s/turns')
    expect(visible.status).toBe(200)
    expect(visible.body.turns[0].words[0].timingOrigin).toBe('synthetic')
    expect(visible.body.turns[0].metrics).not.toHaveProperty('live_word_evidence')
    mocks.flags.mockResolvedValue({ flags: { hideTranscriptText: true }, accessDenied: false })
    const hidden = await request(app).get('/sessions/s/turns')
    expect(hidden.status).toBe(200)
    expect(JSON.stringify(hidden.body)).not.toContain('private-word')
    expect(hidden.body.turns[0].metrics).toEqual({ filler_count: 0 })
  })

  it('denies public turn access before reading source evidence', async () => {
    mocks.flags.mockResolvedValue({ flags: {}, accessDenied: true })
    expect((await request(app).get('/sessions/s/turns')).status).toBe(403)
    expect(mocks.turns).not.toHaveBeenCalled()
  })
})
