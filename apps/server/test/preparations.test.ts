import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PreparationStageStatus,
  PreparationStageType,
} from '@prisma/client'

const prismaMock = vi.hoisted(() => ({
  preparation: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  preparationStage: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  interviewQuestion: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  stageReflection: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
  },
  interviewPreparation: {
    update: vi.fn(),
  },
  platformFeatureFlag: {
    count: vi.fn(),
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
  },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof prismaMock) => unknown)(prismaMock)
    }
    return Promise.all(arg as unknown[])
  }),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))

import preparationsRouter from '../src/routes/preparations'
import { invalidateFeatureFlagCache, requireFeature } from '../src/lib/featureFlags'
import { parseInterviewQuestions } from '../src/lib/parseInterviewQuestions'
import { buildDefaultStages, deriveStageSummary } from '../src/lib/prepareStages'
import { buildPreparationTimeline } from '../src/lib/prepareTimeline'

const PREPARATION_ID = 'caaaaaaaaaaaaaaaaaaaaaaaa'
const STAGE_A = 'cbbbbbbbbbbbbbbbbbbbbbbbb'
const STAGE_B = 'ccccccccccccccccccccccccc'

const stages = [
  {
    id: STAGE_A,
    preparationId: PREPARATION_ID,
    type: PreparationStageType.APPLIED,
    name: 'Applied',
    sequence: 0,
    status: PreparationStageStatus.SKIPPED,
    scheduledAt: null,
    completedAt: null,
    interviewerName: null,
    interviewerRole: null,
    interviewerProfileText: null,
    reflection: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  },
  {
    id: STAGE_B,
    preparationId: PREPARATION_ID,
    type: PreparationStageType.TECHNICAL,
    name: 'Technical',
    sequence: 1,
    status: PreparationStageStatus.SCHEDULED,
    scheduledAt: new Date('2026-09-10T10:00:00Z'),
    completedAt: null,
    interviewerName: null,
    interviewerRole: null,
    interviewerProfileText: null,
    reflection: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  },
]

const preparation = {
  id: PREPARATION_ID,
  userId: 'user-a',
  type: 'INTERVIEW',
  title: 'Google — Senior Engineering Manager',
  status: 'ACTIVE',
  completedAt: null,
  createdAt: new Date('2026-09-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
  interview: {
    id: 'cdddddddddddddddddddddddd',
    preparationId: PREPARATION_ID,
    companyName: 'Google',
    roleTitle: 'Senior Engineering Manager',
    jobDescriptionText: null,
    interviewDate: new Date('2026-09-10T10:00:00Z'),
    resumeText: null,
    resumeLabel: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  },
  stages,
  questions: [],
}

function appFor(userId = 'user-a', withFeatureGate = false) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { userId, email: `${userId}@example.com`, role: 'USER' }
    next()
  })
  app.use(
    '/api/preparations',
    ...(withFeatureGate ? [requireFeature('prepare')] : []),
    preparationsRouter,
  )
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Prepare stage rules', () => {
  it('marks earlier generated stages skipped when starting at Technical', () => {
    const result = buildDefaultStages(
      PreparationStageType.TECHNICAL,
      new Date('2026-09-10T10:00:00Z'),
    )
    expect(result.find((stage) => stage.type === PreparationStageType.APPLIED)?.status).toBe(
      PreparationStageStatus.SKIPPED,
    )
    expect(result.find((stage) => stage.type === PreparationStageType.RECRUITER)?.status).toBe(
      PreparationStageStatus.SKIPPED,
    )
    expect(result.find((stage) => stage.type === PreparationStageType.TECHNICAL)?.status).toBe(
      PreparationStageStatus.SCHEDULED,
    )
  })

  it('returns last completed and next actionable stage separately', () => {
    const summary = deriveStageSummary([
      { ...stages[0], status: PreparationStageStatus.COMPLETED },
      stages[1],
    ])
    expect(summary.lastCompletedStage?.name).toBe('Applied')
    expect(summary.nextStage?.name).toBe('Technical')
  })
})

