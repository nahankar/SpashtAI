import { describe, expect, it } from 'vitest'
import type { Feature } from '../client'
import { canManage, filterQuery, planSummary, unavailableReason, workspaceNav } from './model'

const feature = (name: string, change: Partial<Feature> = {}): Feature => ({ feature: name, entitled: true, enabled: true, memberDefault: true, allowed: true, ready: true, ...change })

describe('workspace navigation', () => {
  it('shows learners only the products their own decisions allow, and no administration', () => {
    const nav = workspaceNav('LEARNER', [feature('elevate'), feature('replay', { allowed: false }), feature('interviews'), feature('coach'), feature('progress_pulse', { allowed: false })])
    expect(nav.learner.map(i => i.to)).toEqual(['elevate', 'interviews'])
    expect(nav.admin).toEqual([])
  })

  it('gives Owners and Admins the full workspace administration, independent of product access', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const nav = workspaceNav(role, [])
      expect(nav.learner).toEqual([])
      expect(nav.admin.map(i => i.label)).toEqual(['Dashboard', 'Users', 'Invitations', 'Feedback', 'Feature usage', 'Progress Pulse', 'AI Analytics', 'Workspace settings'])
      expect(nav.admin.every(item => item.to.startsWith('admin'))).toBe(true)
    }
  })

  it('explains why a product is unavailable in the order the server decides it', () => {
    expect(unavailableReason(undefined)).toMatch(/not offered/)
    expect(unavailableReason(feature('replay', { ready: false, allowed: false }))).toMatch(/not yet available/)
    expect(unavailableReason(feature('replay', { entitled: false, allowed: false }))).toMatch(/plan/)
    expect(unavailableReason(feature('replay', { enabled: false, allowed: false }))).toMatch(/turned this product on/)
    expect(unavailableReason(feature('replay', { allowed: false }))).toMatch(/administrator/)
  })

  it('lets Admins manage learners only, and Owners everyone', () => {
    expect(canManage('ADMIN', 'LEARNER')).toBe(true)
    expect(canManage('ADMIN', 'ADMIN')).toBe(false)
    expect(canManage('ADMIN', 'OWNER')).toBe(false)
    expect(canManage('OWNER', 'OWNER')).toBe(true)
  })
})

describe('analytics filters', () => {
  it('sends only the filters chosen, never empty values', () => {
    expect(filterQuery({ days: 30 })).toBe('days=30')
    expect(filterQuery({ days: 7, learner: 'm-1', product: 'replay', skill: undefined })).toBe('days=7&learner=m-1&product=replay')
  })

  it('summarises a plan without exposing a learner identity it was not given', () => {
    const plan = { version: 1 as const, title: 'T', report: 'learner_activity' as const, days: 14, product: 'elevate', skill: null, explanation: 'E', learnerMemberId: 'm-9' }
    expect(planSummary(plan)).toBe('Learner activity · last 14 days · Elevate · one learner')
    expect(planSummary(plan, 'Asha')).toBe('Learner activity · last 14 days · Elevate · Asha')
  })
})
