import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueSessionDeletion: vi.fn(),
  deleteRecordingArtifact: vi.fn(),
  awardSessionActivePoints: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sessionRecording: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    progressPulse: { deleteMany: vi.fn() },
    sessionTranscript: { findUnique: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/sessionDeletionWorker', () => ({
  enqueueSessionDeletion: mocks.enqueueSessionDeletion,
}))
vi.mock('../src/lib/sessionStorageCleanup', () => ({
  deleteRecordingArtifact: mocks.deleteRecordingArtifact,
}))
vi.mock('../src/lib/points', () => ({
  awardSessionActivePoints: mocks.awardSessionActivePoints,
}))

import { getConversationForAgent } from '../src/routes/conversations'
import { discardedSessionGuard } from '../src/lib/sessionDiscard'
import { deleteSession, endSession, saveRecording } from '../src/routes/sessions'
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
    mocks.prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(mocks.prisma),
    )
    mocks.prisma.session.update.mockResolvedValue({})
    mocks.prisma.sessionRecording.findUnique.mockResolvedValue(null)
    mocks.prisma.sessionRecording.create.mockResolvedValue({})
    mocks.prisma.sessionRecording.update.mockResolvedValue({})
    mocks.prisma.progressPulse.deleteMany.mockResolvedValue({ count: 0 })
    mocks.deleteRecordingArtifact.mockResolvedValue(undefined)
    mocks.awardSessionActivePoints.mockResolvedValue({ awarded: 0, total: 0 })
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

  it('keeps a successful tombstone accepted when immediate Pulse cleanup fails', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-pulse-failure',
      userId: 'user-1',
      discardedAt: null,
    })
    mocks.prisma.progressPulse.deleteMany.mockRejectedValue(new Error('pulse unavailable'))
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-pulse-failure' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(res.statusCode).toBe(202)
    expect(mocks.enqueueSessionDeletion).toHaveBeenCalledWith('session-pulse-failure')
  })

  it('does not return 202 or enqueue when the tombstone write fails', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-tombstone-failure',
      userId: 'user-1',
      discardedAt: null,
    })
    mocks.prisma.$transaction.mockRejectedValue(
      Object.assign(new Error('column unavailable'), { code: 'P2022' }),
    )
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-tombstone-failure' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(res.statusCode).toBe(500)
    expect(mocks.enqueueSessionDeletion).not.toHaveBeenCalled()
  })

  it('lets an authenticated late Egress callback compensate its exact artifact', async () => {
    process.env.INTERNAL_AGENT_TOKEN = 'test-agent-token'
    mocks.prisma.$queryRaw.mockResolvedValue([{ discardedAt: new Date() }])
    const req = {
      params: { sessionId: 'session-late-egress' },
      body: {
        egress_id: 'EG_late',
        file_path: 's3://recordings/session-late-egress.mp4',
        status: 'completed',
        recording_type: 'room_composite',
      },
      header: (name: string) =>
        name.toLowerCase() === 'x-internal-agent-token' ? 'test-agent-token' : undefined,
    } as any
    const guardRes = response()
    const next = vi.fn()

    await discardedSessionGuard(
      { ...req, method: 'POST', path: '/sessions/session-late-egress/recording' },
      guardRes,
      next,
    )
    expect(next).toHaveBeenCalled()

    const res = response()
    await saveRecording(req, res)

    expect(mocks.prisma.sessionRecording.create).toHaveBeenCalled()
    expect(mocks.deleteRecordingArtifact).toHaveBeenCalledWith(
      's3://recordings/session-late-egress.mp4',
    )
    expect(mocks.enqueueSessionDeletion).toHaveBeenCalledWith('session-late-egress')
    expect(res.statusCode).toBe(410)
  })

  it('rejects a discarded callback whose egressId belongs to another session', async () => {
    process.env.INTERNAL_AGENT_TOKEN = 'test-agent-token'
    mocks.prisma.$queryRaw.mockResolvedValue([{ discardedAt: new Date() }])
    mocks.prisma.sessionRecording.findUnique.mockResolvedValue({
      egressId: 'EG_foreign',
      sessionId: 'session-other',
      filePath: 's3://recordings/other.mp4',
    })
    const res = response()

    await saveRecording(
      {
        params: { sessionId: 'session-late-egress' },
        body: {
          egress_id: 'EG_foreign',
          file_path: 's3://recordings/session-late-egress.mp4',
          status: 'completed',
          recording_type: 'room_composite',
        },
        header: (name: string) =>
          name.toLowerCase() === 'x-internal-agent-token' ? 'test-agent-token' : undefined,
      } as any,
      res,
    )

    expect(res.statusCode).toBe(409)
    expect(mocks.prisma.sessionRecording.update).not.toHaveBeenCalled()
    expect(mocks.prisma.sessionRecording.create).not.toHaveBeenCalled()
    expect(mocks.deleteRecordingArtifact).not.toHaveBeenCalled()
    expect(mocks.enqueueSessionDeletion).not.toHaveBeenCalled()
  })

  it('returns 410 and awards no points when discard wins the end-session lock', async () => {
    mocks.prisma.$queryRaw.mockResolvedValue([{ discardedAt: new Date() }])
    const res = response()

    await endSession(
      {
        params: { id: 'session-ending-race' },
        body: { endedAt: new Date().toISOString() },
      } as any,
      res,
    )

    expect(res.statusCode).toBe(410)
    expect(mocks.awardSessionActivePoints).not.toHaveBeenCalled()
    expect(mocks.prisma.session.update).not.toHaveBeenCalled()
  })
})
