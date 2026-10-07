import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  listRooms: vi.fn(),
  updateRoomMetadata: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  segment: vi.fn(),
  tokenOptions: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    voiceConfig: { findFirst: mocks.findFirst },
    session: { findUnique: mocks.findUnique },
    sessionSegment: { findUnique: mocks.segment },
  },
}))

vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
    constructor(_key: string, _secret: string, options: unknown) { mocks.tokenOptions(options) }
    addGrant() { return this }
    async toJwt() { return 'test-token' }
  },
  RoomServiceClient: class {
    createRoom = mocks.createRoom
    listRooms = mocks.listRooms
    updateRoomMetadata = mocks.updateRoomMetadata
  },
  AgentDispatchClient: class {},
}))

import { getLivekitToken } from '../src/routes/livekit'

let currentRoom = ''
function tokenRequest(room: string) {
  currentRoom = room
  return { user: { userId: 'u1' }, query: { identity: 'forged', room, sessionId: 's1', segmentId: 'seg1' } } as any
}
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

const enabledPipelineBedrock = {
  backend: 'pipeline-bedrock',
  voiceName: 'Ruth',
  sttProvider: 'transcribe',
  ttsProvider: 'polly',
  pipelineStt: null,
  pipelineLlm: 'amazon.nova-lite-v1:0',
  pipelineTts: null,
  sttBaseUrl: null,
  llmBaseUrl: null,
  ttsBaseUrl: null,
  hushEnabled: true,
}

describe('LiveKit room Hush metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    delete process.env.LIVEKIT_MANUAL_DISPATCH
    mocks.findFirst.mockResolvedValue(enabledPipelineBedrock)
    mocks.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', endedAt: null, discardedAt: null,
      focusArea: 'clarity', focusContext: 'saved context', sessionName: 'saved name', user: { firstName: 'Learner', email: 'learner@example.com' } })
    mocks.segment.mockImplementation(async () => ({ sessionId: 's1', roomName: currentRoom, endedAt: null }))
  })

  it('uses persisted context and authenticated identity when creating a room', async () => {
    mocks.listRooms.mockResolvedValue([])
    mocks.createRoom.mockImplementation(async (options) => ({ metadata: options.metadata }))
    const req = tokenRequest('new-room')
    req.query.focusContext = 'forged context'
    req.query.userName = 'forged name'
    const res = response()
    await getLivekitToken(req, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(mocks.createRoom.mock.calls[0][0].metadata)).toMatchObject({
      userName: 'Learner', focusContext: 'saved context', sessionId: 's1', segmentId: 'seg1',
    })
    expect(mocks.tokenOptions).toHaveBeenCalledWith({ identity: 'user_u1' })
  })

  it('omits empty saved fields instead of sending null to the agent', async () => {
    mocks.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', endedAt: null, discardedAt: null,
      focusArea: null, focusContext: null, sessionName: null, user: { firstName: 'Learner', email: 'learner@example.com' } })
    mocks.listRooms.mockResolvedValue([])
    mocks.createRoom.mockImplementation(async (options) => ({ metadata: options.metadata }))
    const res = response()
    await getLivekitToken(tokenRequest('empty-room'), res)
    expect(res.statusCode).toBe(200)
    const metadata = JSON.parse(mocks.createRoom.mock.calls[0][0].metadata)
    for (const key of ['focusArea', 'focusContext', 'sessionName']) {
      expect(metadata).not.toHaveProperty(key)
    }
  })

  it('keeps the Hush decision from an existing room on token refresh', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ sessionId: 's1', segmentId: 'seg1', hushEnabled: false }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    const res = response()
    await getLivekitToken(tokenRequest('active-room'), res)

    expect(res.statusCode).toBe(200)
    expect(mocks.updateRoomMetadata).toHaveBeenCalledOnce()
    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).toMatchObject({ hushEnabled: false })
  })

  it('preserves a legacy truthy room value instead of changing an active session', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ sessionId: 's1', segmentId: 'seg1', hushEnabled: 'true' }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    await getLivekitToken(tokenRequest('legacy-enabled-room'), response())

    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).toMatchObject({ hushEnabled: true })
  })

  it('does not add a Hush setting to an existing pre-feature room', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ sessionId: 's1', segmentId: 'seg1', voiceBackend: 'pipeline-bedrock' }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    await getLivekitToken(tokenRequest('legacy-room'), response())

    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).not.toHaveProperty('hushEnabled')
  })

  it('does not update existing metadata when the room cannot be read', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([])

    await getLivekitToken(tokenRequest('unreadable-room'), response())

    expect(mocks.updateRoomMetadata).not.toHaveBeenCalled()
  })
  it('rejects unauthenticated access before contacting LiveKit', async () => {
    const res = response()
    await getLivekitToken({ query: { room: 'r1', sessionId: 's1', segmentId: 'seg1' } } as any, res)
    expect(res.statusCode).toBe(401)
    expect(mocks.createRoom).not.toHaveBeenCalled()
  })

  it('rejects another user session', async () => {
    mocks.findUnique.mockResolvedValue({ userId: 'someone-else' })
    const res = response()
    await getLivekitToken(tokenRequest('r1'), res)
    expect(res.statusCode).toBe(404)
    expect(mocks.createRoom).not.toHaveBeenCalled()
  })

  it('rejects mismatched or closed segments', async () => {
    mocks.segment.mockResolvedValue({ sessionId: 's2', roomName: 'r1', endedAt: null })
    const res = response()
    await getLivekitToken(tokenRequest('r1'), res)
    expect(res.statusCode).toBe(409)
    expect(mocks.createRoom).not.toHaveBeenCalled()
  })

  it('does not overwrite another activity room', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ sessionId: 's2', segmentId: 'seg2' }) }])
    const res = response()
    await getLivekitToken(tokenRequest('r1'), res)
    expect(res.statusCode).toBe(409)
    expect(mocks.updateRoomMetadata).not.toHaveBeenCalled()
  })

})
