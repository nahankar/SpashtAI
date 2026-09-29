import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  replay: vi.fn(), session: vi.fn(), sessionUpdate: vi.fn(), replayUpdate: vi.fn(),
  create: vi.fn(), remove: vi.fn(), rows: vi.fn(), sql: vi.fn(), interpret: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => {
  const db = {
    replaySession: { findFirst: mocks.replay, update: mocks.replayUpdate },
    session: { findFirst: mocks.session, update: mocks.sessionUpdate, updateMany: mocks.sessionUpdate },
    progressPulse: { findMany: mocks.rows, createMany: mocks.create, deleteMany: mocks.remove },
    preparation: { findFirst: vi.fn(async () => null) },
    coachThread: { findFirst: vi.fn(async () => ({ id: 'thread', userId: 'owner', title: 'Practice', preparationId: null })) },
    $queryRaw: mocks.sql,
  }
  return { prisma: { ...db, $transaction: (fn: (tx: typeof db) => unknown) => fn(db) } }
})
vi.mock('../src/lib/featureFlags', () => ({
  getEnabledFeatures: async () => ['replay'],
  isFeatureEnabled: async () => true,
}))
vi.mock('../src/coach/service', () => ({ interpretCoachResult: mocks.interpret }))
vi.mock('../src/coach/home', () => ({ loadCoachHome: vi.fn(), markCoachHomeResultSeen: vi.fn() }))

import { getCoachingContext, getProgressPulse, getProgressPulseSummary, recordProgressPulse, skipProgressPulse } from '../src/routes/progress-pulse'
import coachRouter from '../src/routes/coach'
import { buildCoachContext } from '../src/coach/context'
import { legacyInput } from '../src/lib/replay-evidence'
import { eligiblePulseWhere, REPLAY_PULSE_ORIGIN } from '../src/analytics/pulseEligibility'
import { getSmoothedScore, saveSkillScoresToPulse } from '../src/analytics/progressPulse'

const app = express()
app.use(express.json())
app.use((req, _res, next) => {
  req.user = { userId: 'owner', email: 'owner@example.invalid', role: 'USER' }
  next()
})
app.post('/pulse', recordProgressPulse)
app.post('/pulse/skip', skipProgressPulse)
app.get('/pulse', getProgressPulse)
app.get('/pulse/summary', getProgressPulseSummary)
app.get('/context', getCoachingContext)
app.use('/coach', coachRouter)

const segments = [{ speaker: 'Alice', text: 'We have a clear plan for the project.' }]
const input = legacyInput(segments, 'uploaded')
const legacy = () => ({
  id: 'replay', userId: 'owner', status: 'completed', sessionName: 'Meeting',
  createdAt: new Date(), meetingType: 'Review', focusAreas: [], learnerSelection: null,
  result: {
    transcriptText: segments[0].text, structuredTranscript: segments, transcriptionSource: 'uploaded',
    wordsPerMinute: 150, fillerWordRate: 0, longestMonologueSec: 120,
    skillScores: { scores: { pacing: 9, clarity: 8 } },
    coachingInsights: { topStrength: 'You paced well.', primaryImprovement: 'Use 140 WPM.' },
    improvements: [{ point: 'Your pacing', example: 'Old wrong-speaker example' }],
  },
})

