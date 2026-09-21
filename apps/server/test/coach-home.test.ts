import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  session: { findMany: vi.fn(), findFirst: vi.fn() },
  replaySession: { findMany: vi.fn(), findFirst: vi.fn() },
  coachThread: { findMany: vi.fn() },
  preparation: { findMany: vi.fn() },
  progressPulse: { findMany: vi.fn() },
  coachAction: { findFirst: vi.fn() },
  coachTurn: { findFirst: vi.fn() },
  coachHomeResultReceipt: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}))

const featureFlagsMock = vi.hoisted(() => ({
  getEnabledFeatures: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/lib/featureFlags', () => featureFlagsMock)

import {
  hasReadyElevateResult,
  loadCoachHome,
  markCoachHomeResultSeen,
  pulseCandidatesFromRows,
  selectCoachHomeRecommendation,
  type CoachHomeCandidates,
} from '../src/coach/home'

const emptyCandidates = (): CoachHomeCandidates => ({
  results: [],
  liveSessions: [],
  resumes: [],
  preparations: [],
  pulse: [],
})

describe('Coach Home recommendation selection', () => {
  it('uses the deterministic priority order', () => {
    const candidates = emptyCandidates()
    candidates.results.push({
      kind: 'result',
      module: 'replay',
      targetId: 'replay-1',
      threadId: null,
      title: 'Replay ready',
      reason: 'Pitch · 7.9/10',
      insight: null,
      completedAt: '2026-09-19T10:00:00.000Z',
    })
    candidates.resumes.push({
      kind: 'resume',
      threadId: 'thread-1',
      title: 'VC pitch',
      question: 'Who is the audience?',
      updatedAt: '2026-09-19T11:00:00.000Z',
    })
    candidates.preparations.push({
      kind: 'prepare',
      threadId: null,
      preparationId: 'prep-1',
      stageId: 'stage-1',
      stageName: 'HR',
      goalTitle: 'Google HR preparation',
      title: 'Practise for HR',
      reason: 'Google · HR next',
      scenario: 'Prepare for HR.',
      scheduledAt: '2026-09-20T10:00:00.000Z',
    })

    expect(selectCoachHomeRecommendation(candidates).kind).toBe('result')
    candidates.results = []
    expect(selectCoachHomeRecommendation(candidates).kind).toBe('resume')
    candidates.resumes = []
    expect(selectCoachHomeRecommendation(candidates).kind).toBe('prepare')
  })

  it('chooses the weakest evidence-backed Pulse opportunity', () => {
    const candidates = emptyCandidates()
    candidates.pulse = [
      {
        kind: 'pulse',
        threadId: null,
        skill: 'clarity',
        score: 6.4,
        sessions: 4,
        practiceAvailable: true,
        goalTitle: 'Improve Clarity',
        title: 'Strengthen clarity',
        reason: '4 tracked sessions',
      },
      {
        kind: 'pulse',
        threadId: null,
        skill: 'pacing',
        score: 5.8,
        sessions: 2,
        practiceAvailable: true,
        goalTitle: 'Improve Pacing',
        title: 'Strengthen pacing',
        reason: '2 tracked sessions',
      },
    ]

    const selected = selectCoachHomeRecommendation(candidates)
    expect(selected.kind).toBe('pulse')
    if (selected.kind === 'pulse') expect(selected.skill).toBe('pacing')
  })

  it('places an active interrupted session ahead of an old Coach question', () => {
    const candidates = emptyCandidates()
    candidates.liveSessions.push({
      kind: 'live-resume',
      module: 'elevate',
      targetId: 'session-live',
      threadId: 'thread-live',
      title: 'Resume your Elevate session',
      reason: 'Confidence practice is still in progress',
      startedAt: '2026-09-19T11:00:00.000Z',
    })
    candidates.resumes.push({
      kind: 'resume',
      threadId: 'thread-question',
      title: 'VC pitch',
      question: 'Who is the audience?',
      updatedAt: '2026-09-19T11:30:00.000Z',
    })

    expect(selectCoachHomeRecommendation(candidates).kind).toBe('live-resume')
  })

  it('falls back to conversational onboarding without state', () => {
    expect(selectCoachHomeRecommendation(emptyCandidates())).toEqual({
      kind: 'onboarding',
      title: 'What would you like to get better at—or prepare for?',
      reason: 'Tell Coach what matters right now. It will recommend the best next step.',
    })
  })

  it('requires two distinct tracked sessions before using Pulse', () => {
    expect(
      pulseCandidatesFromRows([
        { skill: 'clarity', score: 5.8, sessionId: 'session-1' },
        { skill: 'clarity', score: 5.6, sessionId: 'session-1' },
      ]),
    ).toEqual([])

    const candidates = pulseCandidatesFromRows([
      { skill: 'clarity', score: 5.8, sessionId: 'session-2' },
      { skill: 'clarity', score: 6.1, sessionId: 'session-1' },
    ])
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({
      skill: 'clarity',
      score: 5.8,
      sessions: 2,
    })
  })
})

describe('Coach Home result visibility', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.coachHomeResultReceipt.upsert.mockResolvedValue({})
  })

  it('marks only an owned completed Elevate result as seen', async () => {
    prismaMock.session.findFirst.mockResolvedValue({ id: 'session-1' })
    await expect(markCoachHomeResultSeen('user-a', 'elevate', 'session-1')).resolves.toBe(true)
    expect(prismaMock.session.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'session-1',
        userId: 'user-a',
        module: 'elevate',
        endedAt: { not: null },
        discardedAt: null,
      },
      select: { id: true },
    })
    expect(prismaMock.coachHomeResultReceipt.upsert).toHaveBeenCalledWith({
      where: {
        userId_module_targetId: {
          userId: 'user-a',
          module: 'elevate',
          targetId: 'session-1',
        },
      },
      create: { userId: 'user-a', module: 'elevate', targetId: 'session-1' },
      update: { seenAt: expect.any(Date) },
    })
  })

  it('does not acknowledge another user result', async () => {
    prismaMock.replaySession.findFirst.mockResolvedValue(null)
    await expect(markCoachHomeResultSeen('user-b', 'replay', 'replay-1')).resolves.toBe(false)
    expect(prismaMock.replaySession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'replay-1', userId: 'user-b' }),
      }),
    )
    expect(prismaMock.coachHomeResultReceipt.upsert).not.toHaveBeenCalled()
  })
})

