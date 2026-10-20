import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }))

import { parseAnalyticsFilters } from '../src/analytics/adminAnalyticsFilters'
import { loadPageViewReport } from '../src/analytics/adminProductAnalytics'

function filters(query: Record<string, unknown> = {}) {
  const parsed = parseAnalyticsFilters(query)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.filters
}

describe('admin page-view analytics', () => {
  beforeEach(() => queryRaw.mockReset())

  it('returns route and daily charts with a first-party summary', async () => {
    queryRaw
      .mockResolvedValueOnce([{ views: 20, users: 10, routes: 4 }])
      .mockResolvedValueOnce([{
        path: '/replay',
        views: 8,
        users: 5,
        exits: 6,
        median_active_ms: 12_000,
        p75_active_ms: 20_000,
      }])
      .mockResolvedValueOnce([{ day: '2026-10-20', views: 20, users: 10 }])

    const report = await loadPageViewReport(filters({ days: '7' }))

    expect(report.summary).toMatchObject({
      views: 20,
      users: 10,
      routes: 4,
      viewsPerUser: 2,
      suppressed: false,
    })
    expect(report.routes[0]).toMatchObject({
      path: '/replay',
      medianActiveMs: 12_000,
    })
    expect(report.trends).toEqual([{ day: '2026-10-20', views: 20, users: 10 }])
  })

  it('hides page routes for a demographic cohort below five learners', async () => {
    queryRaw
      .mockResolvedValueOnce([{ views: 7, users: 4, routes: 3 }])
      .mockResolvedValueOnce([{ path: '/replay', views: 7, users: 4 }])
      .mockResolvedValueOnce([{ day: '2026-10-20', views: 7, users: 4 }])

    const report = await loadPageViewReport(filters({ gender: 'FEMALE' }))

    expect(report.summary).toMatchObject({ views: null, users: null, suppressed: true })
    expect(report.routes).toEqual([])
    expect(report.trends).toEqual([])
  })
})
