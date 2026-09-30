import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  adminCreate: vi.fn(),
  listRooms: vi.fn(),
  listParticipants: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    voiceConfig: {
      findUnique: mocks.findUnique,
      update: mocks.update,
    },
    adminAction: { create: mocks.adminCreate },
  },
}))

vi.mock('livekit-server-sdk', () => ({
  RoomServiceClient: class {
    listRooms = mocks.listRooms
    listParticipants = mocks.listParticipants
  },
}))

import voiceConfigRouter from '../src/routes/admin/voice-config'

function app() {
  const instance = express()
  instance.use(express.json())
  instance.use(voiceConfigRouter)
  return instance
}

describe('Hush voice configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.LIVEKIT_API_KEY = 'key'
    process.env.LIVEKIT_API_SECRET = 'secret'
    process.env.LIVEKIT_URL = 'ws://localhost:7880'
    mocks.transaction.mockImplementation(async (callback: any) => callback({
      voiceConfig: { update: mocks.update },
      adminAction: { create: mocks.adminCreate },
    }))
    mocks.findUnique.mockResolvedValue({ backend: 'pipeline-bedrock', hushEnabled: false })
    mocks.update.mockResolvedValue({ backend: 'pipeline-bedrock', hushEnabled: true })
    mocks.adminCreate.mockResolvedValue({})
  })

  it('changes Hush atomically with its audit record', async () => {
    const response = await request(app())
      .put('/pipeline-bedrock')
      .send({ hushEnabled: true })

    expect(response.status).toBe(200)
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { backend: 'pipeline-bedrock' },
      data: expect.objectContaining({ hushEnabled: true }),
    }))
    expect(mocks.adminCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'voice_config.set_hush_enabled',
        metadata: expect.objectContaining({ previous: false, next: true }),
      }),
    }))
  })

  it('rejects Hush for a non-Pipeline-Bedrock backend', async () => {
    mocks.findUnique.mockResolvedValue({ backend: 'nova-sonic', hushEnabled: false })

    const response = await request(app()).put('/nova-sonic').send({ hushEnabled: true })

    expect(response.status).toBe(400)
    expect(response.body.error).toContain('pipeline-bedrock')
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it('reports the selected Hush configuration in the health preview', async () => {
    const response = await request(app()).post('/health').send({
      backend: 'pipeline-bedrock',
      sttProvider: 'transcribe',
      ttsProvider: 'polly',
      hushEnabled: true,
    })

    expect(response.status).toBe(200)
    expect(response.body.checks.hush).toEqual(expect.objectContaining({
      ok: true,
      detail: expect.stringContaining('enabled for new Pipeline Bedrock sessions'),
    }))
  })

  it('returns only the non-sensitive Hush state reported by active agents', async () => {
    mocks.listRooms.mockResolvedValue([{ name: 'room-a' }])
    mocks.listParticipants.mockResolvedValue([
      {
        identity: 'agent-a',
        metadata: JSON.stringify({
          role: 'agent',
          hushRequested: true,
          hushEffective: false,
          hushState: 'fallback',
          hushFailureReason: 'initialization_failed:HushContractError',
          effectiveBackend: 'pipeline-bedrock',
          hushPluginVersion: '0.3.3',
          hushFrames: 9,
          hushLatencyP95Ms: 4.2,
          hushOverruns: 0,
          unrelatedPrivateField: 'must not be returned',
        }),
      },
      { identity: 'learner-a', metadata: JSON.stringify({ role: 'user' }) },
    ])

    const response = await request(app()).get('/hush-runtime')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      available: true,
      sessions: [expect.objectContaining({
        room: 'room-a',
        state: 'fallback',
        failureReason: 'initialization_failed:HushContractError',
        frames: 9,
      })],
    })
    expect(response.body.sessions[0]).not.toHaveProperty('unrelatedPrivateField')
  })
})
