import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { readFile } from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'
import { prepareWorkspaceTestRole } from './workspace-test-role'

const config = vi.hoisted(() => {
  const url = process.env.EMAIL_CODE_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55445/postgres') throw new Error('Use the isolated email-code test database')
  return { url, paused: false, sent: true, mails: [] as { to: string; text: string; logBody: boolean }[] }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  const { createScopedPrisma } = await import('../src/lib/scopedPrisma')
  return { prisma: createScopedPrisma(new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') })) }
})
vi.mock('../src/lib/email', () => ({
  sendEmail: vi.fn(async (mail) => { config.mails.push(mail); return { sent: config.sent } }),
  buildPasswordResetEmail: vi.fn(),
}))
vi.mock('../src/lib/platformSettings', () => ({
  areSignupsPaused: async () => config.paused,
  getSignupsPausedMessage: async () => 'Paused',
  areRewardPointsEnabled: async () => false,
}))
vi.mock('../src/lib/pincode', async (original) => ({
  ...await original<typeof import('../src/lib/pincode')>(),
  resolvePincodeLocation: async () => ({ city: 'Bengaluru', state: 'Karnataka', country: 'India' }),
}))
vi.mock('../src/lib/google-auth', () => ({
  verifyGoogleIdToken: async (credential: string) => ({ email: credential, googleId: `google-${credential}`, emailVerified: true, firstName: null, lastName: null, avatar: null }),
}))
import { prisma } from '../src/lib/prisma'
import { enforceTenantOnlyAccess } from '../src/middleware/tenantOnly'
import { bindWorkspaceRequest } from '../src/workspaces/requestScope'
import { listMyWorkspaces, acceptWorkspaceMembership, enterWorkspace } from '../src/workspaces/service'
import { withWorkspaceAccess } from '../src/workspaces/context'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
import { SessionSubscriptions, canSubscribeToPersonalSession } from '../src/lib/sessionSubscriptions'
import { WebSocket } from 'ws'
import authRouter from '../src/routes/auth'
import invitationRouter from '../src/routes/invitations'
import { hashInvitationToken } from '../src/lib/invitations'
import { consumeEmailSignInCode, normalizeSignInEmail, requestEmailSignInCode } from '../src/lib/emailSignIn'

const app = express(); app.use(express.json()); app.use(bindWorkspaceRequest, enforceTenantOnlyAccess); app.use('/api/auth', authRouter); app.use('/api/invitations', invitationRouter)
app.get('/sessions/:id', async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.id }, select: { id: true } })
  res.status(session ? 200 : 404).json({ session })
})
app.get('/api/replay', (_req, res) => res.json({ productReached: true }))
app.post('/livekit/dispatch', (_req, res) => res.json({ productReached: true }))
const admin = new PrismaClient({ datasourceUrl: config.url })
const tag = `emailcode_${randomUUID().replaceAll('-', '')}`
let sequence = 0
const addr = () => `${tag}_${sequence++}@example.invalid`
const profile = { phone: '9876543210', dateOfBirth: '1995-06-15', gender: 'FEMALE', pincode: '560001' }
const codeFor = (email: string) => config.mails.filter(mail => mail.to === email).at(-1)!.text.match(/code is: (\d{6})/)![1]
const verify = (challengeId: string, code: string, extra = {}) => request(app).post('/api/auth/email-code/verify').send({ challengeId, code, ...extra })
async function invite(email: string) {
  const inviter = await admin.user.upsert({ where: { email: `${tag}_admin@example.invalid` }, create: { email: `${tag}_admin@example.invalid`, role: 'ADMIN' }, update: {} })
  const token = randomUUID()
  const row = await admin.userInvitation.create({ data: { email, invitedById: inviter.id, tokenHash: hashInvitationToken(token), expiresAt: new Date(Date.now() + 60_000), pendingKey: email } })
  return { token, row }
}

