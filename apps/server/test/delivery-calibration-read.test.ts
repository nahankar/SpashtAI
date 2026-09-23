import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
}))

vi.mock('../src/lib/prisma', () => ({
  prisma: { sessionMetrics: { findUnique: mocks.findUnique } },
}))

import { getAdvancedMetrics } from '../src/routes/advanced-metrics'

describe('historical delivery calibration gate', () => {
  it('strips an unvalidated legacy calibration claim on read', async () => {
    mocks.findUnique.mockResolvedValue({
      sessionId: 'session-1',
      contentMetrics: {},
      deliveryMetrics: {
        pitch_variation: 9,
        voice_quality_score: 9,
        delivery_evidence: {
          schema_version: 1,
          status: 'experimental',
          calibration_status: 'calibrated',
          timing: { evidence_quality: 2 },
        },
      },
      performanceInsights: null,
      processingStatus: { audio_processed: true },
      updatedAt: new Date('2026-09-23T00:00:00Z'),
    })
    const app = express()
    app.get('/sessions/:sessionId/advanced-metrics', getAdvancedMetrics)
    const response = await request(app).get('/sessions/session-1/advanced-metrics')
    expect(response.status).toBe(200)
    expect(response.body.delivery_metrics.delivery_evidence.calibration_status)
      .toBe('uncalibrated')
  })
})
