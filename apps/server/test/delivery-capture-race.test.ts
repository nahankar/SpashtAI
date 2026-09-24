import { createHash } from 'crypto'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import express from 'express'
import { Prisma } from '@prisma/client'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionFind: vi.fn(),
  segmentFind: vi.fn(),
  racedRecordingFind: vi.fn(),
  txSegmentFind: vi.fn(),
  segmentUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFind },
    sessionSegment: { findUnique: mocks.segmentFind },
    sessionRecording: { findUnique: mocks.racedRecordingFind },
    $transaction: mocks.transaction,
  },
}))
vi.mock('../src/analytics/audioEnrichment', () => ({
  scheduleElevateSessionAudioEnrichmentIfAnalyzed: vi.fn(),
}))

const audio = Buffer.from('concurrent recorded audio')
const capture = {
  autoGainControl: { requested: true, applied: false, supported: true },
  noiseSuppression: { requested: true, applied: true, supported: true },
  echoCancellation: { requested: true, applied: true, supported: true },
  voiceIsolation: { requested: false, applied: false, supported: true },
}

describe('concurrent recording upload recovery', () => {
  const previousAudioPath = process.env.LOCAL_AUDIO_PATH
  let storageDir: string
  const app = express()

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'spashtai-delivery-race-'))
    process.env.LOCAL_AUDIO_PATH = storageDir
    const { recordingUpload, uploadSessionRecording } = await import('../src/routes/recordings')
    app.post(
      '/sessions/:sessionId/recording/upload',
      recordingUpload.single('audio'),
      uploadSessionRecording,
    )
  })

  afterAll(async () => {
    if (previousAudioPath === undefined) delete process.env.LOCAL_AUDIO_PATH
    else process.env.LOCAL_AUDIO_PATH = previousAudioPath
    await rm(storageDir, { recursive: true, force: true })
  })

  it('fills missing capture settings when the other identical upload wins the unique race', async () => {
    mocks.sessionFind.mockResolvedValue({
      id: 'session-1', userId: 'user-1', recordingStartedAt: null, discardedAt: null,
    })
    mocks.segmentFind.mockResolvedValue({
      id: 'segment-1',
      sessionId: 'session-1',
      segmentIndex: 0,
      audioStatus: 'pending',
      captureSettings: null,
      endedAt: null,
      recording: null,
    })
    mocks.racedRecordingFind.mockResolvedValue({
      contentHash: createHash('sha256').update(audio).digest('hex'),
      fileSize: audio.length,
      mimeType: 'audio/webm',
    })
    mocks.txSegmentFind.mockResolvedValue({ audioStatus: 'available', captureSettings: null })
    const create = vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'unique recording already exists',
      { code: 'P2002', clientVersion: '6.16.2' },
    ))
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn().mockResolvedValue([{ discardedAt: null }]),
      sessionRecording: { create },
      sessionSegment: { findUnique: mocks.txSegmentFind, update: mocks.segmentUpdate },
      session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sessionMetrics: { findUnique: vi.fn().mockResolvedValue(null) },
    }))

    const response = await request(app)
      .post('/sessions/session-1/recording/upload')
      .field('segmentId', 'segment-1')
      .field('captureSettings', JSON.stringify(capture))
      .attach('audio', audio, { filename: 'recording.webm', contentType: 'audio/webm' })

    expect(response.status).toBe(200)
    expect(response.body.idempotent).toBe(true)
    expect(create).toHaveBeenCalledOnce()
    expect(mocks.transaction).toHaveBeenCalledTimes(2)
    expect(mocks.segmentUpdate).toHaveBeenCalledWith({
      where: { id: 'segment-1' },
      data: { audioStatus: 'available', captureSettings: capture },
    })
  })
})