describe('Coach Home data loading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureFlagsMock.getEnabledFeatures.mockResolvedValue(['elevate', 'replay'])
    prismaMock.session.findMany.mockResolvedValue([])
    prismaMock.replaySession.findMany.mockResolvedValue([])
    prismaMock.coachThread.findMany.mockResolvedValue([])
    prismaMock.preparation.findMany.mockResolvedValue([])
    prismaMock.progressPulse.findMany.mockResolvedValue([])
    prismaMock.coachHomeResultReceipt.findMany.mockResolvedValue([])
    prismaMock.coachAction.findFirst.mockResolvedValue(null)
    prismaMock.coachTurn.findFirst.mockResolvedValue(null)
  })

  it('uses Replay evidence for Pulse even when Elevate is disabled', async () => {
    featureFlagsMock.getEnabledFeatures.mockResolvedValue(['replay'])
    prismaMock.progressPulse.findMany.mockResolvedValue([
      {
        skill: 'clarity',
        score: 5.8,
        sessionId: 'replay-2',
        recordedAt: new Date('2026-09-19T11:00:00.000Z'),
      },
      {
        skill: 'clarity',
        score: 6.1,
        sessionId: 'replay-1',
        recordedAt: new Date('2026-09-18T11:00:00.000Z'),
      },
    ])
    prismaMock.coachThread.findMany.mockResolvedValue([
      {
        id: 'clarity-goal',
        title: 'Improve Clarity',
        focusArea: 'clarity',
        updatedAt: new Date('2026-09-19T10:00:00.000Z'),
        turns: [],
      },
    ])

    const result = await loadCoachHome('user-a')

    expect(prismaMock.progressPulse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: { in: ['replay'] } }),
      }),
    )
    expect(result.recommendation).toMatchObject({
      kind: 'pulse',
      skill: 'clarity',
      score: 5.8,
      practiceAvailable: false,
      threadId: 'clarity-goal',
    })
  })

  it('requires real Elevate skill scores and excludes acknowledged results', async () => {
    expect(
      hasReadyElevateResult(
        { scores: { clarity: 7.2 } },
        { primaryImprovement: 'Slow down' },
      ),
    ).toBe(true)
    expect(
      hasReadyElevateResult(
        { scores: { clarity: 7.2 } },
        { error: 'analysis failed' },
      ),
    ).toBe(false)
    prismaMock.session.findMany
      .mockResolvedValueOnce([
        {
          id: 'not-ready',
          sessionName: 'Incomplete analysis',
          focusArea: 'clarity',
          endedAt: new Date('2026-09-19T10:00:00.000Z'),
          metrics: { coachingInsights: { error: 'failed' }, skillScores: null },
        },
        {
          id: 'ready',
          sessionName: 'Pitch',
          focusArea: 'clarity',
          endedAt: new Date('2026-09-19T09:00:00.000Z'),
          metrics: {
            coachingInsights: { summary: 'Clear opening' },
            skillScores: { scores: { clarity: 7.2 } },
          },
        },
      ])
      .mockResolvedValueOnce([])
    prismaMock.coachHomeResultReceipt.findMany.mockResolvedValue([
      { module: 'elevate', targetId: 'ready' },
    ])

    await expect(loadCoachHome('user-a')).resolves.toEqual({
      recommendation: expect.objectContaining({ kind: 'onboarding' }),
    })
    expect(prismaMock.coachHomeResultReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ module: 'elevate', targetId: 'ready' }],
        }),
      }),
    )
  })

  it('filters Replay results by result creation time, not session updates', async () => {
    featureFlagsMock.getEnabledFeatures.mockResolvedValue(['replay'])

    await loadCoachHome('user-a')

    expect(prismaMock.replaySession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          result: { is: { createdAt: { gte: expect.any(Date) } } },
        }),
      }),
    )
  })
})
