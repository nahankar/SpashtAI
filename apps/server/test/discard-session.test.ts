import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueSessionDeletion: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    progressPulse: { deleteMany: vi.fn() },
    sessionTranscript: { findUnique: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/sessionDeletionWorker', () => ({
  enqueueSessionDeletion: mocks.enqueueSessionDeletion,
}))

import { getConversationForAgent } from '../src/routes/conversations'
import { discardedSessionGuard } from '../src/lib/sessionDiscard'
import { deleteSession } from '../src/routes/sessions'
import { getLivekitToken } from '../src/routes/livekit'

function response() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn((code: number) => {
      res.statusCode = code
      return res
    }),
    json: vi.fn((body: unknown) => {
      res.body = body
      return res
    }),
  }
  return res
}

describe('discarded Elevate session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.INTERNAL_AGENT_TOKEN
    mocks.prisma.$transaction.mockResolvedValue([])
    mocks.prisma.session.update.mockResolvedValue({})
    mocks.prisma.progressPulse.deleteMany.mockResolvedValue({ count: 0 })
  })

  it('reports a deleted session as missing to the agent', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue(null)
    mocks.prisma.sessionTranscript.findUnique.mockResolvedValue(null)
    const res = response()

    await getConversationForAgent(
      {
        params: { sessionId: 'session-gone' },
        header: () => 'dev-internal-agent-token',
      } as any,
      res,
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      sessionId: 'session-gone',
      exists: false,
      ended: false,
      discarding: false,
      messages: [],
    })
  })

  it('tells the agent when an existing session is being discarded', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      endedAt: null,
      discardedAt: new Date(),
    })
    mocks.prisma.sessionTranscript.findUnique.mockResolvedValue(null)
    const res = response()

    await getConversationForAgent(
      {
        params: { sessionId: 'session-discarding' },
        header: () => 'dev-internal-agent-token',
      } as any,
      res,
    )

    expect(res.body).toMatchObject({
      exists: true,
      ended: false,
      discarding: true,
    })
  })

  it('returns 410 for delayed reads and writes to a tombstoned session', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      discardedAt: new Date(),
      deletionStatus: 'failed',
    })
    const res = response()
    const next = vi.fn()

    await discardedSessionGuard(
      {
        method: 'POST',
        path: '/internal/sessions/session-discarding/turns',
      } as any,
      res,
      next,
    )

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(410)
    expect(res.body).toEqual({
      error: 'Session discarded',
      deletionStatus: 'failed',
    })
  })

  it('blocks new LiveKit tokens for tombstoned sessions', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      discardedAt: new Date(),
    })
    const res = response()

    await getLivekitToken(
      {
        query: {
          identity: 'user-1',
          room: 'room-1',
          sessionId: 'session-discarding',
        },
      } as any,
      res,
    )

    expect(res.statusCode).toBe(410)
    expect(res.body).toEqual({ error: 'Session discarded' })
  })

  it('persists a terminal tombstone and queues cleanup', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      discardedAt: null,
    })
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-1' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(mocks.prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({
          discardedAt: expect.any(Date),
          deletionStatus: 'pending',
        }),
      }),
    )
    expect(mocks.enqueueSessionDeletion).toHaveBeenCalledWith('session-1')
    expect(res.statusCode).toBe(202)
    expect(res.body).toMatchObject({ success: true, deletionStatus: 'pending' })
  })

  it('makes repeated discard idempotently retry cleanup', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-2',
      userId: 'user-1',
      discardedAt: new Date(),
    })
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-2' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(mocks.prisma.session.update).toHaveBeenCalledWith({
      where: { id: 'session-2' },
      data: {
        deletionStatus: 'pending',
        nextDeletionAttemptAt: expect.any(Date),
      },
    })
    expect(mocks.enqueueSessionDeletion).toHaveBeenCalledWith('session-2')
    expect(res.statusCode).toBe(202)
  })
})