describe('Prepare API ownership and validation', () => {
  it('lists only preparations anchored to the authenticated user', async () => {
    prismaMock.preparation.findMany.mockResolvedValue([preparation])
    const response = await request(appFor()).get('/api/preparations')
    expect(response.status).toBe(200)
    expect(prismaMock.preparation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-a' } }),
    )
  })

  it('creates a journey for the authenticated user and ignores no client user identity', async () => {
    prismaMock.preparation.create.mockResolvedValue(preparation)
    const response = await request(appFor())
      .post('/api/preparations')
      .send({
        companyName: 'Google',
        roleTitle: 'Senior Engineering Manager',
        interviewDate: '2026-09-10T10:00:00.000Z',
        currentStageType: 'TECHNICAL',
      })
    expect(response.status).toBe(201)
    expect(prismaMock.preparation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-a',
          title: 'Google — Senior Engineering Manager',
        }),
      }),
    )
  })

  it('rejects protected mass-assignment fields', async () => {
    const response = await request(appFor())
      .post('/api/preparations')
      .send({ companyName: 'Google', roleTitle: 'Manager', userId: 'user-b' })
    expect(response.status).toBe(400)
    expect(prismaMock.preparation.create).not.toHaveBeenCalled()
  })

  it('rejects invalid stage enums', async () => {
    const response = await request(appFor())
      .post('/api/preparations')
      .send({
        companyName: 'Google',
        roleTitle: 'Manager',
        currentStageType: 'UNKNOWN_ROUND',
      })
    expect(response.status).toBe(400)
  })

  it('returns FEATURE_DISABLED when Prepare is hidden', async () => {
    invalidateFeatureFlagCache()
    prismaMock.platformFeatureFlag.count.mockResolvedValue(1)
    prismaMock.platformFeatureFlag.findMany.mockResolvedValue([
      {
        feature: 'prepare',
        hidden: true,
        disabled: false,
        enabled: false,
        overlayComment: null,
        overlayPosition: 'center',
      },
    ])
    const response = await request(appFor('user-a', true)).get('/api/preparations')
    expect(response.status).toBe(403)
    expect(response.body.code).toBe('FEATURE_DISABLED')
    expect(prismaMock.preparation.findMany).not.toHaveBeenCalled()
  })

  it('does not restamp next stage when the journey date did not change', async () => {
    prismaMock.preparation.findFirst.mockResolvedValue(preparation)
    prismaMock.preparation.update.mockResolvedValue(preparation)
    const response = await request(appFor())
      .patch(`/api/preparations/${PREPARATION_ID}`)
      .send({
        jobDescriptionText: 'Updated JD',
        interviewDate: '2026-09-10T10:00:00.000Z',
      })
    expect(response.status).toBe(200)
    const data = prismaMock.preparation.update.mock.calls[0][0].data
    expect(data.stages).toBeUndefined()
    expect(data.interview.update.jobDescriptionText).toBe('Updated JD')
  })

  it('does not reveal another user preparation', async () => {
    prismaMock.preparation.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b')).get(
      `/api/preparations/${PREPARATION_ID}`,
    )
    expect(response.status).toBe(404)
    expect(prismaMock.preparation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PREPARATION_ID, userId: 'user-b' },
      }),
    )
  })

  it('does not let another user update a preparation', async () => {
    prismaMock.preparation.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b'))
      .patch(`/api/preparations/${PREPARATION_ID}`)
      .send({ companyName: 'Stolen' })
    expect(response.status).toBe(404)
    expect(prismaMock.preparation.update).not.toHaveBeenCalled()
  })

  it('does not let another user delete a preparation', async () => {
    prismaMock.preparation.deleteMany.mockResolvedValue({ count: 0 })
    const response = await request(appFor('user-b')).delete(
      `/api/preparations/${PREPARATION_ID}`,
    )
    expect(response.status).toBe(404)
    expect(prismaMock.preparation.deleteMany).toHaveBeenCalledWith({
      where: { id: PREPARATION_ID, userId: 'user-b' },
    })
  })

  it('does not mutate a stage outside the owned parent', async () => {
    prismaMock.preparationStage.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b'))
      .patch(`/api/preparations/${PREPARATION_ID}/stages/${STAGE_A}`)
      .send({ name: 'Changed' })
    expect(response.status).toBe(404)
    expect(prismaMock.preparationStage.update).not.toHaveBeenCalled()
  })

  it('preserves a completed stage status when editing its scheduled date', async () => {
    const completedStage = {
      ...stages[1],
      status: PreparationStageStatus.COMPLETED,
      completedAt: new Date('2026-09-10T11:00:00Z'),
    }
    prismaMock.preparationStage.findFirst.mockResolvedValue(completedStage)
    prismaMock.preparationStage.update.mockResolvedValue(completedStage)
    const response = await request(appFor())
      .patch(`/api/preparations/${PREPARATION_ID}/stages/${STAGE_B}`)
      .send({ scheduledAt: '2026-09-11T10:00:00.000Z' })
    expect(response.status).toBe(200)
    expect(prismaMock.preparationStage.update).toHaveBeenCalledWith({
      where: { id: STAGE_B },
      data: { scheduledAt: new Date('2026-09-11T10:00:00.000Z') },
    })
  })

  it('does not delete a stage outside the owned parent', async () => {
    prismaMock.preparationStage.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b')).delete(
      `/api/preparations/${PREPARATION_ID}/stages/${STAGE_A}`,
    )
    expect(response.status).toBe(404)
    expect(prismaMock.preparationStage.delete).not.toHaveBeenCalled()
  })

  it('rejects a reorder that does not exactly match this journey stages', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: PREPARATION_ID }])
    prismaMock.preparationStage.findMany.mockResolvedValue([
      { id: STAGE_A },
      { id: STAGE_B },
    ])
    const foreignStage = 'ceeeeeeeeeeeeeeeeeeeeeeee'
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/stages/reorder`)
      .send({ stageIds: [STAGE_A, foreignStage] })
    expect(response.status).toBe(400)
    expect(prismaMock.preparationStage.update).not.toHaveBeenCalled()
  })

  it('parks then rewrites sequences so unique (preparationId, sequence) can hold during reorder', async () => {
    prismaMock.preparation.count.mockResolvedValue(1)
    prismaMock.preparationStage.findMany.mockResolvedValue([
      { id: STAGE_A },
      { id: STAGE_B },
    ])
    prismaMock.$queryRaw.mockResolvedValue([{ id: PREPARATION_ID }])
    prismaMock.preparation.findFirst.mockResolvedValue(preparation)
    prismaMock.preparationStage.update.mockResolvedValue({})
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/stages/reorder`)
      .send({ stageIds: [STAGE_B, STAGE_A] })
    expect(response.status).toBe(200)
    const sequences = prismaMock.preparationStage.update.mock.calls.map(
      (call) => (call[0] as { data: { sequence: number } }).data.sequence,
    )
    expect(sequences).toEqual([10_000, 10_001, 0, 1])
  })
})

