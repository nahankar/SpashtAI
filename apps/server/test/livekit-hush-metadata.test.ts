import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  listRooms: vi.fn(),
  updateRoomMetadata: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    voiceConfig: { findFirst: mocks.findFirst },
    session: { findUnique: mocks.findUnique },
  },
}))

vi.mock('livekit-server-sdk', () => ({
  AccessToken: class {
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
  })

  it('keeps the Hush decision from an existing room on token refresh', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ hushEnabled: false }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    const res = response()
    await getLivekitToken({ query: { identity: 'learner', room: 'active-room' } } as any, res)

    expect(res.statusCode).toBe(200)
    expect(mocks.updateRoomMetadata).toHaveBeenCalledOnce()
    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).toMatchObject({ hushEnabled: false })
  })

  it('preserves a legacy truthy room value instead of changing an active session', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ hushEnabled: 'true' }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    await getLivekitToken({ query: { identity: 'learner', room: 'legacy-enabled-room' } } as any, response())

    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).toMatchObject({ hushEnabled: true })
  })

  it('does not add a Hush setting to an existing pre-feature room', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([{ metadata: JSON.stringify({ voiceBackend: 'pipeline-bedrock' }) }])
    mocks.updateRoomMetadata.mockResolvedValue({})

    await getLivekitToken({ query: { identity: 'learner', room: 'legacy-room' } } as any, response())

    const [, metadata] = mocks.updateRoomMetadata.mock.calls[0]
    expect(JSON.parse(metadata)).not.toHaveProperty('hushEnabled')
  })

  it('does not update existing metadata when the room cannot be read', async () => {
    mocks.createRoom.mockRejectedValue(new Error('room already exists'))
    mocks.listRooms.mockResolvedValue([])

    await getLivekitToken({ query: { identity: 'learner', room: 'unreadable-room' } } as any, response())

    expect(mocks.updateRoomMetadata).not.toHaveBeenCalled()
  })
})
