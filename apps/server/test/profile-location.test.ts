import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachSignupLocation, mergeResolvedLocation, type SignupProfile } from '../src/lib/profile'

const profile = (change: Partial<SignupProfile> = {}): SignupProfile => ({
  phone: '9876543210',
  dateOfBirth: new Date('1995-06-15'),
  gender: 'FEMALE',
  pincode: '560001',
  city: null,
  state: null,
  country: null,
  ...change,
})

describe('signup location resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('prefers a successful lookup, then an existing valid location, then the incoming blanks', () => {
    expect(mergeResolvedLocation(
      { city: null, state: null, country: null },
      { city: 'Bengaluru', state: 'Karnataka', country: 'India' },
      { city: 'Mysuru', state: 'Karnataka', country: 'India' },
    )).toEqual({ city: 'Bengaluru', state: 'Karnataka', country: 'India' })
    expect(mergeResolvedLocation(
      { city: null, state: null, country: null },
      { city: null, state: null, country: 'India' },
      { city: 'Mysuru', state: 'Karnataka', country: 'India' },
    )).toEqual({ city: 'Mysuru', state: 'Karnataka', country: 'India' })
    expect(mergeResolvedLocation(
      { city: null, state: null, country: null },
      { city: null, state: null, country: null },
    )).toEqual({ city: null, state: null, country: null })
  })

  it('looks up a pincode before signup and still returns a usable profile when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('lookup unavailable') }))
    const located = await attachSignupLocation(profile())
    expect(located).toMatchObject({ phone: '9876543210', pincode: '560001', country: 'India' })
    expect(located.city).toBeNull()
    expect(located.state).toBeNull()
  })

  it('keeps an existing city when lookup returns only a country', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('lookup unavailable') }))
    const located = await attachSignupLocation(profile(), { city: 'Mysuru', state: 'Karnataka', country: 'India' })
    expect(located).toMatchObject({ city: 'Mysuru', state: 'Karnataka', country: 'India' })
  })
})