describe('Prepare question capture', () => {
  it('splits multiline questions, trims bullets, and skips blanks', () => {
    expect(
      parseInterviewQuestions(
        '- Tell me about a time you disagreed\n\n* How would you design a rate limiter?\n3. What surprised you?\n',
      ),
    ).toEqual([
      'Tell me about a time you disagreed',
      'How would you design a rate limiter?',
      'What surprised you?',
    ])
  })

  it('builds a chronological timeline from completions, questions, and reflections', () => {
    const timeline = buildPreparationTimeline(
      [
        {
          ...stages[1],
          status: PreparationStageStatus.COMPLETED,
          completedAt: new Date('2026-09-07T12:00:00Z'),
          reflection: {
            id: 'cfffffffffffffffffffffffff',
            preparationId: PREPARATION_ID,
            stageId: STAGE_B,
            rating: 'GOOD',
            outcome: 'PENDING',
            wentWell: null,
            difficulties: null,
            surprisedBy: 'Underperformer management',
            feedbackReceived: null,
            nextRoundHints: null,
            createdAt: new Date('2026-09-07T12:05:00Z'),
            updatedAt: new Date('2026-09-07T12:05:00Z'),
          },
        },
      ],
      [
        {
          stageId: STAGE_B,
          createdAt: new Date('2026-09-07T12:01:00Z'),
        },
        {
          stageId: STAGE_B,
          createdAt: new Date('2026-09-07T12:02:00Z'),
        },
      ],
    )
    expect(timeline.map((item) => item.kind)).toEqual([
      'stage_completed',
      'questions_added',
      'reflection',
    ])
    expect(timeline[1].questionCount).toBe(2)
  })
})

