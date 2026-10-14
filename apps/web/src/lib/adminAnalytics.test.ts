import { describe, expect, it } from 'vitest'
import { analyticsQueryFromSearch, analyticsQueryToSearch, formatDuration, viewState } from './adminAnalytics'

describe('admin analytics view helpers', () => {
  it('round-trips shareable filters', () => {
    const search = analyticsQueryToSearch({
      days: 7,
      city: ['Bengaluru'],
      state: ['Karnataka'],
      gender: ['FEMALE'],
      ageBand: ['25_34'],
      source: ['elevate'],
      skill: ['clarity'],
      feature: 'replay',
    })
    const params = new URLSearchParams(search)
    expect(analyticsQueryFromSearch(params)).toMatchObject({
      days: 7,
      city: ['Bengaluru'],
      gender: ['FEMALE'],
      ageBand: ['25_34'],
      feature: 'replay',
    })
  })

  it('labels missing active time instead of a zero and distinguishes view states', () => {
    expect(formatDuration(null)).toBe('Not recorded yet')
    expect(formatDuration(90_000)).toBe('2m')
    expect(viewState(true, null, false)).toBe('loading')
    expect(viewState(false, 'nope', false)).toBe('error')
    expect(viewState(false, null, true)).toBe('empty')
    expect(viewState(false, null, false)).toBe('ready')
  })
})
