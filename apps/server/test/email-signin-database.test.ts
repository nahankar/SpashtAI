import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { prepareWorkspaceTestRole } from './workspace-test-role'

const config = vi.hoisted(() => {
  const url = process.env.EMAIL_CODE_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55445/postgres') throw new Error('Use the isolated email-code test database')
  return { url, paused: false, sent: true, mails: [] as { to: string; text: string; logBody: boolean }[] }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') }) }
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
import authRouter from '../src/routes/auth'
import invitationRouter from '../src/routes/invitations'
import { hashInvitationToken } from '../src/lib/invitations'
import { consumeEmailSignInCode, normalizeSignInEmail, requestEmailSignInCode } from '../src/lib/emailSignIn'

const app = express(); app.use(express.json()); app.use('/api/auth', authRouter); app.use('/api/invitations', invitationRouter)
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
    const sent = await requestEmailSignInCode(email, token)
    const accepted = await request(app).post('/api/invitations/accept').send({ token, challengeId: sent.challengeId, code: codeFor(email), ...profile, enrollmentResponses: { team: 'Support' } })
    expect(accepted.status).toBe(200)
    expect(accepted.body.workspacePath).toBe(`/w/${workspace.slug}`)
    expect(accepted.body.user.role).toBe('USER')
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

})
