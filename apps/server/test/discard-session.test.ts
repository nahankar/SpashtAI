import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteRoom: vi.fn(),
  listEgress: vi.fn(),
  deleteObject: vi.fn(),
  prisma: {
    session: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    progressPulse: { deleteMany: vi.fn() },
    sessionRecording: { findMany: vi.fn() },
    sessionTranscript: { findUnique: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    deleteRoom = mocks.deleteRoom
  },
  EgressClient: class {
    listEgress = mocks.listEgress
    stopEgress = vi.fn()
  },
}))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = mocks.deleteObject
  },
  DeleteObjectCommand: class {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  },
}))

import { getConversationForAgent } from '../src/routes/conversations'
import { clearSessionDiscarding, markSessionDiscarding } from '../src/lib/sessionDiscard'
import { deleteSession } from '../src/routes/sessions'

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
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    process.env.LIVEKIT_API_KEY = 'devkey'
    process.env.LIVEKIT_API_SECRET = 'devsecret'
    delete process.env.INTERNAL_AGENT_TOKEN
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
    mocks.prisma.session.findUnique.mockResolvedValue({ endedAt: null })
    mocks.prisma.sessionTranscript.findUnique.mockResolvedValue(null)
    markSessionDiscarding('session-discarding')
    const res = response()

    try {
      await getConversationForAgent(
        {
          params: { sessionId: 'session-discarding' },
          header: () => 'dev-internal-agent-token',
        } as any,
        res,
      )
    } finally {
      clearSessionDiscarding('session-discarding')
    }

    expect(res.body).toMatchObject({
      exists: true,
      ended: false,
      discarding: true,
    })
  })

  it('disconnects active LiveKit rooms before deleting the session row', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      segments: [{ roomName: 'room-active' }],
      recordings: [{ filePath: 's3://recordings/session-1.webm' }],
    })
    mocks.deleteRoom.mockResolvedValue(undefined)
    mocks.listEgress.mockResolvedValue([])
    mocks.deleteObject.mockResolvedValue({})
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      { filePath: 's3://recordings/session-1.webm' },
    ])
    mocks.prisma.progressPulse.deleteMany.mockResolvedValue({ count: 0 })
    mocks.prisma.session.delete.mockResolvedValue({ id: 'session-1' })
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-1' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(mocks.deleteRoom).toHaveBeenCalledWith('room-active')
    expect(mocks.deleteObject).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { Bucket: 'recordings', Key: 'session-1.webm' },
      }),
    )
    expect(mocks.prisma.session.delete).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    })
    expect(mocks.deleteRoom.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.session.delete.mock.invocationCallOrder[0],
    )
    expect(res.body).toMatchObject({ success: true })
  })

  it('keeps the database tombstone when object deletion fails', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-2',
      userId: 'user-1',
      segments: [],
      recordings: [{ filePath: 's3://recordings/session-2.webm' }],
    })
    mocks.listEgress.mockResolvedValue([])
    mocks.prisma.sessionRecording.findMany.mockResolvedValue([
      { filePath: 's3://recordings/session-2.webm' },
    ])
    mocks.deleteObject.mockRejectedValue(new Error('S3 unavailable'))
    const res = response()

    await deleteSession(
      {
        params: { id: 'session-2' },
        user: { userId: 'user-1', role: 'user' },
      } as any,
      res,
    )

    expect(mocks.prisma.session.delete).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(500)
  })
})
