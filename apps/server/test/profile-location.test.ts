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
const MYSURU = { pincode: '570001', city: 'Mysuru', state: 'Karnataka', country: 'India' }
const BENGALURU = { pincode: '560001', city: 'Bengaluru', state: 'Karnataka', country: 'India' }
const nothing = { city: null, state: null, country: null }

describe('signup location resolution', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses a complete lookup for new users and over any existing location', () => {
    const looked = { city: 'Bengaluru', state: 'Karnataka', country: 'India' }
    expect(mergeResolvedLocation('560001', looked)).toEqual(looked)
    expect(mergeResolvedLocation('560001', looked, MYSURU)).toEqual(looked)
  })

  it('fills gaps from an existing location only for the same postcode and country', () => {
    expect(mergeResolvedLocation('560001', { city: null, state: null, country: 'India' }, BENGALURU))
      .toEqual({ city: 'Bengaluru', state: 'Karnataka', country: 'India' })
    // Postcode formatting differences are the same postcode.
    expect(mergeResolvedLocation('SW1A 1AA', { city: null, state: null, country: 'United Kingdom' },
      { pincode: 'sw1a1aa', city: 'London', state: 'England', country: 'United Kingdom' }))
      .toEqual({ city: 'London', state: 'England', country: 'United Kingdom' })
    // Partial response: lookup's own fields win, the same-postcode existing state fills only the gap.
    expect(mergeResolvedLocation('560001', { city: 'Bengaluru Urban', state: null, country: 'India' }, BENGALURU))
      .toEqual({ city: 'Bengaluru Urban', state: 'Karnataka', country: 'India' })
  })

  it('never carries an old locality to a changed postcode, a missing old postcode or another country', () => {
    // Changed postcode in the same country.
    expect(mergeResolvedLocation('560001', { city: null, state: null, country: 'India' }, MYSURU))
      .toEqual({ city: null, state: null, country: 'India' })
    // Existing city with no postcode on record: compatibility is unknown.
    expect(mergeResolvedLocation('560001', { city: null, state: null, country: 'India' }, { ...MYSURU, pincode: null }))
      .toEqual({ city: null, state: null, country: 'India' })
    // Country change: never Mysuru / Karnataka / United States.
    expect(mergeResolvedLocation('94105', { city: null, state: null, country: 'United States' }, MYSURU))
      .toEqual({ city: null, state: null, country: 'United States' })
    // Same postcode string but the lookup places it in another country.
    expect(mergeResolvedLocation('570001', { city: null, state: null, country: 'United States' }, MYSURU))
      .toEqual({ city: null, state: null, country: 'United States' })
  })

  it('leaves everything blank when nothing is known', () => {
    expect(mergeResolvedLocation('560001', nothing)).toEqual(nothing)
    expect(mergeResolvedLocation('ABC-123', nothing, MYSURU)).toEqual(nothing)
  })

  it('keeps the same-postcode location when the lookup fails, and blanks a different one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('lookup unavailable') }))
    const created = await attachSignupLocation(profile())
    expect(created).toMatchObject({ phone: '9876543210', pincode: '560001', city: null, state: null, country: 'India' })
    expect(await attachSignupLocation(profile(), BENGALURU)).toMatchObject({ city: 'Bengaluru', state: 'Karnataka', country: 'India' })
    expect(await attachSignupLocation(profile(), MYSURU)).toMatchObject({ city: null, state: null, country: 'India' })
    expect(await attachSignupLocation(profile({ pincode: '94105' }), MYSURU)).toMatchObject({ city: null, state: null, country: 'United States' })
  })
})
