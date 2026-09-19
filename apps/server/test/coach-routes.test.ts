import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoredTurn = {
  id: string
  threadId: string
  role: string
  kind: string | null
  text: string | null
  payload: unknown
  createdAt: Date
}

const state = vi.hoisted(() => ({
  turns: new Map<string, StoredTurn>(),
}))

const prismaMock = vi.hoisted(() => ({
  coachThread: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  coachTurn: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  },
  coachAction: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}))

const serviceMock = vi.hoisted(() => ({
  generateCoachResponse: vi.fn(),
  interpretCoachResult: vi.fn(),
}))
const homeMock = vi.hoisted(() => ({
  loadCoachHome: vi.fn(),
  markCoachHomeResultSeen: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/coach/service', () => serviceMock)
vi.mock('../src/coach/home', () => homeMock)

import coachRouter from '../src/routes/coach'

const thread = {
  id: 'thread-a',
  userId: 'user-a',
  title: null,
  status: 'active',
  preparationId: null,
  createdAt: new Date('2026-09-19T00:00:00Z'),
  updatedAt: new Date('2026-09-19T00:00:00Z'),
}

function appFor(userId: string) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { userId, email: `${userId}@example.com`, role: 'USER' }
    next()
  })
  app.use('/api/coach', coachRouter)
  return app
}

function turn(id: string, payload: Record<string, unknown> = {}) {
  return {
    id,
    role: 'coach',
    kind: 'clarify',
    text: 'What outcome matters?',
    payload,
    createdAt: '2026-09-19T01:00:00.000Z',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.turns.clear()
  prismaMock.coachThread.findFirst.mockImplementation(
    async ({ where }: { where: { id: string; userId: string } }) =>
      where.id === thread.id && where.userId === thread.userId ? thread : null,
  )
  prismaMock.coachThread.update.mockResolvedValue(thread)
  prismaMock.coachAction.findMany.mockResolvedValue([])
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock),
  )
  prismaMock.coachTurn.findMany.mockImplementation(
    async ({
      where,
      orderBy,
    }: {
      where: { threadId: string; id?: { in: string[] } }
      orderBy?: { createdAt: 'asc' | 'desc' }
    }) => {
      const ids = where.id?.in
      return [...state.turns.values()]
        .filter((item) => item.threadId === where.threadId && (!ids || ids.includes(item.id)))
        .sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        )
    },
  )
  prismaMock.coachTurn.createMany.mockImplementation(
    async ({ data }: { data: StoredTurn[] }) => {
      for (const item of data) {
        if (!state.turns.has(item.id)) state.turns.set(item.id, item)
      }
      return { count: data.length }
    },
  )
  prismaMock.coachTurn.update.mockImplementation(
    async ({ where, data }: { where: { id: string }; data: Partial<StoredTurn> }) => {
      const current = state.turns.get(where.id)!
      const updated = { ...current, ...data }
      state.turns.set(where.id, updated)
      return updated
    },
  )
})

describe('Coach turn synchronization', () => {
  it('unions stale snapshots and never reverses completed interaction state', async () => {
    const first = await request(appFor('user-a'))
      .put('/api/coach/threads/thread-a/turns')
      .send({ turns: [turn('clarify-1', { answered: true })] })
    expect(first.status).toBe(200)

    const stale = await request(appFor('user-a'))
      .put('/api/coach/threads/thread-a/turns')
      .send({
        turns: [
          turn('clarify-1', { answered: false }),
          { ...turn('recommend-1'), kind: 'recommend' },
        ],
      })

    expect(stale.status).toBe(200)
    expect(stale.body.turns.map((item: StoredTurn) => item.id)).toEqual([
      'clarify-1',
      'recommend-1',
    ])
    expect(stale.body.turns[0].payload.answered).toBe(true)
    expect(prismaMock.coachTurn.deleteMany).not.toHaveBeenCalled()
  })

  it('keeps both turns when independent saves overlap', async () => {
    const app = appFor('user-a')
    const [first, second] = await Promise.all([
      request(app)
        .put('/api/coach/threads/thread-a/turns')
        .send({ turns: [turn('overlap-a')] }),
      request(app)
        .put('/api/coach/threads/thread-a/turns')
        .send({ turns: [turn('overlap-b')] }),
    ])

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect([...state.turns.keys()].sort()).toEqual(['overlap-a', 'overlap-b'])
  })
})

describe('Coach route ownership', () => {
  it('loads Home for the authenticated user without selecting a thread', async () => {
    homeMock.loadCoachHome.mockResolvedValue({
      recommendation: {
        kind: 'onboarding',
        title: 'What are you preparing for?',
        reason: 'Tell Coach the outcome and timing.',
      },
    })
    const response = await request(appFor('user-a')).get('/api/coach/home')

    expect(response.status).toBe(200)
    expect(homeMock.loadCoachHome).toHaveBeenCalledWith('user-a')
    expect(prismaMock.coachThread.findFirst).not.toHaveBeenCalled()
  })

  it('scopes result visibility updates to the authenticated user', async () => {
    homeMock.markCoachHomeResultSeen.mockResolvedValue(false)
    const response = await request(appFor('user-b')).post(
      '/api/coach/home/results/replay/replay-1/seen',
    )

    expect(response.status).toBe(404)
    expect(homeMock.markCoachHomeResultSeen).toHaveBeenCalledWith(
      'user-b',
      'replay',
      'replay-1',
    )
  })

  it('does not expose another user thread', async () => {
    const response = await request(appFor('user-b')).get('/api/coach/threads/thread-a')
    expect(response.status).toBe(404)
    expect(prismaMock.coachTurn.findMany).not.toHaveBeenCalled()
  })

  it('does not let another user save turns or invoke Coach on the thread', async () => {
    const save = await request(appFor('user-b'))
      .put('/api/coach/threads/thread-a/turns')
      .send({ turns: [turn('foreign-turn')] })
    const respond = await request(appFor('user-b'))
      .post('/api/coach/threads/thread-a/respond')
      .send({ message: 'Show me the private goal' })

    expect(save.status).toBe(404)
    expect(respond.status).toBe(404)
    expect(prismaMock.coachTurn.createMany).not.toHaveBeenCalled()
    expect(serviceMock.generateCoachResponse).not.toHaveBeenCalled()
  })
})