describe.skipIf(!config.url)('email sign-in and invitation codes (isolated PostgreSQL)', () => {
  beforeAll(async () => { await prepareWorkspaceTestRole(admin); process.env.WORKSPACES_ENABLED = 'true' })
  beforeEach(() => { config.paused = false; config.sent = true; config.mails.length = 0 })
  afterAll(async () => {
    await admin.userInvitation.deleteMany({ where: { email: { startsWith: tag } } })
    await admin.workspace.deleteMany({ where: { slug: { startsWith: tag } } })
    const users = await admin.user.findMany({ where: { email: { startsWith: tag } }, select: { id: true } })
    await admin.adminAction.deleteMany({ where: { adminId: { in: users.map(user => user.id) } } })
    await admin.user.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.$executeRaw`DELETE FROM "EmailSignInCode" WHERE "email" LIKE ${`${tag}%`}`
    await prisma.$disconnect(); await admin.$disconnect()
  })

  it('normalizes email and rejects malformed input', async () => {
    expect(normalizeSignInEmail(' Person@Example.com ')).toBe('person@example.com')
    for (const email of [null, {}, 'a\nb@example.com', 'not-email', 'a@example.com,b@example.com']) {
      const res = await request(app).post('/api/auth/email-code/request').send({ email })
      expect(res.status).toBe(400)
    }
  })

  it('creates no account on send, stores no plaintext code, and requires a profile before signup', async () => {
    const email = addr()
    const sent = await request(app).post('/api/auth/email-code/request').send({ email })
    expect(sent.status).toBe(200); expect(sent.headers['cache-control']).toBe('no-store')
    expect(sent.body).not.toHaveProperty('code')
    expect(config.mails[0].logBody).toBe(false)
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    const rows = await prisma.$queryRaw<{ codeHash: string }[]>`SELECT "codeHash" FROM "EmailSignInCode" WHERE "email" = ${email}`
    expect(rows[0].codeHash).toHaveLength(64); expect(rows[0].codeHash).not.toBe(codeFor(email))
    expect((await verify(sent.body.challengeId, codeFor(email))).body.error).toBe('PROFILE_REQUIRED')
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
  })

  it('creates a verified email account, resolves location and preserves its identity when Google is later linked', async () => {
    const email = addr(), sent = await requestEmailSignInCode(email)
    const result = await verify(sent.challengeId, codeFor(email), profile)
    expect(result.status).toBe(200); expect(result.body.token).toBeTruthy()
    const user = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(user).toMatchObject({ googleId: null, emailVerified: true, role: 'USER', city: 'Bengaluru' })
    const google = await request(app).post('/api/auth/google').send({ credential: email })
    expect(google.status).toBe(200); expect(google.body.user.id).toBe(user.id)
    expect((await verify(sent.challengeId, codeFor(email), profile)).status).toBe(401)
  })

  it('signs into an existing Google account without changing its role, Google identity or permissions', async () => {
    const email = addr()
    const user = await prisma.user.create({ data: { email, googleId: `google-${email}`, role: 'ADMIN', enableUltra: false } })
    const sent = await requestEmailSignInCode(email)
    const result = await verify(sent.challengeId, codeFor(email))
    expect(result.status).toBe(200); expect(result.body.user.id).toBe(user.id)
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({ googleId: user.googleId, role: 'ADMIN', enableUltra: false })
  })

  it('enforces expiry and five failed attempts, including concurrent guesses', async () => {
    const email = addr(), sent = await requestEmailSignInCode(email), code = codeFor(email)
    const wrong = code === '000000' ? '111111' : '000000'
    const attempts = await Promise.all(Array.from({ length: 5 }, () => verify(sent.challengeId, wrong)))
    expect(attempts.every(result => result.status === 401)).toBe(true)
    expect((await verify(sent.challengeId, code, profile)).status).toBe(401)
    const second = addr(), expired = await requestEmailSignInCode(second)
    await prisma.$executeRaw`UPDATE "EmailSignInCode" SET "expiresAt" = NOW() - INTERVAL '1 second' WHERE "email" = ${second}`
    await expect(consumeEmailSignInCode(expired.challengeId, codeFor(second))).rejects.toMatchObject({ status: 401 })
  })

  it('permits only one concurrent consumption of a correct code', async () => {
    const email = addr(), sent = await requestEmailSignInCode(email)
    const results = await Promise.allSettled([consumeEmailSignInCode(sent.challengeId, codeFor(email)), consumeEmailSignInCode(sent.challengeId, codeFor(email))])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  })

  it('limits concurrent sends, invalidates resends, and enforces a mailbox hourly budget', async () => {
    const email = addr(), first = await requestEmailSignInCode(email), oldCode = codeFor(email)
    await expect(requestEmailSignInCode(email)).rejects.toMatchObject({ status: 429 })
    await prisma.$executeRaw`UPDATE "EmailSignInCode" SET "sentAt" = NOW() - INTERVAL '61 seconds' WHERE "email" = ${email}`
    const sends = await Promise.allSettled([requestEmailSignInCode(email), requestEmailSignInCode(email)])
    expect(sends.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    await expect(consumeEmailSignInCode(first.challengeId, oldCode)).rejects.toMatchObject({ status: 401 })
    await prisma.$executeRaw`UPDATE "EmailSignInCode" SET "sentAt" = NOW() - INTERVAL '61 seconds', "sends" = 5 WHERE "email" = ${email}`
    await expect(requestEmailSignInCode(email)).rejects.toMatchObject({ status: 429 })
  })

  it('reports email failure and invalidates the undelivered code', async () => {
    const email = addr(); config.sent = false
    const result = await request(app).post('/api/auth/email-code/request').send({ email })
    expect(result.status).toBe(503); expect(result.body.error).toBe('email_delivery_failed')
    const [row] = await prisma.$queryRaw<{ codeHash: string | null }[]>`SELECT "codeHash" FROM "EmailSignInCode" WHERE "email" = ${email}`
    expect(row.codeHash).toBeNull()
  })

  it('keeps public signups paused while allowing existing users to sign in', async () => {
    config.paused = true
    const email = addr(), sent = await requestEmailSignInCode(email)
    expect((await verify(sent.challengeId, codeFor(email), profile)).status).toBe(403)
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    const existing = addr(); await prisma.user.create({ data: { email: existing } })
    const code = await requestEmailSignInCode(existing)
    expect((await verify(code.challengeId, codeFor(existing))).status).toBe(200)
  })

  it('uses the emailed link once without an extra code, ignores a supplied email, and requires authentication on reuse', async () => {
    const email = addr(), { token, row } = await invite(email)
    const lookup = await request(app).post('/api/invitations/lookup').send({ token })
    expect(lookup.status).toBe(200)
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    const accepted = await request(app).post('/api/invitations/accept').send({ token, email: 'attacker@example.invalid', ...profile })
    expect(accepted.status).toBe(200)
    expect(accepted.body.user.email).toBe(email)
    expect(accepted.body.token).toBeTruthy()
    expect(config.mails).toHaveLength(0)
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({ googleId: null, emailVerified: true })
    expect(await admin.userInvitation.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'ACCEPTED' })
    const replay = await request(app).post('/api/invitations/accept').send({ token, ...profile })
    expect(replay.status).toBe(401); expect(replay.body.error).toBe('sign_in_required'); expect(replay.body.token).toBeUndefined()
    const sent = await requestEmailSignInCode(email)
    expect((await verify(sent.challengeId, codeFor(email))).body.user.id).toBe(accepted.body.user.id)
  })

  it('permits only one concurrent token-only acceptance and preserves an existing Google identity', async () => {
    const email = addr(), user = await prisma.user.create({ data: { email, googleId: `google-${email}`, role: 'ADMIN' } })
    const { token } = await invite(email)
    const results = await Promise.all(Array.from({ length: 2 }, () => request(app).post('/api/invitations/accept').send({ token, ...profile })))
    expect(results.map(r => r.status).sort()).toEqual([200, 401])
    expect(results.find(r => r.status === 200)!.body.user.id).toBe(user.id)
    expect(await prisma.user.findUnique({ where: { email } })).toMatchObject({ googleId: user.googleId, role: 'ADMIN' })
  })

  it('rejects missing, superseded, expired and revoked invitation tokens without issuing a session', async () => {
    expect((await request(app).post('/api/invitations/accept').send(profile)).status).toBe(404)
    for (const state of ['expired', 'revoked', 'superseded']) {
      const email = addr(), { token, row } = await invite(email)
      await admin.userInvitation.update({ where: { id: row.id }, data: state === 'expired' ? { expiresAt: new Date(Date.now() - 1000) } : state === 'revoked' ? { status: 'REVOKED', pendingKey: null } : { tokenHash: hashInvitationToken(randomUUID()) } })
      const result = await request(app).post('/api/invitations/accept').send({ token, ...profile })
      expect(result.status).toBe(state === 'superseded' ? 404 : 410)
      expect(result.body.token).toBeUndefined()
      expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    }
  })

  it('keeps the link usable after missing profile validation fails', async () => {
    const email = addr(), { token } = await invite(email)
    expect((await request(app).post('/api/invitations/accept').send({ token })).status).toBe(400)
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    expect((await request(app).post('/api/invitations/accept').send({ token, ...profile })).status).toBe(200)
  })

  it('sends invitations only to the invited mailbox and atomically accepts for a verified identity', async () => {
    const email = addr(), { token, row } = await invite(email)
    const sent = await request(app).post('/api/invitations/email-code/request').send({ token, email: 'attacker@example.invalid' })
    expect(sent.status).toBe(200); expect(config.mails[0].to).toBe(email)
    const accepted = await request(app).post('/api/invitations/accept').send({ token, challengeId: sent.body.challengeId, code: codeFor(email), ...profile })
    expect(accepted.status).toBe(200); expect(accepted.body.user.email).toBe(email)
    expect(await admin.userInvitation.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'ACCEPTED', acceptedUserId: accepted.body.user.id })
  })

  it('binds codes to the invitation link and rejects revoked invitations after sending', async () => {
    const email = addr(), { token, row } = await invite(email)
    const sent = await requestEmailSignInCode(email, token)
    expect((await verify(sent.challengeId, codeFor(email), profile)).status).toBe(401)
    await admin.userInvitation.update({ where: { id: row.id }, data: { status: 'REVOKED', pendingKey: null } })
    const accepted = await request(app).post('/api/invitations/accept').send({ token, challengeId: sent.challengeId, code: codeFor(email), ...profile })
    expect(accepted.status).toBe(410)
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    expect((await request(app).post('/api/invitations/email-code/request').send({ token })).status).toBe(410)
  })
  it('accepts organization enrollment with a restricted role and keeps the invited workspace role separate', async () => {
    const email = addr(), { token, row } = await invite(email)
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Email code test', slug: `${tag}-workspace` } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: row.invitedById, role: 'OWNER', state: 'ACTIVE', acceptedAt: new Date() } })
    await admin.userInvitation.delete({ where: { id: row.id } })
    await admin.userInvitation.create({ data: { id: row.id, email, invitedById: row.invitedById, tokenHash: row.tokenHash, expiresAt: row.expiresAt, workspaceId: workspace.id, proposedRole: 'OWNER', enrollmentFields: [{ id: 'team', type: 'text', label: 'Team', required: true, options: [] }] } })
    const lookup = await request(app).post('/api/invitations/lookup').send({ token })
    expect(lookup.status).toBe(200)
    expect(lookup.body.workspace).toMatchObject({ name: workspace.name, slug: workspace.slug })
    expect(lookup.headers['cache-control']).toBe('no-store')
    const accepted = await request(app).post('/api/invitations/accept').send({ token, ...profile, enrollmentResponses: { team: 'Support' } })
    expect(accepted.status).toBe(200)
    expect(accepted.body.workspacePath).toBe(`/w/${workspace.slug}`)
    expect(accepted.body.user.role).toBe('USER')
    expect(accepted.body.user.tenantOnly).toBe(true)
    expect((await listMyWorkspaces(accepted.body.user.id)).every(workspace => workspace.kind === 'ORGANIZATION')).toBe(true)
    expect(await admin.workspace.findUnique({ where: { personalOwnerId: accepted.body.user.id } })).toBeNull()
    expect(await admin.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: accepted.body.user.id } } })).toMatchObject({ role: 'OWNER', state: 'ACTIVE', enrollmentResponses: { team: 'Support' } })
  })

  it('preserves organization signup pause and rolls back account creation when workspace seats are full', async () => {
    const email = addr(), { token, row } = await invite(email)
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Full workspace', slug: `${tag}-full`, maxMembers: 1 } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: row.invitedById, role: 'OWNER', state: 'ACTIVE', acceptedAt: new Date() } })
    await admin.userInvitation.delete({ where: { id: row.id } })
    await admin.userInvitation.create({ data: { id: row.id, email, invitedById: row.invitedById, tokenHash: row.tokenHash, expiresAt: row.expiresAt, workspaceId: workspace.id, proposedRole: 'LEARNER' } })
    config.paused = true
    let sent = await requestEmailSignInCode(email, token)
    let accepted = await request(app).post('/api/invitations/accept').send({ token, challengeId: sent.challengeId, code: codeFor(email), ...profile })
    expect(accepted.status).toBe(403); expect(accepted.body.error).toBe('signups_paused')
    config.paused = false
    await prisma.$executeRaw`UPDATE "EmailSignInCode" SET "sentAt" = NOW() - INTERVAL '61 seconds' WHERE "email" = ${email}`
    sent = await requestEmailSignInCode(email, token)
    accepted = await request(app).post('/api/invitations/accept').send({ token, challengeId: sent.challengeId, code: codeFor(email), ...profile })
    expect(accepted.status).toBe(409); expect(accepted.body.error).toBe('SEAT_LIMIT')
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull()
    expect(await admin.userInvitation.findUnique({ where: { id: row.id } })).toMatchObject({ status: 'PENDING' })
  })

  it('converts an existing Personal identity on acceptance, preserves history, and rejects old HTTP and socket access', async () => {
    const email = addr()
    const user = await admin.user.create({ data: { email, googleId: `google-${email}`, emailVerified: true } })
    const history = await admin.session.create({ data: { userId: user.id, module: 'elevate', sessionName: 'Retained Personal practice', endedAt: new Date() } })
    const transcript = await admin.sessionTranscript.create({ data: { sessionId: history.id, conversationData: { messages: [{ role: 'user', content: 'Private retained answer' }] } } })
    const recording = await admin.sessionRecording.create({ data: { sessionId: history.id, egressId: `${tag}-retained-recording`, filePath: 's3://fixture/private-history.webm' } })
    const personalWorkspaceId = history.workspaceId
    const oldToken = signToken({ userId: user.id, email, role: 'USER' })
    const registry = new SessionSubscriptions(), sentEvents: string[] = []
    const socket = { readyState: WebSocket.OPEN, send: (event: string) => sentEvents.push(event) }
    expect(await registry.subscribe(socket, history.id, oldToken)).toBe(true)
    expect((await request(app).get(`/sessions/${history.id}`).set('Authorization', `Bearer ${oldToken}`)).status).toBe(200)
    const { token, row } = await invite(email)
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', slug: `${tag}-convert`, name: 'Conversion workspace' } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: row.invitedById, role: 'OWNER', state: 'ACTIVE', acceptedAt: new Date() } })
    await admin.userInvitation.delete({ where: { id: row.id } })
    await admin.userInvitation.create({ data: { email, tokenHash: row.tokenHash, invitedById: row.invitedById, expiresAt: row.expiresAt, workspaceId: workspace.id, proposedRole: 'LEARNER' } })
    const accepted = await request(app).post('/api/invitations/accept').send({ token, credential: email, ...profile })
    expect(accepted.status).toBe(200)
    expect(accepted.body.user).toMatchObject({ id: user.id, tenantOnly: true })
    expect(await admin.session.findUnique({ where: { id: history.id } })).toEqual(history)
    expect(await admin.sessionTranscript.findUnique({ where: { sessionId: history.id } })).toEqual(transcript)
    expect(await admin.sessionRecording.findUnique({ where: { id: recording.id } })).toEqual(recording)
    expect(await admin.workspace.findUnique({ where: { personalOwnerId: user.id } })).toMatchObject({ id: personalWorkspaceId, kind: 'PERSONAL' })
    expect((await listMyWorkspaces(user.id)).map(workspace => workspace.kind)).toEqual(['ORGANIZATION'])
    const personal = await admin.workspace.findUniqueOrThrow({ where: { id: personalWorkspaceId } })
    await expect(enterWorkspace(user.id, personal.slug)).rejects.toMatchObject({ code: 'TENANT_ONLY_ACCOUNT' })
    const personalMember = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: personalWorkspaceId, userId: user.id } } })
    await expect(withWorkspaceAccess({ tokenUse: 'workspace', workspaceId: personalWorkspaceId, userId: user.id, membershipId: personalMember.id }, async () => 'must not reach')).rejects.toMatchObject({ code: 'TENANT_ONLY_ACCOUNT' })
    for (const path of [`/sessions/${history.id}`, '/api/replay', `/sessions/${history.id}/recording/stream?access_token=${oldToken}`]) {
      const result = await request(app).get(path).set('Authorization', `Bearer ${oldToken}`)
      expect(result.status).toBe(403); expect(result.body.code).toBe('TENANT_ONLY_ACCOUNT')
    }
    expect((await request(app).post('/livekit/dispatch').set('Authorization', `Bearer ${oldToken}`)).status).toBe(403)
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)
    expect(me.status).toBe(200); expect(me.body.user.tenantOnly).toBe(true)
    expect(await canSubscribeToPersonalSession(oldToken, history.id)).toBe(false)
    await registry.publish([socket], history.id, { private: 'must not be sent' })
    expect(sentEvents).toHaveLength(1); expect(sentEvents[0]).toContain('ACCESS_UNAVAILABLE'); expect(sentEvents[0]).not.toContain('must not be sent')
    // Both sign-in methods retain the restriction and use the same account.
    const emailed = await requestEmailSignInCode(email)
    expect((await verify(emailed.challengeId, codeFor(email))).body.user).toMatchObject({ id: user.id, tenantOnly: true })
    const google = await request(app).post('/api/auth/google').send({ credential: email })
    expect(google.body.user).toMatchObject({ id: user.id, tenantOnly: true })
    const member = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } })
    const scoped = await request(app).get(`/sessions/${history.id}`).set('Authorization', `Bearer ${oldToken}`).set('x-spasht-workspace', signWorkspaceToken({ userId: user.id, workspaceId: workspace.id, membershipId: member.id }))
    expect(scoped.status).toBe(404) // Organization context cannot reopen the retained Personal row.
    const orgSession = await admin.session.create({ data: { userId: user.id, workspaceId: workspace.id, workspaceKind: 'ORGANIZATION', module: 'elevate' } })
    const orgResult = await request(app).get(`/sessions/${orgSession.id}`).set('Authorization', `Bearer ${oldToken}`).set('x-spasht-workspace', signWorkspaceToken({ userId: user.id, workspaceId: workspace.id, membershipId: member.id }))
    expect(orgResult.status).toBe(200); expect(orgResult.body.session.id).toBe(orgSession.id)
    await admin.workspaceMember.update({ where: { id: member.id }, data: { state: 'SUSPENDED' } })
    expect((await listMyWorkspaces(user.id))).toEqual([])
    expect((await request(app).get('/api/replay').set('Authorization', `Bearer ${oldToken}`)).status).toBe(403)
    await admin.workspaceMember.delete({ where: { id: member.id } })
    expect((await admin.user.findUniqueOrThrow({ where: { id: user.id } })).tenantOnly).toBe(true)
  })

  it('converts direct pending membership acceptance and leaves ordinary Personal accounts unchanged', async () => {
    const email = addr(), user = await admin.user.create({ data: { email, emailVerified: true } })
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', slug: `${tag}-direct`, name: 'Direct enrollment' } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'OWNER', state: 'INVITED' } })
    expect((await listMyWorkspaces(user.id)).some(row => row.kind === 'PERSONAL')).toBe(true)
    expect((await admin.user.findUniqueOrThrow({ where: { id: user.id } })).tenantOnly).toBe(false)
    await acceptWorkspaceMembership(user.id, workspace.slug)
    expect((await admin.user.findUniqueOrThrow({ where: { id: user.id } })).tenantOnly).toBe(true)
    expect((await listMyWorkspaces(user.id)).map(row => row.kind)).toEqual(['ORGANIZATION'])
    const personal = await admin.user.create({ data: { email: addr(), emailVerified: true } })
    expect((await listMyWorkspaces(personal.id)).map(row => row.kind)).toEqual(['PERSONAL'])
    expect((await request(app).post('/api/auth/google').send({ credential: personal.email })).body.user.tenantOnly).toBe(false)
  })

  it('backfills accepted legacy memberships without converting pending invitations or rewriting history', async () => {
    const accepted = await admin.user.create({ data: { email: addr(), emailVerified: true } })
    const pending = await admin.user.create({ data: { email: addr(), emailVerified: true } })
    const history = await admin.session.create({ data: { userId: accepted.id, module: 'elevate', endedAt: new Date() } })
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Legacy organization', slug: `${tag}-legacy` } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: accepted.id, role: 'LEARNER', state: 'SUSPENDED', acceptedAt: new Date() } })
    await admin.workspaceMember.create({ data: { workspaceId: workspace.id, userId: pending.id, role: 'LEARNER', state: 'INVITED' } })
    // Represent the old state before the new column/backfill existed.
    await admin.user.update({ where: { id: accepted.id }, data: { tenantOnly: false } })
    const migration = await readFile(new URL('../prisma/migrations/20261105130000_tenant_only_accounts/migration.sql', import.meta.url), 'utf8')
    const backfill = migration.match(/UPDATE "User"[\s\S]+?;\n/)![0]
    await admin.$executeRawUnsafe(backfill)
    expect((await admin.user.findUniqueOrThrow({ where: { id: accepted.id } })).tenantOnly).toBe(true)
    expect((await admin.user.findUniqueOrThrow({ where: { id: pending.id } })).tenantOnly).toBe(false)
    expect(await admin.session.findUnique({ where: { id: history.id } })).toEqual(history)
  })

  it('rolls back the account restriction when enrollment rolls back', async () => {
    const user = await admin.user.create({ data: { email: addr(), emailVerified: true } })
    const workspace = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Rolled back enrollment', slug: `${tag}-rollback` } })
    await expect(admin.$transaction(async tx => {
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() } })
      throw new Error('audit unavailable')
    })).rejects.toThrow('audit unavailable')
    expect((await admin.user.findUniqueOrThrow({ where: { id: user.id } })).tenantOnly).toBe(false)
    expect((await listMyWorkspaces(user.id)).map(row => row.kind)).toEqual(['PERSONAL'])
  })

})
