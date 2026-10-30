import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Invitation tests use only the isolated simple_bank database')
  return { url }
})
const mocks = vi.hoisted(() => ({ signupsPaused: false, sendEmail: vi.fn() }))
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
vi.mock('../src/lib/platformSettings', () => ({
  areSignupsPaused: async () => mocks.signupsPaused,
  getSignupsPausedMessage: async () => 'Signups are paused',
  areRewardPointsEnabled: async () => false,
}))
vi.mock('../src/lib/email', () => ({ sendEmail: mocks.sendEmail }))
// A test credential is the JSON of the Google identity it stands for.
vi.mock('../src/lib/google-auth', () => ({
  verifyGoogleIdToken: async (credential: string) => {
    const g = JSON.parse(credential)
    return { googleId: g.sub, email: g.email, emailVerified: g.verified ?? true, firstName: 'Invited', lastName: 'Learner', avatar: null }
  },
}))
import { prisma } from '../src/lib/prisma'
import { requireAuth } from '../src/middleware/auth'
import { requireCurrentAdmin } from '../src/middleware/admin'
import { signToken } from '../src/lib/jwt'
import adminInvitationsRouter from '../src/routes/admin/invitations'
import invitationsRouter from '../src/routes/invitations'
import { capturedInvitationEmails, clearCapturedInvitationEmails, createInvitation, hashInvitationToken } from '../src/lib/invitations'

const app = express(); app.use(express.json())
app.use('/api/admin/invitations', requireAuth, requireCurrentAdmin, adminInvitationsRouter)
app.use('/api/invitations', invitationsRouter)

