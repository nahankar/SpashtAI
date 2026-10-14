import { describe, expect, it } from 'vitest'
import { ageBandFromDob, numberOrNull, parseAnalyticsFilters, presentCohort } from '../src/analytics/adminAnalyticsFilters'

describe('admin analytics filters', () => {
  const now = new Date('2026-10-13T12:00:00Z')

  it('places birthdays on the correct age-band boundary', () => {
    expect(ageBandFromDob(new Date('2008-10-14T00:00:00Z'), now)).toBe('under_18')
    expect(ageBandFromDob(new Date('2008-10-13T00:00:00Z'), now)).toBe('18_24')
    expect(ageBandFromDob(new Date('2001-10-13T00:00:00Z'), now)).toBe('25_34')
    expect(ageBandFromDob(new Date('1971-10-12T00:00:00Z'), now)).toBe('55_plus')
    expect(ageBandFromDob(null, now)).toBe('unknown')
  })

  it('rejects unknown demographic values and caps the range at 90 days', () => {
    expect(parseAnalyticsFilters({ days: '400', gender: 'FEMALE' }, now)).toMatchObject({ filters: { days: 90, genders: ['FEMALE'] } })
    expect(parseAnalyticsFilters({ gender: 'UNKNOWN' }, now)).toEqual({ error: 'Invalid gender filter' })
    expect(parseAnalyticsFilters({ ageBand: '100' }, now)).toEqual({ error: 'Invalid age band filter' })
    expect(parseAnalyticsFilters({ pincode: '560001', city: 'Bengaluru' }, now)).toMatchObject({ filters: { pincodes: [], cities: ['Bengaluru'] } })
  })

  it('hides demographic slices smaller than five learners', () => {
    expect(presentCohort(4, { average: 7 })).toEqual({ users: null, suppressed: true, threshold: 5 })
    expect(presentCohort(5, { average: 7 })).toMatchObject({ users: 5, suppressed: false, average: 7 })
  })

  it('keeps a missing database number missing', () => {
    expect(numberOrNull(null)).toBeNull()
    expect(numberOrNull(undefined)).toBeNull()
    expect(numberOrNull('119.2')).toBe(119.2)
  })
})
