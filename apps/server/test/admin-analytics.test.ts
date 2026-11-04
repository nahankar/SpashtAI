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
const loadPlatformPracticeTotals = vi.hoisted(() => vi.fn())

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: getEnabledFeaturesMock }))
vi.mock('../src/analytics/platformPracticeTotals', () => ({ loadPlatformPracticeTotals }))

import analyticsRouter from '../src/routes/admin/analytics'

function appForAnalytics() {
  const app = express()
  app.use((req, _res, next) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' }
    next()
  })
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
    loadPlatformPracticeTotals.mockResolvedValue({
      scope: { kind: 'platform', workspaceId: null, practice: 'all-workspaces' },
      totals: { elevateTotal: 40, elevateMonth: 7, replayTotal: 20, replayMonth: 4, interviewRuns: 0, pulseParticipants: 0 },
      membersInWorkspace: null,
    })
  })

  it('presents platform practice totals and does not invent Prepare session counts', async () => {
    const response = await request(appForAnalytics()).get('/api/admin/analytics/overview')

    expect(response.status).toBe(200)
    expect(loadPlatformPracticeTotals).toHaveBeenCalledWith('admin-1', null)
    expect(response.body.scope).toEqual({ kind: 'platform', workspaceId: null, practice: 'all-workspaces' })
    expect(response.body.sessions).toEqual({
      enabledFeatures: ['elevate', 'replay', 'prepare'],
      elevate: { total: 40, thisMonth: 7 },
      replay: { total: 20, thisMonth: 4 },
    })
    expect(response.body.sessions).not.toHaveProperty('prepare')
    expect(prismaMock.session.count).not.toHaveBeenCalled()
    expect(prismaMock.replaySession.count).not.toHaveBeenCalled()
  })
})
