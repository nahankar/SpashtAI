import { describe, expect, it } from 'vitest'
import { pinnedQueriesDue, replaceSavedQuery } from './adminAnalyticsExplorer'
import type { SavedAnalyticsQuery } from '@/components/admin/analytics-explorer/types'

function saved(overrides: Partial<SavedAnalyticsQuery> = {}): SavedAnalyticsQuery {
  return {
    id: 'q1',
    question: 'Question',
    title: 'Query',
    plan: {
      version: 1,
      title: 'Query',
      answerKind: 'aggregate',
      days: 30,
      cohorts: [{ id: 'all', label: 'All', predicates: [] }],
      metrics: [{ type: 'learner_count' }],
      breakdown: 'none',
      explanation: 'All learners.',
    },
    planHash: 'hash',
    pinned: true,
    refreshIntervalSec: 60,
    lastRunAt: '2026-10-13T10:00:00.000Z',
    createdAt: '2026-10-13T09:00:00.000Z',
    ...overrides,
  }
}

describe('AI analytics saved-query helpers', () => {
  it('refreshes due pins only while the document is visible', () => {
    const now = new Date('2026-10-13T10:01:01.000Z').getTime()
    expect(pinnedQueriesDue([saved()], now, false)).toEqual([])
    expect(pinnedQueriesDue([saved()], now, true).map((query) => query.id)).toEqual(['q1'])
    expect(pinnedQueriesDue([saved({ lastRunAt: '2026-10-13T10:00:30.000Z' })], now, true)).toEqual([])
  })

  it('updates a pin in place without duplicating recent history', () => {
    const current = { pinned: [saved()], recent: [saved({ id: 'q2' })] }
    const updated = saved({ title: 'Renamed', lastRunAt: '2026-10-13T10:02:00.000Z' })
    const next = replaceSavedQuery(current, updated)
    expect(next.pinned).toHaveLength(1)
    expect(next.pinned[0].title).toBe('Renamed')
    expect(next.recent).toHaveLength(1)
  })
})
