import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const queryRaw = vi.hoisted(() => vi.fn())
const loadCube = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }))
vi.mock('../src/analytics/cubeAnalyticsClient', () => ({
  isCubeAnalyticsConfigured: () => true,
  loadCubeAnalytics: loadCube,
}))

import { adminAnalyticsPlanSchema } from '../src/analytics/adminAnalyticsQuerySchema'
import { analyticsPlanHash, executeAdminAnalyticsPlan, loadAdminAnalyticsUsers } from '../src/analytics/adminAnalyticsQueryEngine'

function plan(answerKind: 'aggregate' | 'users' = 'aggregate') {
  return adminAnalyticsPlanSchema.parse({
    version: 1,
    title: 'Male Elevate learners',
    answerKind,
    days: null,
    cohorts: [{
      id: 'male',
      label: 'Male learners',
      predicates: [
        { type: 'gender', value: 'MALE' },
        { type: 'feature', feature: 'elevate', used: true, timeframe: 'lifetime' },
        { type: 'feature', feature: 'replay', used: false, timeframe: 'lifetime' },
      ],
    }],
    metrics: [{ type: 'learner_count' }],
    breakdown: 'none',
    explanation: 'Male learners who used Elevate and never Replay.',
  })
}

describe('admin analytics query engine', () => {
  beforeEach(() => queryRaw.mockReset())

  it('suppresses a demographic aggregate below five learners', async () => {
    queryRaw.mockResolvedValueOnce([{ value: 4 }])
    const result = await executeAdminAnalyticsPlan(plan())
    expect(result.cohorts[0]).toMatchObject({
      users: null,
      suppressed: true,
      metrics: [{ value: null }],
    })
  })

  it('allows an audited admin identity query to report its page total', async () => {
    queryRaw.mockResolvedValueOnce([{ value: 2 }])
    const result = await executeAdminAnalyticsPlan(plan('users'))
    expect(result.cohorts[0]).toMatchObject({
      users: 2,
      suppressed: false,
      metrics: [{ value: 2, unit: 'learners' }],
    })
  })

  it('produces a stable hash for saved-plan reruns', () => {
    expect(analyticsPlanHash(plan())).toBe(analyticsPlanHash(plan()))
    expect(analyticsPlanHash(plan())).toHaveLength(64)
  })

  it('hides language scores on an identity cohort smaller than five', async () => {
    queryRaw.mockResolvedValueOnce([{ value: 2 }])
    const result = await executeAdminAnalyticsPlan(adminAnalyticsPlanSchema.parse({
      ...plan('users'),
      metrics: [{ type: 'language_median', source: 'elevate', metric: 'filler_rate' }],
    }))
    expect(result.cohorts[0]).toMatchObject({ users: 2, suppressed: false, metrics: [{ value: null }] })
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it('splits a cohort by gender and hides groups under five', async () => {
    queryRaw.mockResolvedValueOnce([
      { bucket: 'MALE', users: 8 },
      { bucket: 'FEMALE', users: 2 },
    ])
    const result = await executeAdminAnalyticsPlan(adminAnalyticsPlanSchema.parse({
      ...plan(),
      breakdown: 'gender',
    }))
    expect(result.cohorts).toEqual([
      expect.objectContaining({ id: 'male_male', label: 'Male', users: 8, suppressed: false, metrics: [expect.objectContaining({ value: 8 })] }),
      expect.objectContaining({ id: 'male_female', label: 'Female', users: null, suppressed: true, metrics: [expect.objectContaining({ value: null })] }),
    ])
  })

  it('calculates a usage percentage in SQL when Cube is configured', async () => {
    queryRaw.mockResolvedValueOnce([{ value: 10 }]).mockResolvedValueOnce([{ value: 20 }])
    const result = await executeAdminAnalyticsPlan(adminAnalyticsPlanSchema.parse({
      ...plan(),
      cohorts: [{ id: 'women', label: 'Women', predicates: [{ type: 'gender', value: 'FEMALE' }] }],
      metrics: [{ type: 'usage_percentage', feature: 'elevate' }],
    }))
    expect(result.cohorts[0].metrics[0].value).toBe(20)
    expect(loadCube).not.toHaveBeenCalled()
  })

  it('keeps the identity total on a page past the last row', async () => {
    queryRaw.mockResolvedValueOnce([{ value: 25 }]).mockResolvedValueOnce([])
    const page = await loadAdminAnalyticsUsers(plan('users'), 3)
    expect(page).toMatchObject({ page: 3, total: 25, users: [] })
  })

  it('uses the same Elevate, interview, and age definitions as Cube', () => {
    const source = readFileSync(new URL('../src/analytics/adminAnalyticsQueryEngine.ts', import.meta.url), 'utf8')
    expect(source).toContain("s.module = 'elevate'")
    expect(source).toContain('s."discardedAt" IS NULL')
    expect(source).toContain('CURRENT_TIMESTAMP')
    expect(source).not.toContain('CURRENT_DATE')
    expect(source).toContain('FEATURE_USE_ACTIONS')
    expect(source).toContain('COUNT(DISTINCT u.id) FILTER')
    expect(source).toContain('m."userFillerCount" > 0')
  })
})
