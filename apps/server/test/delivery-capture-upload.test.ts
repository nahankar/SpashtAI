import { createHash } from 'crypto'
import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRecordingCaptureSettings } from '../src/analytics/deliveryCapture'

const mocks = vi.hoisted(() => ({
  sessionFind: vi.fn(),
  segmentFind: vi.fn(),
  txSegmentFind: vi.fn(),
  segmentUpdate: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFind },
    sessionSegment: { findUnique: mocks.segmentFind },
    $transaction: mocks.transaction,
  },
}))
vi.mock('../src/analytics/audioEnrichment', () => ({
  scheduleElevateSessionAudioEnrichmentIfAnalyzed: vi.fn(),
}))

import {
  reconcileSegmentRecordingMetadata,
  recordingUpload,
  uploadSessionRecording,
} from '../src/routes/recordings'

const audio = Buffer.from('existing recorded audio')
const capture = {
  autoGainControl: { requested: true, applied: false, supported: true },
  noiseSuppression: { requested: true, applied: true, supported: true },
  echoCancellation: { requested: true, applied: true, supported: true },
  voiceIsolation: { requested: true, supported: false },
}

describe('segment recording capture provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessionFind.mockResolvedValue({
      id: 'session-1', userId: 'user-1', recordingStartedAt: null, discardedAt: null,
    })
    mocks.segmentFind.mockResolvedValue({
      id: 'segment-1',
      sessionId: 'session-1',
      audioStatus: 'pending',
      captureSettings: null,
      recording: {
        contentHash: createHash('sha256').update(audio).digest('hex'),
        fileSize: audio.length,
        mimeType: 'audio/webm',
      },
    })
    mocks.txSegmentFind.mockResolvedValue({
      audioStatus: 'pending',
      captureSettings: null,
    })
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: vi.fn().mockResolvedValue([{ discardedAt: null }]),
      sessionSegment: { findUnique: mocks.txSegmentFind, update: mocks.segmentUpdate },
      session: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      sessionMetrics: { findUnique: vi.fn().mockResolvedValue(null) },
    }))
  })

  const app = express()
  app.post(
    '/sessions/:sessionId/recording/upload',
    recordingUpload.single('audio'),
    uploadSessionRecording,
  )

  function upload(metadata: string) {
    return request(app)
      .post('/sessions/session-1/recording/upload')
      .field('segmentId', 'segment-1')
      .field('captureSettings', metadata)
      .attach('audio', audio, { filename: 'recording.webm', contentType: 'audio/webm' })
  }

  it('stores the applied microphone settings on the segment with its recording', async () => {
    const response = await upload(JSON.stringify(capture))
    expect(response.status).toBe(200)
    expect(mocks.segmentUpdate).toHaveBeenCalledWith({
      where: { id: 'segment-1' },
      data: { audioStatus: 'available', captureSettings: capture },
    })
  })

  it('rejects invalid capture data instead of recording it as an unknown setting', async () => {
    const response = await upload('{"autoGainControl":"true"}')
    expect(response.status).toBe(400)
    expect(mocks.segmentUpdate).not.toHaveBeenCalled()
  })

  it('accepts an identical capture report on retry regardless of JSON key order', async () => {
    mocks.segmentFind.mockResolvedValue({
      id: 'segment-1',
      sessionId: 'session-1',
      audioStatus: 'available',
      captureSettings: {
        voiceIsolation: capture.voiceIsolation,
        echoCancellation: capture.echoCancellation,
        noiseSuppression: capture.noiseSuppression,
        autoGainControl: capture.autoGainControl,
      },
      recording: {
        contentHash: createHash('sha256').update(audio).digest('hex'),
        fileSize: audio.length,
        mimeType: 'audio/webm',
      },
    })
    mocks.txSegmentFind.mockResolvedValue({
      audioStatus: 'available',
      captureSettings: capture,
    })
    const response = await upload(JSON.stringify(capture))
    expect(response.status).toBe(200)
    expect(mocks.segmentUpdate).not.toHaveBeenCalled()
  })

  it('repairs missing capture settings under the session lock after a concurrent upload', async () => {
    expect(await reconcileSegmentRecordingMetadata(
      'session-1',
      'segment-1',
      parseRecordingCaptureSettings(JSON.stringify(capture)),
    )).toBe('accepted')
    expect(mocks.txSegmentFind).toHaveBeenCalledWith({
      where: { id: 'segment-1' },
      select: { audioStatus: true, captureSettings: true },
    })
    expect(mocks.segmentUpdate).toHaveBeenCalledWith({
      where: { id: 'segment-1' },
      data: { audioStatus: 'available', captureSettings: capture },
    })
  })

  it('rejects conflicting capture settings observed after the initial segment read', async () => {
    mocks.txSegmentFind.mockResolvedValue({
      audioStatus: 'available',
      captureSettings: {
        ...capture,
        autoGainControl: { ...capture.autoGainControl, applied: true },
      },
    })
    const response = await upload(JSON.stringify(capture))
    expect(response.status).toBe(409)
    expect(mocks.segmentUpdate).not.toHaveBeenCalled()
  })
})
