import { describe, expect, it } from 'vitest'
import { brandingSchema, createWorkspaceSchema, effectiveWorkspaceFeature, logoSchema, slugSchema } from '../src/workspaces/contracts'
import { signToken, signWorkspaceToken, verifyToken, verifyWorkspaceToken } from '../src/lib/jwt'

const allowed = { workspaceActive: true, memberActive: true, tenantReady: true, platformAllowed: true,
  policy: { entitled: true, enabled: true, memberDefault: true } }
describe('workspace boundaries', () => {
  it('keeps identity and workspace tokens mutually exclusive', () => {
    const identity = signToken({ userId: 'a', email: 'a@example.test', role: 'ADMIN' })
    const workspace = signWorkspaceToken({ userId: 'a', workspaceId: 'one', membershipId: 'm' })
    expect(verifyToken(identity).userId).toBe('a')
    expect(verifyWorkspaceToken(workspace).workspaceId).toBe('one')
    expect(() => verifyToken(workspace)).toThrow()
    expect(() => verifyWorkspaceToken(identity)).toThrow()
    expect(() => verifyWorkspaceToken(workspace.slice(0, -5) + '12345')).toThrow()
  })
  it.each(['admin', 'personal', 'personal-abc', '../org', 'kls/vdit', '//evil.test', 'a', 'a--b'])('rejects reserved/unsafe slug %s', value => {
    expect(slugSchema.safeParse(value).success).toBe(false)
  })
  it('normalizes reusable workspace slugs and email addresses', () => {
    expect(createWorkspaceSchema.parse({ name: ' KLS VDIT ', slug: 'KLS-VDIT', ownerEmail: ' OWNER@example.test ' })).toMatchObject({ name: 'KLS VDIT', slug: 'kls-vdit', ownerEmail: 'owner@example.test' })
  })
  it('does not accept isolation, identity, role or placement through branding', () => {
    for (const field of ['isolationStage', 'databaseKey', 'storageMode', 'role', 'workspaceId', 'slug']) {
      expect(brandingSchema.safeParse({ [field]: 'TENANT_READY' }).success).toBe(false)
    }
    expect(brandingSchema.safeParse({ timeZone: 'not/a/zone' }).success).toBe(false)
  })
  it('rejects SVG, remote and oversized logos', () => {
    for (const logo of ['https://example.test/logo.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + Buffer.alloc(70000).toString('base64')]) expect(logoSchema.safeParse(logo).success).toBe(false)
  })
  it('each layer can deny access; a member override cannot bypass an entitlement or platform denial', () => {
    expect(effectiveWorkspaceFeature(allowed).allowed).toBe(true)
    expect(effectiveWorkspaceFeature({ ...allowed, tenantReady: false })).toEqual({ allowed: false, reason: 'WORKSPACE_ISOLATION_PENDING' })
    for (const field of ['workspaceActive', 'memberActive', 'platformAllowed'] as const) expect(effectiveWorkspaceFeature({ ...allowed, [field]: false, memberOverride: true }).allowed).toBe(false)
    expect(effectiveWorkspaceFeature({ ...allowed, policy: { ...allowed.policy, entitled: false }, memberOverride: true }).allowed).toBe(false)
    expect(effectiveWorkspaceFeature({ ...allowed, policy: { ...allowed.policy, enabled: false }, memberOverride: true }).allowed).toBe(false)
    expect(effectiveWorkspaceFeature({ ...allowed, memberOverride: false }).allowed).toBe(false)
  })
})
