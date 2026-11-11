import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config = vi.hoisted(() => {
  const url = process.env.INVITATION_LIMIT_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55443/spasht_invitation_limits_test') throw new Error('Use isolated policy test database')
  return { url, googleEmail: '', sent: [] as string[] }
})
vi.mock('../src/lib/prisma', async () => { const { PrismaClient } = await import('@prisma/client'); return { prisma: new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') }) } })
vi.mock('../src/lib/email', () => ({ sendEmail: vi.fn(async (input: { text: string }) => { config.sent.push(input.text); return { sent: true } }), buildPasswordResetEmail: vi.fn() }))
vi.mock('../src/lib/google-auth', () => ({ verifyGoogleIdToken: vi.fn(async () => ({ email: config.googleEmail, googleId: `google-${config.googleEmail}`, emailVerified: true, firstName: 'Test', lastName: null, avatar: null })) }))
vi.mock('../src/lib/pincode', async original => ({ ...await original<typeof import('../src/lib/pincode')>(), resolvePincodeLocation: async () => ({ city: 'Bengaluru', state: 'Karnataka', country: 'India' }) }))
import { prisma } from '../src/lib/prisma'
import { signToken, signWorkspaceToken, verifyToken } from '../src/lib/jwt'
import { workspaceRouter, platformWorkspacesRouter } from '../src/workspaces/routes'
import authRouter from '../src/routes/auth'
import platformRouter from '../src/routes/admin/platform'
import { accessPolicySchema, assertAccountSignIn, requireLearnerDomain } from '../src/lib/signInPolicy'
import { acceptInvitation } from '../src/lib/invitationAcceptance'
import { newToken } from '../src/lib/invitations'
const admin = new PrismaClient({ datasourceUrl: config.url }), tag = `policy_${randomUUID().replaceAll('-', '')}`
let seq = 0, original: { googleSignInEnabled: boolean; emailCodeSignInEnabled: boolean } | null = null
const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter); app.use('/api/admin/workspaces', platformWorkspacesRouter); app.use('/api/auth', authRouter)
app.use('/api/admin/platform', (req, _res, next) => { const raw = req.headers.authorization?.slice(7); if (raw) req.user = verifyToken(raw); next() }, platformRouter)
const emailOnly = { methods: { google: false, emailCode: true }, learnerEmailDomains: ['klsvdit.edu.in'] }
async function fixture() {
  const id = `${tag}_${seq++}`
  const make = (n: string, role: 'USER' | 'ADMIN' = 'USER') => admin.user.create({ data: { email: `${id}_${n}@example.invalid`, role, emailVerified: true, tenantOnly: n !== 'platform' } })
  const [owner, manager, learner, platform] = await Promise.all([make('owner'), make('manager'), make('learner'), make('platform', 'ADMIN')])
  const workspace = await admin.workspace.create({ data: { slug: id, name: 'Policy tenant', kind: 'ORGANIZATION', maxMembers: 50 } })
  const members = await Promise.all([owner, manager, learner].map((u, i) => admin.workspaceMember.create({ data: { userId: u.id, workspaceId: workspace.id, role: (['OWNER', 'ADMIN', 'LEARNER'] as const)[i], state: 'ACTIVE', acceptedAt: new Date() } })))
  const token = (u = owner, method: 'google' | 'emailCode' | 'invitation' = 'emailCode') => signToken({ userId: u.id, email: u.email, role: u.role, authMethod: method })
  return { workspace, owner, manager, learner, platform, members, token, workspaceToken: signWorkspaceToken({ userId: owner.id, workspaceId: workspace.id, membershipId: members[0].id, authMethod: 'emailCode' }), platformToken: token(platform) }
}
const change = (f: Awaited<ReturnType<typeof fixture>>, policy: unknown) => request(app).patch(`/api/admin/workspaces/${f.workspace.id}`).set('Authorization', `Bearer ${f.platformToken}`).send({ accessPolicy: policy })
describe.skipIf(!config.url)('tenant domain and authentication policy (restricted database)', () => {
  beforeAll(async () => {
    process.env.WORKSPACES_ENABLED = 'true'; process.env.DISABLE_AUTH_RATE_LIMIT = 'true'
    await prepareWorkspaceTestRole(admin)
    const settings = await admin.platformSettings.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} })
    original = { googleSignInEnabled: settings.googleSignInEnabled, emailCodeSignInEnabled: settings.emailCodeSignInEnabled }
  })
  afterAll(async () => {
    if (original) await admin.platformSettings.update({ where: { id: 'default' }, data: original })
    await admin.workspace.deleteMany({ where: { slug: { startsWith: tag } } }); const users = await admin.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    await admin.adminAction.deleteMany({ where: { adminId: { in: users.map(u => u.id) } } }); await admin.emailSignInCode.deleteMany({ where: { email: { startsWith: tag } } }); await admin.user.deleteMany({ where: { email: { startsWith: tag } } }); await prisma.$disconnect(); await admin.$disconnect()
  })
  it('validates exact normalized domains and requires one method', () => {
    expect(accessPolicySchema.parse({ ...emailOnly, learnerEmailDomains: ['KLSVDIT.EDU.IN', 'klsvdit.edu.in'] }).learnerEmailDomains).toEqual(['klsvdit.edu.in'])
    for (const domain of ['@klsvdit.edu.in', '*.klsvdit.edu.in', 'https://klsvdit.edu.in', '-bad.edu.in']) expect(accessPolicySchema.safeParse({ ...emailOnly, learnerEmailDomains: [domain] }).success).toBe(false)
    expect(accessPolicySchema.safeParse({ ...emailOnly, methods: { google: false, emailCode: false } }).success).toBe(false)
    expect(() => requireLearnerDomain(emailOnly, 'user@klsvdit.edu.in.evil.test', 'LEARNER')).toThrow()
    expect(() => requireLearnerDomain(emailOnly, 'user@sub.klsvdit.edu.in', 'LEARNER')).toThrow()
    expect(() => requireLearnerDomain(emailOnly, 'user@external.test', 'OWNER')).not.toThrow()
  })
  it('allows platform and tenant managers to save policies, denies learners, and returns a bounded public projection', async () => {
    const f = await fixture(); expect((await change(f, emailOnly)).status).toBe(200)
    const publicPolicy = await request(app).get(`/api/auth/sign-in-policy?workspace=${f.workspace.slug}`)
    expect(publicPolicy.status, publicPolicy.text).toBe(200); expect(publicPolicy.body).toEqual({ methods: emailOnly.methods, workspace: { name: f.workspace.name, slug: f.workspace.slug }, learnerEmailDomains: ['klsvdit.edu.in'] })
    const valid = { ...emailOnly, methods: { google: true, emailCode: false } }
    expect((await request(app).put('/api/workspaces/current/access-policy').set('Authorization', `Bearer ${f.workspaceToken}`).send(valid)).status).toBe(200)
    const learnerToken = signWorkspaceToken({ userId: f.learner.id, workspaceId: f.workspace.id, membershipId: f.members[2].id, authMethod: 'google' })
    expect((await request(app).put('/api/workspaces/current/access-policy').set('Authorization', `Bearer ${learnerToken}`).send(emailOnly)).status).toBe(403)
    expect((await change(f, { ...emailOnly, methods: { google: false, emailCode: false } })).status).toBe(400)
  })
  it('rejects new off-domain Learners while preserving existing members and exempting future managers', async () => {
    const f = await fixture(); await change(f, emailOnly)
    const invite = (email: string, role = 'LEARNER') => request(app).post('/api/workspaces/current/invitations').set('Authorization', `Bearer ${f.workspaceToken}`).send({ email, role })
    expect((await invite(`${tag}_new@example.invalid`)).body.code).toBe('EMAIL_DOMAIN_NOT_ALLOWED')
    expect((await invite(`${tag}_student@klsvdit.edu.in`)).status).toBe(200)
    expect((await invite(`${tag}_newadmin@example.invalid`, 'ADMIN')).status).toBe(200)
    expect((await invite(`${tag}_newowner@example.invalid`, 'OWNER')).status).toBe(200)
    expect((await request(app).post(`/api/workspaces/entry/${f.workspace.slug}`).set('Authorization', `Bearer ${f.token(f.learner)}`)).status).toBe(200)
    expect(await admin.workspaceMember.count({ where: { workspaceId: f.workspace.id } })).toBe(3)
  })
  it('enforces the tenant method on generic login, tenant entry, and code verification after a setting changes', async () => {
    const f = await fixture(); await change(f, emailOnly)
    config.googleEmail = f.learner.email
    expect((await request(app).post('/api/auth/google').send({ credential: 'test' })).status).toBe(403)
    expect((await request(app).post(`/api/workspaces/entry/${f.workspace.slug}`).set('Authorization', `Bearer ${f.token(f.learner, 'google')}`)).status).toBe(401)
    const sent = await request(app).post('/api/auth/email-code/request').send({ email: f.learner.email, workspaceSlug: f.workspace.slug })
    expect(sent.status, sent.text).toBe(200); const code = config.sent.at(-1)!.match(/code is: (\d{6})/)![1]
    await change(f, { ...emailOnly, methods: { google: true, emailCode: false } })
    expect((await request(app).post('/api/auth/email-code/verify').send({ challengeId: sent.body.challengeId, code })).status).toBe(403)
    expect((await request(app).post('/api/auth/email-code/request').send({ email: f.learner.email })).status).toBe(403)
    await change(f, emailOnly)
    await expect(assertAccountSignIn('uninvited@example.invalid', 'emailCode', f.workspace.slug)).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' })
  })
  it('keeps main-site policy independent and prevents forged tenant context from bypassing it', async () => {
    const f = await fixture(); await change(f, emailOnly)
    const saved = await request(app).put('/api/admin/platform/sign-in').set('Authorization', `Bearer ${f.platformToken}`).send({ google: true, emailCode: false })
    expect(saved.status, saved.text).toBe(200)
    expect((await request(app).put('/api/admin/platform/sign-in').set('Authorization', `Bearer ${f.platformToken}`).send({ google: false, emailCode: false })).status).toBe(400)
    expect((await request(app).get('/api/auth/sign-in-policy')).body.methods).toEqual({ google: true, emailCode: false })
    await expect(assertAccountSignIn('new@example.invalid', 'emailCode')).rejects.toMatchObject({ code: 'SIGN_IN_METHOD_DISABLED' })
    await expect(assertAccountSignIn('new@example.invalid', 'emailCode', f.workspace.slug)).rejects.toMatchObject({ code: 'INVITATION_REQUIRED' })
    await expect(assertAccountSignIn(f.learner.email, 'emailCode')).resolves.toBeUndefined()
  })
  it('rechecks an older pending invitation at acceptance and still permits one-time invitation joining without another code', async () => {
    const f = await fixture(), raw = newToken()
    const inv = await admin.userInvitation.create({ data: { workspaceId: f.workspace.id, email: `${tag}_oldinvite@example.invalid`, proposedRole: 'LEARNER', memberFeatures: {}, pendingKey: `${tag}_old`, tokenHash: raw.tokenHash, expiresAt: new Date(Date.now() + 3600000), invitedById: f.owner.id } })
    await change(f, emailOnly)
    const basic = { phone: '9876543210', dateOfBirth: new Date('1999-05-25'), gender: 'MALE' as const, pincode: '560001', city: 'Bengaluru', state: 'Karnataka', country: 'India' }
    const req = { body: {}, headers: {}, ip: '127.0.0.1' } as express.Request
    const denied = await acceptInvitation(inv, null, req, basic); expect(denied).toMatchObject({ ok: false, status: 403 })
    const allowed = newToken()
    const valid = await admin.userInvitation.create({ data: { workspaceId: f.workspace.id, email: `${tag}_oldinvite@klsvdit.edu.in`, proposedRole: 'LEARNER', memberFeatures: {}, pendingKey: `${tag}_allowed`, tokenHash: allowed.tokenHash, expiresAt: new Date(Date.now() + 3600000), invitedById: f.owner.id } })
    const accepted = await acceptInvitation(valid, null, req, basic); expect(accepted).toMatchObject({ ok: true, newAccount: true })
    expect((await acceptInvitation(valid, null, req, basic))).toMatchObject({ ok: false, status: 401 })
  })
})
