import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from '@/components/admin/Sidebar'
import { TenantDemoProvider } from '@/contexts/TenantDemoContext'
import { clearTenantDemo, isDemoPath, readDemo, writeDemo } from './tenantDemo'
import { sampleInvitationList, sampleInvitations, sampleLearners } from './tenantDemoSample'

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  })
})
afterEach(() => vi.unstubAllGlobals())

const sidebar = (userId = 'admin-1') => renderToStaticMarkup(
  <MemoryRouter initialEntries={['/admin']}><TenantDemoProvider userId={userId}><Sidebar /></TenantDemoProvider></MemoryRouter>,
)

describe('Tenant Admin demo navigation', () => {
  it('is off by default and shows the full Admin navigation', () => {
    const html = sidebar()
    expect(html).toContain('Tenant Admin demo')
    expect(html).toContain('aria-checked="false"')
    expect(html).toContain('Health')
    expect(html).toContain('Pricing')
    expect(html).toContain('Invitations')
  })

  it('shows only Overview (Dashboard, Users, Invitations) and the four analytics pages when on', () => {
    writeDemo({ userId: 'admin-1', on: true, data: 'sample' })
    const html = sidebar()
    expect(html).toContain('aria-checked="true"')
    expect(html).toContain('Tenant Admin (demo)')
    for (const label of ['Dashboard', 'Users', 'Invitations', 'Feature Usage', 'Progress Pulse', 'AI Analytics', 'UX Analytics']) expect(html).toContain(label)
    for (const label of ['System', 'Administration', 'Health', 'Voice Backend', 'Feature Flags', 'Pricing', 'Legal', 'Feedback']) expect(html).not.toContain(`>${label}<`)
  })

  it('belongs to the signed-in user and is cleared on logout', () => {
    writeDemo({ userId: 'admin-1', on: true, data: 'live' })
    expect(readDemo('admin-2')).toBeNull()
    expect(sidebar('admin-2')).toContain('aria-checked="false"')
    clearTenantDemo()
    expect(readDemo('admin-1')).toBeNull()
  })

  it('treats only demo sections as reachable', () => {
    for (const path of ['/admin', '/admin/', '/admin/users', '/admin/users/abc', '/admin/invitations', '/admin/analytics', '/admin/analytics/explorer', '/admin/progress-pulse', '/admin/ux-analytics']) {
      expect(isDemoPath(path)).toBe(true)
    }
    for (const path of ['/admin/system', '/admin/feedback', '/admin/features', '/admin/pricing', '/admin/legal', '/admin/interview-bank', '/admin/usersx']) {
      expect(isDemoPath(path)).toBe(false)
    }
  })
})

describe('Tenant Admin demo sample data', () => {
  it('is fictional, labelled and uses reserved example addresses', () => {
    expect(sampleInvitations().every((inv) => inv.sample && inv.email.endsWith('@example.com'))).toBe(true)
    expect(sampleLearners().every((l) => l.name.startsWith('Sample Learner') && l.email.endsWith('@example.com'))).toBe(true)
  })

  it('keeps delivery separate from status and filters like the server list', () => {
    const pending = sampleInvitationList({ status: 'pending' })
    expect(pending.items.some((inv) => inv.deliveryStatus === 'FAILED')).toBe(true)
    expect(pending.items.every((inv) => inv.status === 'pending')).toBe(true)
    expect(pending.counts).toEqual({ pending: 4, accepted: 6, expired: 2, revoked: 1 })
    expect(sampleInvitationList({ q: 'meera' }).items).toHaveLength(1)
    const paged = sampleInvitationList({ page: 2, pageSize: 5 })
    expect(paged.items).toHaveLength(5)
    expect(paged.totalPages).toBe(3)
  })
})
