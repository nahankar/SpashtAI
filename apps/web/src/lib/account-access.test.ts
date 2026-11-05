import { describe, expect, it } from 'vitest'
import { accountDestination, tenantAccountPath } from './account-access'

describe('tenant-only navigation', () => {
  it('redirects Personal destinations for a tenant-only identity', () => {
    for (const path of [null, '/', '/coach', '/replay/old', '/elevate', '/interviews', '/prepare', '/history', '/settings', '/workspaces-other', '/admin-other']) {
      expect(accountDestination({ tenantOnly: true }, path)).toBe('/workspaces')
    }
  })
  it('keeps organization and account-management destinations and ordinary Personal navigation', () => {
    for (const path of ['/workspaces', '/w/acme', '/w/acme/elevate', '/admin', '/admin/users', '/auth/complete-profile']) {
      expect(tenantAccountPath(path)).toBe(true)
      expect(accountDestination({ tenantOnly: true }, path)).toBe(path)
    }
    expect(accountDestination({ tenantOnly: false }, '/coach')).toBe('/coach')
    expect(accountDestination({}, null)).toBe('/')
  })
})