describe('Prepare log-interview ownership and effects', () => {
  function mockLogInterviewSuccess() {
    prismaMock.$queryRaw.mockResolvedValue([{ id: PREPARATION_ID }])
    prismaMock.preparationStage.findFirst.mockResolvedValue(stages[1])
    prismaMock.interviewQuestion.count.mockResolvedValue(0)
    prismaMock.preparationStage.update.mockResolvedValue({
      ...stages[1],
      status: PreparationStageStatus.COMPLETED,
    })
    prismaMock.stageReflection.upsert.mockResolvedValue({})
    prismaMock.interviewQuestion.createMany.mockResolvedValue({ count: 2 })
    const hiringManager = {
      id: 'ceeeeeeeeeeeeeeeeeeeeeeee',
      preparationId: PREPARATION_ID,
      type: PreparationStageType.HIRING_MANAGER,
      name: 'Hiring Manager',
      sequence: 2,
      status: PreparationStageStatus.UPCOMING,
      scheduledAt: null,
      completedAt: null,
    }
    prismaMock.preparationStage.findMany.mockResolvedValue([...stages, hiringManager])
    prismaMock.interviewPreparation.update.mockResolvedValue({})
    prismaMock.preparation.findFirst.mockResolvedValue({
      ...preparation,
      stages: [
        stages[0],
        {
          ...stages[1],
          status: PreparationStageStatus.COMPLETED,
          completedAt: new Date('2026-09-07T12:00:00Z'),
          reflection: {
            id: 'cfffffffffffffffffffffffff',
            rating: 'GOOD',
            outcome: 'PENDING',
            surprisedBy: 'Underperformer management',
            updatedAt: new Date('2026-09-07T12:05:00Z'),
          },
        },
      ],
      questions: [
        {
          id: 'cgggggggggggggggggggggggg',
          stageId: STAGE_B,
          questionText: 'Design a rate limiter',
          source: 'ACTUAL_INTERVIEW',
          createdAt: new Date('2026-09-07T12:01:00Z'),
        },
      ],
    })
  }

  it('completes the stage, stores questions, and schedules the next incomplete round', async () => {
    mockLogInterviewSuccess()
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/log-interview`)
      .send({
        stageId: STAGE_B,
        rating: 'GOOD',
        outcome: 'PENDING',
        surprisedBy: 'Underperformer management',
        questionsText: '- Design a rate limiter\n- Tell me about a conflict',
        nextStageScheduledAt: '2026-09-20T10:00:00.000Z',
      })
    expect(response.status).toBe(201)
    expect(prismaMock.preparationStage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: STAGE_B },
        data: expect.objectContaining({ status: PreparationStageStatus.COMPLETED }),
      }),
    )
    expect(prismaMock.interviewQuestion.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          preparationId: PREPARATION_ID,
          stageId: STAGE_B,
          questionText: 'Design a rate limiter',
          source: 'ACTUAL_INTERVIEW',
        }),
        expect.objectContaining({
          questionText: 'Tell me about a conflict',
        }),
      ]),
    })
    expect(response.body.preparation.lastCompletedStage.name).toBe('Technical')
    expect(prismaMock.interviewPreparation.update).toHaveBeenCalled()
    const stageUpdates = prismaMock.preparationStage.update.mock.calls.map(
      (call) => call[0] as { where: { id: string }; data: { status?: string } },
    )
    expect(stageUpdates.some((call) => call.where.id === 'ceeeeeeeeeeeeeeeeeeeeeeee')).toBe(
      true,
    )
  })

  it('does not let another user log an interview on this journey', async () => {
    prismaMock.$queryRaw.mockResolvedValue([])
    const response = await request(appFor('user-b'))
      .post(`/api/preparations/${PREPARATION_ID}/log-interview`)
      .send({
        stageId: STAGE_B,
        questionsText: 'Stolen question',
      })
    expect(response.status).toBe(404)
    expect(prismaMock.interviewQuestion.createMany).not.toHaveBeenCalled()
  })

  it('does not attach questions to a stage that is not on this journey', async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ id: PREPARATION_ID }])
    prismaMock.preparationStage.findFirst.mockResolvedValue(null)
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/log-interview`)
      .send({
        stageId: 'ceeeeeeeeeeeeeeeeeeeeeeee',
        questionsText: 'Foreign stage question',
      })
    expect(response.status).toBe(404)
    expect(prismaMock.interviewQuestion.createMany).not.toHaveBeenCalled()
  })

  it('does not let another user read questions', async () => {
    prismaMock.preparation.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b')).get(
      `/api/preparations/${PREPARATION_ID}/questions`,
    )
    expect(response.status).toBe(404)
    expect(prismaMock.interviewQuestion.findMany).not.toHaveBeenCalled()
  })

  it('does not let another user write a reflection', async () => {
    prismaMock.preparationStage.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b'))
      .patch(`/api/preparations/${PREPARATION_ID}/stages/${STAGE_B}/reflection`)
      .send({ surprisedBy: 'secret' })
    expect(response.status).toBe(404)
    expect(prismaMock.stageReflection.upsert).not.toHaveBeenCalled()
  })

  it('does not let another user add a question', async () => {
    prismaMock.preparation.findFirst.mockResolvedValue(null)
    const response = await request(appFor('user-b'))
      .post(`/api/preparations/${PREPARATION_ID}/questions`)
      .send({ questionText: 'Stolen' })
    expect(response.status).toBe(404)
    expect(prismaMock.interviewQuestion.create).not.toHaveBeenCalled()
  })

  it('does not overwrite an existing reflection when only questions are logged', async () => {
    mockLogInterviewSuccess()
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/log-interview`)
      .send({
        stageId: STAGE_B,
        questionsText: 'How would you handle a missed deadline?',
      })
    expect(response.status).toBe(201)
    expect(prismaMock.stageReflection.upsert).not.toHaveBeenCalled()
    expect(prismaMock.interviewQuestion.createMany).toHaveBeenCalled()
  })

  it('patches only provided reflection fields on re-log', async () => {
    mockLogInterviewSuccess()
    const response = await request(appFor())
      .post(`/api/preparations/${PREPARATION_ID}/log-interview`)
      .send({
        stageId: STAGE_B,
        surprisedBy: 'They asked about org design instead',
      })
    expect(response.status).toBe(201)
    expect(prismaMock.stageReflection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { surprisedBy: 'They asked about org design instead' },
      }),
    )
  })

  it('rejects marking a stage completed without logging the interview', async () => {
    const response = await request(appFor())
      .patch(`/api/preparations/${PREPARATION_ID}/stages/${STAGE_B}`)
      .send({ status: 'COMPLETED' })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/Log the interview/i)
    expect(prismaMock.preparationStage.update).not.toHaveBeenCalled()
  })
})
