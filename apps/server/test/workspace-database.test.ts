import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import supertest from 'supertest'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'

// This test can never touch Claude's local database or production.
const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && !['postgresql://postgres@127.0.0.1:55443/postgres', 'postgresql://postgres@127.0.0.1:55443/spasht_filters_test'].includes(url)) throw new Error('Use the dedicated tenancy container and an approved test database on port 55443')
const suite = url ? describe : describe.skip
suite('workspace database and API isolation', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const adminDb = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  let db: PrismaClient
  let api: ReturnType<typeof supertest>
  let owner = '', learner = '', outsider = '', platformAdmin = '', unverified = ''
  let alpha = '', beta = '', ownerToken = '', learnerToken = '', betaToken = ''
  const tokens: Record<string, string> = {}
  async function identity(userId: string) { return tokens[userId] }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
  async function entry(slug: string, userId: string) {
    return api.post(`/api/workspaces/entry/${slug}`).set(bearer(await identity(userId)))
  }
  async function accept(slug: string, userId: string) {
    return api.post(`/api/workspaces/entry/${slug}/accept`).set(bearer(await identity(userId)))
  }
  beforeAll(async () => {
    await prepareWorkspaceTestRole(adminDb)
    process.env.DATABASE_URL = url!.replace('postgresql://postgres@', 'postgresql://tenancy_test_app@')
    process.env.WORKSPACES_ENABLED = 'true'
    const module = await import('../src/lib/prisma'); db = module.prisma
    const routes = await import('../src/workspaces/routes')
    const app = express(); app.use(express.json()); app.use('/api/workspaces', routes.workspaceRouter); app.use('/api/admin/workspaces', routes.platformWorkspacesRouter)
    api = supertest(app)
    const tag = Date.now().toString(36)
    const make = async (suffix: string, role: 'USER' | 'ADMIN' = 'USER', emailVerified = true) => {
      const user = await adminDb.user.create({ data: { email: `${tag}-${suffix}@example.test`, role, emailVerified } })
      tokens[user.id] = signToken({ userId: user.id, email: user.email, role })
      return user.id
    }
    platformAdmin = await make('platform', 'ADMIN'); owner = await make('owner'); learner = await make('learner'); outsider = await make('outsider'); unverified = await make('unverified', 'USER', false)
  }, 30000)
  afterAll(async () => {
    const ids = [owner, learner, outsider, platformAdmin, unverified].filter(Boolean)
    await adminDb.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta] } }, { personalOwnerId: { in: ids } }] } })
    await adminDb.user.deleteMany({ where: { id: { in: ids } } })
    await db?.$disconnect(); await adminDb.$disconnect()
    delete process.env.WORKSPACES_ENABLED
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl
  })
  it('fails closed with no actor, and creates only the current identity Personal workspace', async () => {
    expect(await db.workspace.findMany()).toEqual([])
    await expect(db.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Forbidden', slug: 'unscoped-write' } })).rejects.toThrow()
    const response = await api.get('/api/workspaces').set(bearer(await identity(owner)))
    expect(response.status).toBe(200)
    expect(response.body).toHaveLength(1)
    expect(response.body[0]).toMatchObject({ kind: 'PERSONAL', name: 'Personal', path: '/coach' })
    expect(await db.workspace.findMany()).toEqual([]) // pooled transaction context did not leak
  })
  it('only current platform Admin can create reusable organization records', async () => {
    const email = (await adminDb.user.findUniqueOrThrow({ where: { id: owner } })).email
    expect((await api.post('/api/admin/workspaces').set(bearer(await identity(owner))).send({ name: 'Wrong', slug: 'wrong-org', ownerEmail: email })).status).toBe(403)
    const tag = Date.now().toString(36)
    for (const name of ['alpha', 'beta']) {
      const response = await api.post('/api/admin/workspaces').set(bearer(await identity(platformAdmin))).send({ name, slug: `${name}-${tag}`, ownerEmail: email })
      expect(response.status, JSON.stringify(response.body)).toBe(200)
      expect(response.body).toMatchObject({ emailSent: false, ownerMembershipState: 'INVITED', workspace: { isolationStage: 'FOUNDATION_ONLY' } })
      if (name === 'alpha') alpha = response.body.workspace.id; else beta = response.body.workspace.id
    }
    await expect(adminDb.user.delete({ where: { id: owner } })).rejects.toThrow()
    const staleAdmin = signToken({ userId: outsider, email: 'x@example.test', role: 'ADMIN' })
    expect((await api.get('/api/admin/workspaces').set(bearer(staleAdmin))).status).toBe(403)
  })
  it('path is only an entry point; membership acceptance belongs to the invited identity', async () => {
    const a = await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })
    expect((await entry(a.slug, outsider)).status).toBe(404)
    const invited = await entry(a.slug, owner)
    expect(invited.body.accessToken).toBeNull()
    expect((await accept(a.slug, outsider)).status).toBe(404)
    expect((await accept(a.slug, owner)).status).toBe(200)
    ownerToken = (await entry(a.slug, owner)).body.accessToken
    const b = await adminDb.workspace.findUniqueOrThrow({ where: { id: beta } })
    await accept(b.slug, owner); betaToken = (await entry(b.slug, owner)).body.accessToken
  })
  it('workspace tokens cannot call identity or platform routes, nor vice versa', async () => {
    expect((await api.get('/api/workspaces').set(bearer(ownerToken))).status).toBe(401)
    expect((await api.get('/api/admin/workspaces').set(bearer(ownerToken))).status).toBe(401)
    expect((await api.get('/api/workspaces/current').set(bearer(await identity(owner)))).status).toBe(401)
    const response = await api.get('/api/workspaces/current').set(bearer(ownerToken))
    expect(response.body.workspace.id).toBe(alpha)
    expect(response.body.features.every((f: { allowed: boolean }) => f.allowed === false)).toBe(true)
    expect(JSON.stringify(response.body)).not.toContain('databaseKey')
  })
  it('enforces last Owner, immutable isolation, platform entitlements and cross-tenant member IDs', async () => {
    const a = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: owner } })
    const b = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: beta, userId: owner } })
    expect((await api.patch(`/api/workspaces/current/members/${a.id}`).set(bearer(ownerToken)).send({ state: 'SUSPENDED' })).body.code).toBe('LAST_OWNER')
    expect((await api.patch(`/api/workspaces/current/members/${b.id}`).set(bearer(ownerToken)).send({ state: 'SUSPENDED' })).status).toBe(404)
    expect((await api.patch('/api/workspaces/current/branding').set(bearer(ownerToken)).send({ isolationStage: 'TENANT_READY' })).status).toBe(400)
    expect((await api.put('/api/workspaces/current/features/interviews').set(bearer(ownerToken)).send({ enabled: true, memberDefault: true })).status).toBe(403)
    expect((await api.patch('/api/workspaces/current/branding').set(bearer(betaToken)).send({ name: 'Beta changed' })).status).toBe(200)
    expect((await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })).name).toBe('alpha')
  })
  it('adds a verified learner pending acceptance, checks seats and rejects unverified accounts', async () => {
    const u = await adminDb.user.findUniqueOrThrow({ where: { id: unverified } })
    expect((await api.post('/api/workspaces/current/members').set(bearer(ownerToken)).send({ email: u.email, role: 'LEARNER' })).body.code).toBe('VERIFIED_ACCOUNT_REQUIRED')
    const email = (await adminDb.user.findUniqueOrThrow({ where: { id: learner } })).email
    expect((await api.post('/api/workspaces/current/members').set(bearer(ownerToken)).send({ email, role: 'LEARNER' })).status).toBe(200)
    const membership = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: learner } })
    expect((await api.patch(`/api/workspaces/current/members/${membership.id}`).set(bearer(ownerToken)).send({ state: 'ACTIVE' })).body.code).toBe('MEMBER_ACCEPTANCE_REQUIRED')
    expect((await api.patch(`/api/admin/workspaces/${alpha}`).set(bearer(await identity(platformAdmin))).send({ limits: { maxMembers: 1, dailyEvaluations: 30, concurrentVoice: 2 } })).status).toBe(409)
    const workspace = await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })
    await accept(workspace.slug, learner); learnerToken = (await entry(workspace.slug, learner)).body.accessToken
    expect((await api.get('/api/workspaces/current/members').set(bearer(learnerToken))).status).toBe(403)
    expect((await api.patch('/api/workspaces/current/branding').set(bearer(learnerToken)).send({ name: 'Hack' })).status).toBe(403)
  })
  it('enforces RLS and composite tenant references below the API', async () => {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.workspace_actor_id', ${learner}, true), set_config('app.workspace_id', ${alpha}, true)`
      expect((await tx.workspace.findMany()).map(w => w.id)).toEqual([alpha])
      expect(await tx.workspaceMember.findMany({ where: { workspaceId: beta } })).toEqual([])
      expect(await tx.workspaceFeature.findMany({ where: { workspaceId: beta } })).toEqual([])
      await expect(tx.workspaceFeature.update({ where: { workspaceId_feature: { workspaceId: beta, feature: 'coach' } }, data: { entitled: true } })).rejects.toThrow()
    })
    const b = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: beta, userId: owner } })
    await expect(adminDb.workspaceMemberFeature.create({ data: { workspaceId: alpha, memberId: b.id, feature: 'coach', allowed: true } })).rejects.toThrow()
  })
  it('retains the foundation gate even when all entitlement settings allow a feature', async () => {
    expect((await api.put(`/api/admin/workspaces/${alpha}/features/coach`).set(bearer(await identity(platformAdmin))).send({ entitled: true, enabled: true, memberDefault: true })).status).toBe(200)
    const response = await api.get('/api/workspaces/current').set(bearer(learnerToken))
    expect(response.body.features.find((f: { feature: string }) => f.feature === 'coach')).toMatchObject({ allowed: false, reason: 'WORKSPACE_ISOLATION_PENDING' })
  })
  it('rejects a token after suspension and deletion/re-enrollment', async () => {
    const member = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: learner } })
    await api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(ownerToken)).send({ state: 'SUSPENDED' })
    expect((await api.get('/api/workspaces/current').set(bearer(learnerToken))).status).toBe(403)
    await adminDb.workspaceMember.delete({ where: { id: member.id } })
    const replacement = await adminDb.workspaceMember.create({ data: { workspaceId: alpha, userId: learner, state: 'ACTIVE', role: 'LEARNER', acceptedAt: new Date() } })
    expect((await api.get('/api/workspaces/current').set(bearer(learnerToken))).status).toBe(403)
    const fresh = signWorkspaceToken({ userId: learner, workspaceId: alpha, membershipId: replacement.id })
    expect((await api.get('/api/workspaces/current').set(bearer(fresh))).status).toBe(200)
  })
  it('keeps workspace Admin powers scoped and never changes global identity roles', async () => {
    const member = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: learner } })
    expect((await api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(ownerToken)).send({ role: 'ADMIN' })).status).toBe(200)
    const workspace = await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })
    const token = (await entry(workspace.slug, learner)).body.accessToken
    expect((await api.patch('/api/workspaces/current/branding').set(bearer(token)).send({ name: 'Alpha team' })).status).toBe(200)
    expect((await api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(token)).send({ role: 'OWNER' })).status).toBe(403)
    expect((await api.get('/api/admin/workspaces').set(bearer(await identity(learner)))).status).toBe(403)
    expect((await adminDb.user.findUniqueOrThrow({ where: { id: learner } })).role).toBe('USER')
    await api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(ownerToken)).send({ role: 'LEARNER' })
  })
  it('lets an Owner restrict a member but not grant an unentitled feature', async () => {
    const member = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: learner } })
    const path = `/api/workspaces/current/members/${member.id}/features/coach`
    expect((await api.put(path).set(bearer(ownerToken)).send({ allowed: false })).status).toBe(200)
    const workspace = await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })
    const token = (await entry(workspace.slug, learner)).body.accessToken
    const state = await api.get('/api/workspaces/current').set(bearer(token))
    expect(state.body.features.find((f: { feature: string }) => f.feature === 'coach').reason).toBe('MEMBER_DISABLED')
    expect((await api.put(path).set(bearer(ownerToken)).send({ allowed: null })).status).toBe(200)
    expect((await api.put(`/api/workspaces/current/members/${member.id}/features/interviews`).set(bearer(ownerToken)).send({ allowed: true })).status).toBe(403)
    expect(await db.workspace.findMany()).toEqual([])
  })
  it('revokes active access immediately when the workspace is suspended', async () => {
    await api.patch(`/api/admin/workspaces/${alpha}`).set(bearer(await identity(platformAdmin))).send({ state: 'SUSPENDED' })
    expect((await api.get('/api/workspaces/current').set(bearer(ownerToken))).status).toBe(403)
    await api.patch(`/api/admin/workspaces/${alpha}`).set(bearer(await identity(platformAdmin))).send({ state: 'ACTIVE' })
    expect((await api.get('/api/workspaces/current').set(bearer(ownerToken))).status).toBe(200)
  })
  it('refuses workspace traffic when the database bypasses RLS', async () => {
    const query = vi.spyOn(db, '$queryRaw').mockResolvedValueOnce([{ bypass: true }])
    try { expect((await api.get('/api/workspaces').set(bearer(await identity(owner)))).body.code).toBe('WORKSPACE_DATABASE_ROLE_UNSAFE') }
    finally { query.mockRestore() }
  })
  it('serializes seat allocation under concurrent enrollment', async () => {
    await adminDb.user.update({ where: { id: unverified }, data: { emailVerified: true } })
    await api.patch(`/api/admin/workspaces/${alpha}`).set(bearer(await identity(platformAdmin))).send({ limits: { maxMembers: 3, dailyEvaluations: 30, concurrentVoice: 2 } })
    const users = await adminDb.user.findMany({ where: { id: { in: [outsider, unverified] } } })
    const responses = await Promise.all(users.map(user => api.post('/api/workspaces/current/members').set(bearer(ownerToken)).send({ email: user.email, role: 'LEARNER' })))
    expect(responses.map(r => r.status).sort()).toEqual([200, 409])
    expect(await adminDb.workspaceMember.count({ where: { workspaceId: alpha, state: { not: 'SUSPENDED' } } })).toBe(3)
    await adminDb.workspaceMember.deleteMany({ where: { workspaceId: alpha, userId: { in: [outsider, unverified] } } })
    await api.patch(`/api/admin/workspaces/${alpha}`).set(bearer(await identity(platformAdmin))).send({ limits: { maxMembers: 25, dailyEvaluations: 30, concurrentVoice: 2 } })
  })
  it('does not let platform account deletion strand an organization', async () => {
    await expect(adminDb.user.delete({ where: { id: owner } })).rejects.toThrow()
    expect(await adminDb.user.findUnique({ where: { id: owner } })).not.toBeNull()
  })
  it('serializes concurrent last-Owner changes', async () => {
    const member = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: learner } })
    const first = await adminDb.workspaceMember.findFirstOrThrow({ where: { workspaceId: alpha, userId: owner } })
    await api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(ownerToken)).send({ role: 'OWNER' })
    const workspace = await adminDb.workspace.findUniqueOrThrow({ where: { id: alpha } })
    const secondToken = (await entry(workspace.slug, learner)).body.accessToken
    const responses = await Promise.all([
      api.patch(`/api/workspaces/current/members/${first.id}`).set(bearer(ownerToken)).send({ state: 'SUSPENDED' }),
      api.patch(`/api/workspaces/current/members/${member.id}`).set(bearer(secondToken)).send({ state: 'SUSPENDED' }),
    ])
    expect(responses.filter(r => r.status === 200)).toHaveLength(1)
    expect(await adminDb.workspaceMember.count({ where: { workspaceId: alpha, role: 'OWNER', state: 'ACTIVE' } })).toBe(1)
  })
  it('fails closed when rollout is disabled', async () => {
    process.env.WORKSPACES_ENABLED = 'false'
    expect((await api.get('/api/workspaces').set(bearer(await identity(owner)))).status).toBe(404)
    process.env.WORKSPACES_ENABLED = 'true'
  })
})
