import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteRoom: vi.fn(),
  prisma: {
    session: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    progressPulse: { deleteMany: vi.fn() },
    sessionTranscript: { findUnique: vi.fn() },
  },
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    deleteRoom = mocks.deleteRoom
  },
}))

import { getConversationForAgent } from '../src/routes/conversations'
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
      messages: [],
    })
  })

  it('disconnects active LiveKit rooms before deleting the session row', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      segments: [{ roomName: 'room-active' }],
    })
    mocks.deleteRoom.mockResolvedValue(undefined)
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
    expect(mocks.prisma.session.delete).toHaveBeenCalledWith({
      where: { id: 'session-1' },
    })
    expect(mocks.deleteRoom.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.prisma.session.delete.mock.invocationCallOrder[0],
    )
    expect(res.body).toMatchObject({ success: true })
  })
})
