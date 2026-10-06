import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  user: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
  session: { count: vi.fn() },
  replaySession: { count: vi.fn() },
  preparation: { count: vi.fn() },
  preparationPractice: { count: vi.fn() },
  preparationRecording: { count: vi.fn() },
  featureUsage: { groupBy: vi.fn(), findMany: vi.fn() },
}))

const getEnabledFeaturesMock = vi.hoisted(() => vi.fn())

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: getEnabledFeaturesMock }))

import analyticsRouter from '../src/routes/admin/analytics'

function appForAnalytics() {
  const app = express()
  app.use('/api/admin/analytics', analyticsRouter)
  return app
}

describe('admin analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getEnabledFeaturesMock.mockResolvedValue(['elevate', 'replay', 'prepare'])
    prismaMock.user.count
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(36)
    prismaMock.session.count.mockResolvedValueOnce(40).mockResolvedValueOnce(7)
    prismaMock.replaySession.count.mockResolvedValueOnce(20).mockResolvedValueOnce(4)
    prismaMock.preparation.count.mockResolvedValueOnce(12).mockResolvedValueOnce(3)
    prismaMock.preparationPractice.count.mockResolvedValueOnce(18).mockResolvedValueOnce(5)
    prismaMock.preparationRecording.count.mockResolvedValueOnce(9).mockResolvedValueOnce(2)
  })

  it('keeps Prepare-owned activity out of standalone Elevate and Replay totals', async () => {
    const response = await request(appForAnalytics()).get('/api/admin/analytics/overview')

    expect(response.status).toBe(200)
    expect(response.body.sessions).toMatchObject({
      elevate: { total: 40, thisMonth: 7 },
      replay: { total: 20, thisMonth: 4 },
      prepare: {
        journeys: { total: 12, thisMonth: 3 },
        eventPractices: { total: 18, thisMonth: 5 },
        eventRecordings: { total: 9, thisMonth: 2 },
      },
    })
    expect(prismaMock.session.count).toHaveBeenNthCalledWith(1, {
      where: { discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null },
    })
    expect(prismaMock.replaySession.count).toHaveBeenNthCalledWith(1, {
      where: { purpose: 'COMMUNICATION', preparationRecording: null },
    })
  })
})