describe('shared Replay evidence boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.rows.mockResolvedValue([])
    mocks.sql.mockResolvedValue([])
    mocks.session.mockResolvedValue(null)
    mocks.replay.mockResolvedValue(legacy())
    mocks.interpret.mockResolvedValue({ text: 'Only current evidence.' })
  })

  it.each([
    { source: 'replay', sessionId: 'replay', entries: [{ skill: 'pacing', score: 10 }] },
    { entries: [{ source: 'replay', sessionId: 'replay', skill: 'pacing', score: 10 }] },
    { entries: [{ skill: 'pacing', score: 10 }] },
    { entries: [{ source: 'elevate', sessionId: 'e', skill: 'clarity', score: 8 },
      { source: 'replay', sessionId: 'replay', skill: 'pacing', score: 10 }] },
  ])('rejects legacy Replay writes in every source form', async body => {
    const response = await request(app).post('/pulse').send(body)
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('REPLAY_SERVER_ASSESSMENT_REQUIRED')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('cannot disguise a Replay or another user session as an Elevate write', async () => {
    const response = await request(app).post('/pulse').send({
      source: 'elevate', sessionId: 'replay', entries: [{ skill: 'clarity', score: 8 }],
    })
    expect(response.status).toBe(404)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.session).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'replay', userId: 'owner', discardedAt: null },
    }))
  })

  it('retains owned Elevate write behavior', async () => {
    mocks.session.mockResolvedValue({ module: 'elevate', preparationPractice: null })
    mocks.create.mockResolvedValue({ count: 1 })
    expect((await request(app).post('/pulse').send({
      source: 'elevate', sessionId: 'e', entries: [{ skill: 'clarity', score: 8 }],
    })).status).toBe(201)
    expect(mocks.create.mock.calls[0][0].data[0]).toMatchObject({ userId: 'owner', sessionId: 'e', score: 8 })
  })

  it('rejects a Prepare-owned practice even through the legacy Pulse writer', async () => {
    mocks.session.mockResolvedValue({ module: 'elevate', preparationPractice: { id: 'practice-1' } })

    const response = await request(app).post('/pulse').send({
      source: 'elevate', sessionId: 'practice-session', entries: [{ skill: 'clarity', score: 8 }],
    })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('PREPARE_ACTIVITY_NOT_PULSE_ELIGIBLE')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('removes only owned Replay entries under the same session lock when skipping', async () => {
    expect((await request(app).post('/pulse/skip').send({ source: 'replay', sessionId: 'replay' })).status).toBe(200)
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith({ where: { userId: 'owner', sessionId: 'replay', source: 'replay' } })
    expect(String(mocks.sql.mock.calls[0][0])).toContain('FOR UPDATE')
    mocks.remove.mockClear()
    mocks.replay.mockResolvedValue(null)
    expect((await request(app).post('/pulse/skip').send({ source: 'replay', sessionId: 'foreign' })).status).toBe(404)
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.replay).toHaveBeenLastCalledWith({
      where: { id: 'foreign', userId: 'owner' },
      select: { preparationRecording: { select: { id: true } } },
    })
  })

  it('does not let Prepare-owned activities alter Pulse status or entries', async () => {
    mocks.session.mockResolvedValue({ preparationPractice: { id: 'practice-1' } })
    const response = await request(app).post('/pulse/skip').send({ source: 'elevate', sessionId: 'practice-session' })

    expect(response.status).toBe(400)
    expect(response.body.code).toBe('PREPARE_ACTIVITY_NOT_PULSE_ELIGIBLE')
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(mocks.sessionUpdate).not.toHaveBeenCalled()
  })

  it('filters unverified Replay history in API, Coach context, SQL summary and smoothing', async () => {
    const listed = await request(app).get('/pulse')
    expect(listed.status, JSON.stringify(listed.body)).toBe(200)
    expect(mocks.rows.mock.lastCall?.[0].where.AND).toEqual([eligiblePulseWhere()])
    await request(app).get('/pulse/summary')
    expect(JSON.stringify(mocks.sql.mock.lastCall)).toContain(REPLAY_PULSE_ORIGIN)
    await buildCoachContext('owner')
    expect(mocks.rows.mock.lastCall?.[0].where.AND).toEqual([eligiblePulseWhere()])
    await getSmoothedScore('owner', 'clarity', 8)
    expect(mocks.rows.mock.lastCall?.[0].where.AND).toEqual([eligiblePulseWhere()])
  })

  it('does not expose legacy pace or wrong-speaker advice through either Coach context', async () => {
    const context = await buildCoachContext('owner')
    expect(context.lastReplay).toMatchObject({ wpm: null, fillerRate: null, longestMonologueSec: null })
    const forAgent = await request(app).get('/context?focusArea=pacing')
    expect(forAgent.status).toBe(200)
    expect(forAgent.body.replayInsights.metrics.wordsPerMinute).toBeNull()
    expect(forAgent.body.replayInsights.primaryImprovement).toBeNull()
    expect(forAgent.body.replayInsights.examplePhrases).toEqual([])
  })

  it('uses current safe results when interpreting a Replay session', async () => {
    expect((await request(app).post('/coach/threads/thread/interpret').send({ module: 'replay', sessionId: 'replay' })).status).toBe(200)
    expect(mocks.interpret.mock.calls[0][0].session).toMatchObject({
      wpm: null, skillScores: [], topStrength: null, primaryImprovement: null,
    })

    const row = legacy()
    mocks.replay.mockResolvedValue({
      ...row,
      learnerSelection: { speaker: 'Alice', transcriptRevision: input.transcriptRevision,
        recordingSignature: null, revision: 'selected', provenance: 'user_confirmed' },
      result: { ...row.result, deliveryEvidence: { ...input, analysisSelectionRevision: 'selected' },
        coachingInsights: { topStrength: 'Clear project plan.' } },
    })
    await request(app).post('/coach/threads/thread/interpret').send({ module: 'replay', sessionId: 'replay' })
    expect(mocks.interpret.mock.lastCall?.[0].session).toMatchObject({
      wpm: null, skillScores: [{ skill: 'clarity', score: 8 }], topStrength: 'Clear project plan.',
    })
  })

  it('does not revive unavailable Elevate pace in cross-product Coach context', async () => {
    mocks.session.mockResolvedValue({ id: 'e', focusArea: 'pacing', endedAt: new Date(), durationSec: 30,
      metrics: { userWpm: 150, userFillerRate: 1, processingStatus: { pace: { status: 'insufficient_evidence' } } } })
    expect((await buildCoachContext('owner')).lastElevate?.wpm).toBeNull()
  })

  it('prevents the old internal writer from creating unconfirmed Replay entries', async () => {
    await expect(saveSkillScoresToPulse('owner', 'replay', 'replay', {
      clarity: 8, confidence: 7, conciseness: 6, structure: 5, engagement: 7,
      pacing: null, delivery: null, emotionalControl: null,
    })).rejects.toThrow('confirmed-speaker')
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
