import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  upsert: vi.fn(),
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({
  prisma: {
    adminAnalyticsQuery: db,
  },
}))

import { adminAnalyticsPlanSchema } from '../src/analytics/adminAnalyticsQuerySchema'
import { listAdminAnalyticsQueries, saveAdminAnalyticsQuery } from '../src/analytics/adminAnalyticsSavedQueries'

const plan = adminAnalyticsPlanSchema.parse({
  version: 1,
  title: 'Elevate users',
  answerKind: 'aggregate',
  days: 30,
  cohorts: [{ id: 'all', label: 'All learners', predicates: [] }],
  metrics: [{ type: 'usage_percentage', feature: 'elevate' }],
  breakdown: 'none',
  explanation: 'Elevate usage among all learners in the last 30 days.',
})

describe('saved admin analytics queries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.upsert.mockResolvedValue({ id: 'saved-1' })
    db.findMany.mockResolvedValue(Array.from({ length: 15 }, (_, index) => ({ id: `keep-${index}` })))
    db.deleteMany.mockResolvedValue({ count: 1 })
  })

  it('upserts by admin and stable plan hash, then trims only unpinned history', async () => {
    await saveAdminAnalyticsQuery('admin-1', 'Elevate usage', plan)
    expect(db.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId_planHash: { adminId: 'admin-1', planHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
      create: expect.objectContaining({ adminId: 'admin-1', question: 'Elevate usage' }),
    }))
    expect(db.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { adminId: 'admin-1', pinned: false },
      take: 15,
    }))
    expect(db.deleteMany).toHaveBeenCalledWith({
      where: {
        adminId: 'admin-1',
        pinned: false,
        id: { notIn: Array.from({ length: 15 }, (_, index) => `keep-${index}`) },
      },
    })
  })

  it('skips a stored plan that no longer matches the contract', async () => {
    const stamp = new Date('2026-10-14T00:00:00.000Z')
    const row = {
      id: 'saved-1',
      question: 'Elevate usage',
      title: 'Elevate users',
      plan,
      planHash: 'hash',
      pinned: true,
      refreshIntervalSec: 15,
      lastRunAt: stamp,
      createdAt: stamp,
    }
    db.findMany
      .mockResolvedValueOnce([row])
      .mockResolvedValueOnce([{ ...row, id: 'stale', pinned: false, plan: { version: 1 } }])
    const listed = await listAdminAnalyticsQueries('admin-1')
    expect(listed.pinned.map((item) => item.id)).toEqual(['saved-1'])
    expect(listed.pinned[0].refreshIntervalSec).toBe(60)
    expect(listed.recent).toEqual([])
  })
})
