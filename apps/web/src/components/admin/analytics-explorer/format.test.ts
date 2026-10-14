import { describe, expect, it } from 'vitest'
import {
  chartsForResult,
  formatMetricValue,
  normalizeRefreshInterval,
  predicateLabel,
  refreshDelayMs,
  replaceSavedQuery,
  understandingChips,
} from './format'
import type { AnalyticsPlan, AnalyticsResult, SavedQuery } from './types'

const plan: AnalyticsPlan = {
  version: 1,
  title: 'Replay by gender',
  answerKind: 'comparison',
  days: 30,
  cohorts: [
    {
      id: 'women',
      label: 'Women',
      predicates: [
        { type: 'gender', value: 'FEMALE' },
        { type: 'feature', feature: 'replay', used: true, timeframe: 'range' },
      ],
    },
    {
      id: 'men',
      label: 'Men',
      predicates: [{ type: 'gender', value: 'MALE' }],
    },
  ],
  metrics: [{ type: 'usage_percentage', feature: 'replay' }],
  breakdown: 'none',
  explanation: 'Compare women and men who are in the last 30 days.',
}

function saved(id: string, pinned: boolean, lastRunAt: string): SavedQuery {
  return {
    id,
    question: id,
    title: id,
    plan,
    planHash: id,
    pinned,
    refreshIntervalSec: 60,
    lastRunAt,
    createdAt: lastRunAt,
  }
}

describe('analytics explorer formatting', () => {
  it('defaults a missing refresh interval to 60 seconds', () => {
    expect(normalizeRefreshInterval(undefined)).toBe(60)
    expect(normalizeRefreshInterval(15)).toBe(60)
    expect(refreshDelayMs(30)).toBe(30_000)
    expect(refreshDelayMs(300)).toBe(300_000)
  })

  it('describes the plan as chips', () => {
    expect(predicateLabel({ type: 'age', operator: 'gte', value: 40 })).toBe('Age at least 40')
    expect(understandingChips(plan).map((chip) => chip.label)).toEqual([
      'Comparison',
      'Last 30 days',
      'Women',
      'Female',
      'Used Replay in this period',
      'Men',
      'Male',
      'Replay usage',
    ])
  })

  it('formats metric values and builds one chart per unit', () => {
    expect(formatMetricValue(null, 'percent')).toBe('—')
    expect(formatMetricValue(42.25, 'percent')).toBe('42.3%')
    expect(formatMetricValue(1280, 'learners')).toBe('1,280')
    const result: AnalyticsResult = {
      planHash: 'hash',
      executedAt: '2026-10-14T00:00:00.000Z',
      privacyThreshold: 5,
      cohorts: [
        {
          id: 'women',
          label: 'Women',
          users: 20,
          suppressed: false,
          metrics: [
            { key: 'count', label: 'Learners', value: 20, unit: 'learners' },
            { key: 'pace', label: 'Pace', value: 140, unit: 'wpm' },
          ],
        },
        {
          id: 'men',
          label: 'Men',
          users: null,
          suppressed: true,
          metrics: [
            { key: 'count', label: 'Learners', value: null, unit: 'learners' },
            { key: 'pace', label: 'Pace', value: null, unit: 'wpm' },
          ],
        },
      ],
    }
    const charts = chartsForResult(result)
    expect(charts.map((chart) => chart.unit)).toEqual(['learners', 'wpm'])
    expect(charts[0]?.rows[0]).toMatchObject({ metric: 'Learners', women: 20, men: null })
  })

  it('moves a query between pinned and the last 15 recent', () => {
    const recent = Array.from({ length: 15 }, (_item, index) => saved(`r${index}`, false, `2026-10-01T00:00:${String(index).padStart(2, '0')}.000Z`))
    const pinned = replaceSavedQuery({ pinned: [], recent }, saved('r14', true, '2026-10-02T00:00:00.000Z'))
    expect(pinned.pinned.map((item) => item.id)).toEqual(['r14'])
    expect(pinned.recent).toHaveLength(14)
    expect(pinned.recent.some((item) => item.id === 'r14')).toBe(false)

    const unpinned = replaceSavedQuery(
      { pinned: [saved('keep', true, '2026-10-02T00:00:00.000Z')], recent },
      saved('keep', false, '2026-10-03T00:00:00.000Z'),
    )
    expect(unpinned.pinned).toEqual([])
    expect(unpinned.recent).toHaveLength(15)
    expect(unpinned.recent[0]?.id).toBe('keep')
    expect(unpinned.recent.some((item) => item.id === 'r0')).toBe(false)
  })
})