const tag = `inv_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const addr = (name: string) => `${tag}_${name}@example.invalid`
const bearer = (u: { id: string; email: string; role: string }) => `Bearer ${signToken({ userId: u.id, email: u.email, role: u.role })}`
const google = (email: string, extra: Record<string, unknown> = {}) => JSON.stringify({ sub: `g-${tag}-${email}`, email, ...extra })
let admin: { id: string; email: string; role: string }
let learner: { id: string; email: string; role: string }

async function invite(email: string, body: Record<string, unknown> = {}) {
  return request(app).post('/api/admin/invitations').set('Authorization', bearer(admin)).send({ email, ...body })
}
function tokenFor(email: string) {
  const mail = capturedInvitationEmails().find((m) => m.to === email)
  if (!mail) throw new Error(`no captured invitation for ${email}`)
  return new URL(mail.acceptUrl).hash.replace('#token=', '')
}
const accept = (token: string, credential: string) => request(app).post('/api/invitations/accept').send({ token, credential })

describe.skipIf(!testDb.url)('learner invitations (PostgreSQL)', () => {
  beforeAll(async () => {
    admin = await prisma.user.create({ data: { email: addr('admin'), role: 'ADMIN' } })
    learner = await prisma.user.create({ data: { email: addr('learner') } })
  })
  afterEach(() => {
    mocks.signupsPaused = false
    delete process.env.INVITATION_EMAIL_DELIVERY
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FRONTEND_URL']) delete process.env[key]
  })
  afterAll(async () => {
    clearCapturedInvitationEmails()
    await prisma.userInvitation.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.adminAction.deleteMany({ where: { adminId: admin.id } })
    await prisma.user.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.$disconnect()
  })

  it('refuses anonymous callers, learners and admins whose current role was removed', async () => {
    expect((await request(app).get('/api/admin/invitations')).status).toBe(401)
    expect((await request(app).get('/api/admin/invitations').set('Authorization', bearer(learner))).status).toBe(403)
    expect((await request(app).post('/api/admin/invitations').set('Authorization', bearer(learner)).send({ email: addr('x') })).status).toBe(403)
    const demoted = await prisma.user.create({ data: { email: addr('demoted') } })
    const staleAdminToken = bearer({ ...demoted, role: 'ADMIN' })
    expect((await request(app).get('/api/admin/invitations').set('Authorization', staleAdminToken)).status).toBe(403)
  })

  it('stores only a token hash, captures development mail and writes a content-free audit row', async () => {
    const email = addr('new')
    const res = await invite(email, { name: 'Priya New', role: 'ADMIN' })
    expect(res.status).toBe(201)
    expect(res.body.invitation).toMatchObject({ status: 'pending', deliveryStatus: 'DEV_CAPTURED', recipientName: 'Priya New' })
    expect(res.body.notice).toMatch(/development only/i)
    const token = tokenFor(email)
    const row = await prisma.userInvitation.findFirstOrThrow({ where: { email } })
    expect(row.tokenHash).toBe(hashInvitationToken(token))
    expect(JSON.stringify(row)).not.toContain(token)
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000
    expect(days).toBeCloseTo(7, 1)
    const audit = await prisma.adminAction.findFirstOrThrow({ where: { adminId: admin.id, targetResource: `invitation:${row.id}` } })
    expect(audit.action).toBe('invitation_create')
    expect(JSON.stringify(audit)).not.toContain(email)
    expect(JSON.stringify(audit)).not.toContain(token)
    const mail = capturedInvitationEmails().find((m) => m.to === email)!
    expect(mail.developmentOnly).toBe(true)
    expect(mail.text).toContain('invited to join SpashtAI')
    expect(mail.text).toMatch(/requires a Google Account/)
  })

  it('rejects invalid email and a second pending invitation for the same address', async () => {
    expect((await invite('not-an-email')).status).toBe(400)
    const email = addr('dupe')
    expect((await invite(email)).status).toBe(201)
    const again = await invite(email.toUpperCase())
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('duplicate_pending')
  })

  it('needs explicit confirmation before inviting an address that already has an account', async () => {
    const first = await invite(learner.email)
    expect(first.status).toBe(409)
    expect(first.body.error).toBe('existing_user')
    const confirmed = await invite(learner.email, { confirmExistingUser: true })
    expect(confirmed.status).toBe(201)
    expect(confirmed.body.invitation.existingUserAtInvite).toBe(true)
  })

  it('rejects a different or unverified Google identity and leaves the invitation pending', async () => {
    const email = addr('wrong')
    await invite(email)
    const token = tokenFor(email)
    const other = await accept(token, google(addr('someone-else')))
    expect(other.status).toBe(403)
    expect(other.body.error).toBe('wrong_account')
    expect(other.body.message).toMatch(/Switch Google account/)
    expect(other.body.token).toBeUndefined()
    const unverified = await accept(token, google(email, { verified: false }))
    expect(unverified.status).toBe(403)
    expect((await prisma.userInvitation.findFirstOrThrow({ where: { email } })).status).toBe('PENDING')
    expect(await prisma.user.count({ where: { email } })).toBe(0)
  })

  it('creates an ordinary learner who still has to complete onboarding, and repeat acceptance is idempotent', async () => {
    const email = addr('joiner')
    await invite(email, { role: 'SUPER_ADMIN' })
    const token = tokenFor(email)
    const lookup = await request(app).post('/api/invitations/lookup').send({ token })
    expect(lookup.body).toMatchObject({ status: 'pending' })
    expect(lookup.body.invitedEmail).not.toBe(email)

    const first = await accept(token, google(email))
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ alreadyAccepted: false, newAccount: true })
    expect(first.body.user).toMatchObject({ email, role: 'USER', needsProfileCompletion: true })
    const second = await accept(token, google(email))
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ alreadyAccepted: true, newAccount: false })
    expect(second.body.user.id).toBe(first.body.user.id)
    expect(await prisma.user.count({ where: { email } })).toBe(1)
    const row = await prisma.userInvitation.findFirstOrThrow({ where: { email } })
    expect(row).toMatchObject({ status: 'ACCEPTED', acceptedUserId: first.body.user.id, pendingKey: null })
  })

  it('signs an existing account in without changing its role, permissions or history', async () => {
    const existing = await prisma.user.create({ data: {
      email: addr('veteran'), role: 'USER', rewardPoints: 12, enableReprocess: true, enablePro: false, firstName: 'Vee',
      phone: '9999999999', dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE', pincode: '560001',
    } })
    await prisma.session.create({ data: { userId: existing.id, module: 'elevate' } })
    await invite(existing.email, { confirmExistingUser: true })
    const res = await accept(tokenFor(existing.email), google(existing.email))
    expect(res.status).toBe(200)
    expect(res.body.newAccount).toBe(false)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, include: { _count: { select: { sessions: true } } } })
    expect(after).toMatchObject({ role: 'USER', rewardPoints: 12, enableReprocess: true, enablePro: false, firstName: 'Vee', createdAt: existing.createdAt })
    expect(after._count.sessions).toBe(1)
    expect(await prisma.user.count({ where: { email: existing.email } })).toBe(1)
  })

  it('invalidates the previous link on resend', async () => {
    const email = addr('resend')
    const created = await invite(email)
    const oldToken = tokenFor(email)
    const resent = await request(app).post(`/api/admin/invitations/${created.body.invitation.id}/resend`).set('Authorization', bearer(admin))
    expect(resent.status).toBe(200)
    expect(resent.body.invitation.sendCount).toBe(2)
    const newToken = tokenFor(email)
    expect(newToken).not.toBe(oldToken)
    expect((await accept(oldToken, google(email))).status).toBe(404)
    expect((await accept(newToken, google(email))).status).toBe(200)
    const actions = await prisma.adminAction.findMany({ where: { targetResource: `invitation:${created.body.invitation.id}` }, select: { action: true } })
    expect(actions.map((a) => a.action).sort()).toEqual(['invitation_create', 'invitation_resend'])
  })

  it('blocks acceptance after revocation and refuses to revoke an accepted invitation', async () => {
    const email = addr('revoked')
    const created = await invite(email)
    const token = tokenFor(email)
    const id = created.body.invitation.id
    expect((await request(app).post(`/api/admin/invitations/${id}/revoke`).set('Authorization', bearer(admin))).body.invitation.status).toBe('revoked')
    const res = await accept(token, google(email))
    expect(res.status).toBe(410)
    expect(res.body.error).toBe('invitation_revoked')
    expect(await prisma.user.count({ where: { email } })).toBe(0)
    expect((await request(app).post(`/api/admin/invitations/${id}/resend`).set('Authorization', bearer(admin))).status).toBe(409)

    const acceptedEmail = addr('accepted-then-revoke')
    const acceptedInvite = await invite(acceptedEmail)
    await accept(tokenFor(acceptedEmail), google(acceptedEmail))
    const revokeAccepted = await request(app).post(`/api/admin/invitations/${acceptedInvite.body.invitation.id}/revoke`).set('Authorization', bearer(admin))
    expect(revokeAccepted.status).toBe(409)
  })

  it('expires invitations, reports them as expired and lets a new invitation replace them', async () => {
    const email = addr('expired')
    await createInvitation(admin.id, { email }, new Date(Date.now() - 8 * 86_400_000))
    const res = await accept(tokenFor(email), google(email))
    expect(res.status).toBe(410)
    expect(res.body.error).toBe('invitation_expired')
    const list = await request(app).get(`/api/admin/invitations?status=expired&q=${encodeURIComponent(email)}`).set('Authorization', bearer(admin))
    expect(list.body.items).toHaveLength(1)
    expect(list.body.items[0].status).toBe('expired')
    expect((await invite(email)).status).toBe(201)
  })

  it('keeps the signups-paused control for new accounts and leaves the invitation pending', async () => {
    const email = addr('paused')
    await invite(email)
    mocks.signupsPaused = true
    const res = await accept(tokenFor(email), google(email))
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('signups_paused')
    expect((await prisma.userInvitation.findFirstOrThrow({ where: { email } })).status).toBe('PENDING')
  })

  it('never reports a failed or unconfigured send as delivered', async () => {
    process.env.INVITATION_EMAIL_DELIVERY = 'smtp'
    const unconfigured = await invite(addr('no-smtp'))
    expect(unconfigured.body.invitation).toMatchObject({ status: 'pending', deliveryStatus: 'FAILED', deliveryError: 'smtp_not_configured' })
    expect(unconfigured.body.notice).toMatch(/could not be sent/)
    expect(mocks.sendEmail).not.toHaveBeenCalled()
    const config = await request(app).get('/api/admin/invitations/email-config').set('Authorization', bearer(admin))
    expect(config.body.missing).toEqual(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'FRONTEND_URL'])

    Object.assign(process.env, { SMTP_HOST: 'smtp.test.invalid', SMTP_USER: 'u', SMTP_PASS: 'p', FRONTEND_URL: 'https://app.test.invalid' })
    mocks.sendEmail.mockResolvedValueOnce({ sent: false, reason: 'send_failed' })
    const failed = await invite(addr('bounce'))
    expect(failed.body.invitation).toMatchObject({ status: 'pending', deliveryStatus: 'FAILED', deliveryError: 'send_failed' })
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ logBody: false })
    mocks.sendEmail.mockResolvedValueOnce({ sent: true })
    const sent = await invite(addr('ok'))
    expect(sent.body.invitation.deliveryStatus).toBe('SENT')
    expect(mocks.sendEmail.mock.calls[1][0].html).toContain('Accept invitation')
    expect(mocks.sendEmail.mock.calls[1][0].text).toContain('https://app.test.invalid/invite#token=')
    expect((await request(app).get('/api/admin/invitations/dev-mailbox').set('Authorization', bearer(admin))).status).toBe(404)
  })

  it('lists with status filter, search, pagination and per-status counts', async () => {
    const page = await request(app).get(`/api/admin/invitations?status=pending&q=${tag}&pageSize=2&page=1`).set('Authorization', bearer(admin))
    expect(page.status).toBe(200)
    expect(page.body.items).toHaveLength(2)
    expect(page.body.items.every((i: { status: string }) => i.status === 'pending')).toBe(true)
    expect(page.body.total).toBeGreaterThan(2)
    expect(page.body.totalPages).toBe(Math.ceil(page.body.total / 2))
    expect(Object.keys(page.body.counts).sort()).toEqual(['accepted', 'expired', 'pending', 'revoked'])
    expect((await request(app).get('/api/admin/invitations?status=bogus').set('Authorization', bearer(admin))).status).toBe(400)
  })
})
