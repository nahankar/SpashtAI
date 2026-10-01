import { describe, expect, it } from 'vitest'
import { formatSessionOwner, matchesSessionOwner } from './adminUserFilter'

describe('admin user filtering', () => {
  const owner = {
    firstName: 'Neelesh',
    lastName: 'Ahankari',
    email: 'neelesh@example.com',
  }

  it('matches first, last, full, and email fragments case-insensitively', () => {
    expect(matchesSessionOwner(owner, 'neel')).toBe(true)
    expect(matchesSessionOwner(owner, 'AHANK')).toBe(true)
    expect(matchesSessionOwner(owner, 'lesh ahan')).toBe(true)
    expect(matchesSessionOwner(owner, '@example')).toBe(true)
  })

  it('does not match another user and treats a blank filter as inactive', () => {
    expect(matchesSessionOwner(owner, 'someone else')).toBe(false)
    expect(matchesSessionOwner(owner, '   ')).toBe(true)
  })

  it('formats names with an email fallback', () => {
    expect(formatSessionOwner(owner)).toBe('Neelesh Ahankari')
    expect(formatSessionOwner({ email: 'admin@example.com' })).toBe('admin@example.com')
    expect(formatSessionOwner(null)).toBe('Unknown user')
  })
})
