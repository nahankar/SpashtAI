import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    sessionSegment: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    sessionMetrics: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  getElevateSessionOwnerId: vi.fn(),
  resolveRequestExportFlags: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('../src/lib/userExportFlags', () => ({
  exportDenied: vi.fn(),
  getElevateSessionOwnerId: mocks.getElevateSessionOwnerId,
  isPrivilegedRole: vi.fn(() => false),
  resolveRequestExportFlags: mocks.resolveRequestExportFlags,
}))

import { streamSessionRecording } from '../src/routes/recordings'
import { closeSessionSegment } from '../src/routes/session-segments'
import { saveSessionMetrics } from '../src/routes/metrics'

describe('Pause integration contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getElevateSessionOwnerId.mockResolvedValue('user-1')
    mocks.resolveRequestExportFlags.mockResolvedValue({
      flags: { hideAudioDownload: false },
      accessDenied: false,
    })
    mocks.prisma.sessionMetrics.findUnique.mockResolvedValue(null)
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        ...mocks.prisma,
        $queryRaw: vi.fn().mockResolvedValue([{ discardedAt: null }]),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams a single deterministic .audio segment as its stored audio/webm MIME', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spashtai-pause-'))
    const audioPath = join(dir, 'elevate-segment-hash.audio')
    await writeFile(audioPath, Buffer.from('webm-audio'))
    mocks.prisma.sessionSegment.findMany.mockResolvedValue([
      {
        segmentIndex: 0,
        recording: {
          filePath: audioPath,
          mimeType: 'audio/webm',
          updatedAt: new Date('2026-09-20T10:00:00Z'),
        },
      },
    ])

    const app = express()
    app.get('/sessions/:sessionId/recording/stream', streamSessionRecording)
    const response = await request(app).get('/sessions/session-1/recording/stream')

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^audio\/webm/)
    await rm(dir, { recursive: true, force: true })
  })

  it('calculates room-active duration from segment start, not recording start', async () => {
    const startedAt = new Date('2026-09-20T10:00:00Z')
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      userId: 'user-1',
      endedAt: null,
    })
    mocks.prisma.sessionSegment.findUnique.mockResolvedValue({
      id: 'segment-1',
      sessionId: 'session-1',
      startedAt,
      recordingStartedAt: new Date('2026-09-20T10:00:12Z'),
      endedAt: null,
      activeDurationSec: null,
      audioStatus: 'available',
    })
    const update = vi.fn().mockImplementation(({ data }) => ({
      id: 'segment-1',
      ...data,
    }))
    mocks.prisma.$transaction.mockImplementation(async (callback) =>
      callback({
        $queryRaw: vi.fn().mockResolvedValue([{ discardedAt: null }]),
        sessionSegment: {
          update,
          aggregate: vi.fn().mockResolvedValue({ _sum: { activeDurationSec: 120 } }),
        },
        session: { update: vi.fn() },
      }),
    )

    const app = express()
    app.use(express.json())
    app.patch('/sessions/:sessionId/segments/:segmentId', closeSessionSegment)
    const response = await request(app)
      .patch('/sessions/session-1/segments/segment-1')
      .send({ endedAt: '2026-09-20T10:02:00Z', audioStatus: 'available' })

    expect(response.status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ activeDurationSec: 120 }),
      }),
    )
  })

  it('does not manufacture WPM from active session duration', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      startedAt: new Date('2026-09-20T10:00:00Z'),
      endedAt: new Date('2026-09-20T10:05:00Z'),
      durationSec: 240,
    })
    mocks.prisma.sessionMetrics.upsert.mockImplementation(({ create }) => create)

    const app = express()
    app.use(express.json())
    app.post('/sessions/:sessionId/metrics', saveSessionMetrics)
    const response = await request(app)
      .post('/sessions/session-1/metrics')
      .send({
        userMetrics: {
          words_per_minute: 150,
          total_speaking_time: 0,
          total_words: 100,
        },
        assistantMetrics: {},
      })

    expect(response.status).toBe(200)
    expect(response.body.metrics.userWpm).toBe(0)
    expect(response.body.metrics.userSpeakingTime).toBe(0)
  })

  it('keeps measured speaking time distinct from active duration across a pause', async () => {
    mocks.prisma.session.findUnique.mockResolvedValue({
      id: 'session-1',
      startedAt: new Date('2026-09-20T10:00:00Z'),
      endedAt: new Date('2026-09-20T10:06:00Z'),
      durationSec: 240,
    })
    mocks.prisma.sessionMetrics.upsert.mockImplementation(({ create }) => create)

    const app = express()
    app.use(express.json())
    app.post('/sessions/:sessionId/metrics', saveSessionMetrics)
    const response = await request(app)
      .post('/sessions/session-1/metrics')
      .send({
        userMetrics: {
          words_per_minute: 120,
          total_speaking_time: 50,
          total_words: 100,
          pace: {
            source: 'validated_turn_audio',
            status: 'available',
            confidence: 'medium',
            totalWords: 100,
            speakingSeconds: 50,
            samples: 3,
            estimatedSamples: 0,
          },
        },
        assistantMetrics: {},
      })

    expect(response.status).toBe(200)
    expect(response.body.metrics.userWpm).toBe(120)
    expect(response.body.metrics.userSpeakingTime).toBe(50)
  })
})
