import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres' }) }
})
const delivery = vi.hoisted(() => ({ sendEmail: vi.fn().mockResolvedValue({ sent: true }) }))
vi.mock('../src/lib/email', () => ({ sendEmail: delivery.sendEmail }))
const state = vi.hoisted(() => ({ paused: false }))
vi.mock('../src/lib/platformSettings', () => ({ areSignupsPaused: async () => state.paused, getSignupsPausedMessage: async () => 'Signups paused', areRewardPointsEnabled: async () => false }))
vi.mock('../src/lib/google-auth', () => ({ verifyGoogleIdToken: async (credential: string) => {
  const data = JSON.parse(credential)
  return { googleId: `google-${data.email}`, email: data.email, emailVerified: data.verified !== false, firstName: 'Test', lastName: 'Learner', avatar: null }
} }))
const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use the isolated tenancy database')
const suite = url ? describe : describe.skip
suite('workspace email invitation boundaries with a restricted runtime role', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const tag = 'wi-' + randomUUID().replaceAll('-', '').slice(0, 12), addr = (s: string) => `${tag}-${s}@example.invalid`
  let db: PrismaClient, app: express.Express, owner = '', manager = '', learner = '', platform = '', alpha = '', beta = '', tokenA = '', tokenB = '', tokenManager = '', tokenLearner = '', platformToken = ''
  let captured: typeof import('../src/lib/invitations').capturedInvitationEmails
  const saved = { enabled: process.env.WORKSPACES_ENABLED, mode: process.env.INVITATION_EMAIL_DELIVERY }
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
  const base = '/api/workspaces/current/invitations'
  const post = (token: string, body: unknown) => request(app).post(base).set(bearer(token)).send(body)
  function mailToken(workspaceId: string, email: string) {
    const mail = captured(workspaceId).find(m => m.to === email)
    expect(mail).toBeDefined(); return new URL(mail!.acceptUrl).hash.slice('#token='.length)
  }
  const SIGNUP_PROFILE = { phone: '9876543210', dateOfBirth: '1995-06-15', gender: 'FEMALE', pincode: '560001' }
  const accept = (token: string, email: string, verified = true) => request(app).post('/api/invitations/accept').send({ token, credential: JSON.stringify({ email, verified }), ...SIGNUP_PROFILE })
  beforeAll(async () => {
    process.env.WORKSPACES_ENABLED = 'true'; delete process.env.INVITATION_EMAIL_DELIVERY
    await prepareWorkspaceTestRole(admin)
    db = (await import('../src/lib/prisma')).prisma
    const { signToken } = await import('../src/lib/jwt')
    const { workspaceRouter, platformWorkspacesRouter } = await import('../src/workspaces/routes')
    const { default: recipient } = await import('../src/routes/invitations')
    const { default: platformRoutes } = await import('../src/routes/admin/invitations')
    const { requireAuth } = await import('../src/middleware/auth'), { requireCurrentAdmin } = await import('../src/middleware/admin')
    captured = (await import('../src/lib/invitations')).capturedInvitationEmails
    app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter); app.use('/api/admin/workspaces', platformWorkspacesRouter)
    app.use('/api/invitations', recipient); app.use('/api/admin/invitations', requireAuth, requireCurrentAdmin, platformRoutes)
    for (const name of ['owner', 'manager', 'learner', 'platform']) {
      const u = await admin.user.create({ data: { email: addr(name), emailVerified: true, role: name === 'platform' ? 'ADMIN' : 'USER' } })
      if (name === 'owner') owner = u.id; if (name === 'manager') manager = u.id; if (name === 'learner') learner = u.id; if (name === 'platform') { platform = u.id; platformToken = signToken({ userId: u.id, email: u.email, role: u.role }) }
    }
    const ownerToken = signToken({ userId: owner, email: addr('owner'), role: 'USER' })
    for (const suffix of ['alpha', 'beta']) {
      const response = await request(app).post('/api/admin/workspaces').set(bearer(platformToken)).send({ name: suffix, slug: `${tag}-${suffix}`, ownerEmail: addr('owner') })
      expect(response.status).toBe(200)
      const workspace = response.body.workspace
      if (suffix === 'alpha') alpha = workspace.id; else beta = workspace.id
      await request(app).post(`/api/workspaces/entry/${workspace.slug}/accept`).set(bearer(ownerToken))
      const entered = await request(app).post(`/api/workspaces/entry/${workspace.slug}`).set(bearer(ownerToken))
      if (suffix === 'alpha') tokenA = entered.body.accessToken; else tokenB = entered.body.accessToken
    }
    for (const [userId, role] of [[manager, 'ADMIN'], [learner, 'LEARNER']] as const) await admin.workspaceMember.create({ data: { workspaceId: alpha, userId, role, state: 'ACTIVE', acceptedAt: new Date() } })
    const { signWorkspaceToken } = await import('../src/lib/jwt')
    for (const userId of [manager, learner]) {
      const m = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: alpha, userId } } })
      const token = signWorkspaceToken({ userId, workspaceId: alpha, membershipId: m.id }); if (userId === manager) tokenManager = token; else tokenLearner = token
    }
  }, 30000)
  afterAll(async () => {
    await admin.userInvitation.deleteMany({ where: { email: { startsWith: tag } } })
    await admin.workspace.deleteMany({ where: { id: { in: [alpha, beta] } } })
    await admin.adminAction.deleteMany({ where: { adminId: platform } }); await admin.user.deleteMany({ where: { email: { startsWith: tag } } })
    await db?.$disconnect(); await admin.$disconnect()
    if (saved.enabled === undefined) delete process.env.WORKSPACES_ENABLED; else process.env.WORKSPACES_ENABLED = saved.enabled
    if (saved.mode === undefined) delete process.env.INVITATION_EMAIL_DELIVERY; else process.env.INVITATION_EMAIL_DELIVERY = saved.mode
  })
  it('separates platform and two tenant invitation lists, pending keys, tokens and mailbox', async () => {
    const email = addr('same')
    expect((await post(tokenA, { email })).status).toBe(200)
    expect((await post(tokenB, { email })).status).toBe(200)
    expect((await request(app).post('/api/admin/invitations').set(bearer(platformToken)).send({ email })).status).toBe(201)
    expect((await post(tokenA, { email })).status).toBe(409)
    const shrink = await request(app).patch(`/api/admin/workspaces/${beta}`).set(bearer(platformToken)).send({ limits: { maxMembers: 1, dailyEvaluations: 30, concurrentVoice: 1 } })
    expect(shrink.status).toBe(409) // platform quota edits include reserved invitations without listing them

    const inv = await admin.userInvitation.findFirstOrThrow({ where: { workspaceId: alpha, email } })
    expect(await db.userInvitation.findUnique({ where: { id: inv.id } })).toBeNull()
    const platformList = await request(app).get('/api/admin/invitations').set(bearer(platformToken))
    expect(platformList.body.items.every((i: { id: string }) => i.id !== inv.id)).toBe(true)
    expect((await request(app).post(`/api/admin/invitations/${inv.id}/resend`).set(bearer(platformToken))).status).toBe(404)
    expect((await request(app).post(`${base}/${inv.id}/revoke`).set(bearer(tokenB))).status).toBe(404)
    expect(captured().find(m => m.id === inv.id)).toBeUndefined()
    const own = await request(app).get(base).set(bearer(tokenA)); expect(own.body.items.map((i: { id: string }) => i.id)).toEqual([inv.id])
    expect(JSON.stringify(own.body)).not.toMatch(/tokenHash|pendingKey|invitedById/)
  })
  it('restricts tenant Admin to learner invitations, refuses learners and forged scope', async () => {
    expect((await post(tokenManager, { email: addr('elevated'), role: 'ADMIN' })).status).toBe(403)
    expect((await post(tokenLearner, { email: addr('forbidden') })).status).toBe(403)
    expect((await post(tokenA, { email: addr('forged'), workspaceId: beta })).status).toBe(400)
    expect((await request(app).get('/api/admin/invitations').set(bearer(tokenA))).status).toBe(401)
    expect((await post(tokenManager, { email: addr('normal') })).status).toBe(200)
  })
  it('atomically accepts only the intended membership, with idempotence and Personal preservation', async () => {
    const email = addr('existing'), u = await admin.user.create({ data: { email, emailVerified: true } })
    const personal = await admin.session.create({ data: { userId: u.id, module: 'elevate' } })
    const created = await post(tokenA, { email, role: 'ADMIN', memberFeatures: { replay: false } }); expect(created.status).toBe(200)
    const token = mailToken(alpha, email)
    expect((await accept(token, addr('wrong'))).status).toBe(403)
    expect((await accept(token, email, false)).status).toBe(403)
    const accepted = await accept(token, email)
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200); expect(accepted.body.workspacePath).toBe(`/w/${tag}-alpha`)
    expect((await admin.user.findUniqueOrThrow({ where: { id: u.id } })).role).toBe('USER')
    const m = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: alpha, userId: u.id } } })
    expect(m).toMatchObject({ role: 'ADMIN', state: 'ACTIVE' })
    expect(await admin.workspaceMemberFeature.findFirst({ where: { memberId: m.id, feature: 'replay' } })).toMatchObject({ allowed: false })
    expect(await admin.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: beta, userId: u.id } } })).toBeNull()
    expect(await admin.session.findUnique({ where: { id: personal.id } })).toMatchObject({ workspaceId: personal.workspaceId, workspaceKind: 'PERSONAL' })
    expect((await accept(token, email)).body.alreadyAccepted).toBe(true)
    expect(await admin.workspaceAudit.count({ where: { workspaceId: alpha, subjectId: created.body.id, action: 'invitation_accepted' } })).toBe(1)
    await admin.workspaceMember.update({ where: { id: m.id }, data: { state: 'SUSPENDED' } })
    expect((await accept(token, email)).status).toBe(403)
  })
  it('rechecks inviter permissions and rolls back newly created identities on failure', async () => {
    const email = addr('demoted')
    expect((await post(tokenManager, { email })).status).toBe(200)
    const token = mailToken(alpha, email)
    await admin.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: alpha, userId: manager } }, data: { state: 'SUSPENDED' } })
    expect((await accept(token, email)).status).toBe(403)
    expect(await admin.user.findUnique({ where: { email } })).toBeNull()
    expect((await post(tokenManager, { email: addr('blocked-manager') })).status).toBe(403)
    await admin.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: alpha, userId: manager } }, data: { state: 'ACTIVE' } })
  })
  it('supersedes links on resend, revokes, and prevents grants into suspended workspaces', async () => {
    const email = addr('resend'), created = await post(tokenA, { email }), old = mailToken(alpha, email)
    expect((await request(app).post(`${base}/${created.body.id}/resend`).set(bearer(tokenA))).status).toBe(200)
    const fresh = mailToken(alpha, email); expect(fresh).not.toBe(old)
    expect((await accept(old, email)).status).toBe(404)
    await admin.workspace.update({ where: { id: alpha }, data: { state: 'SUSPENDED' } })
    expect((await accept(fresh, email)).status).toBe(403)
    expect(await admin.user.findUnique({ where: { email } })).toBeNull()
    await admin.workspace.update({ where: { id: alpha }, data: { state: 'ACTIVE' } })
    expect((await request(app).post(`${base}/${created.body.id}/revoke`).set(bearer(tokenA))).status).toBe(200)
    expect((await accept(fresh, email)).status).toBe(410)
  })
  it('respects signup pause for tenant invitations without changing the platform exception', async () => {
    const email = addr('paused'), created = await post(tokenA, { email }), token = mailToken(alpha, email)
    state.paused = true
    try { expect((await accept(token, email)).status).toBe(403); expect(await admin.user.findUnique({ where: { email } })).toBeNull() }
    finally { state.paused = false }
    expect((await accept(token, email)).status).toBe(200)
    expect((await admin.userInvitation.findUniqueOrThrow({ where: { id: created.body.id } })).status).toBe('ACCEPTED')
  })
  it('enforces seat reservations and acceptance-time capacity, and expiry', async () => {
    const count = await admin.workspaceMember.count({ where: { workspaceId: beta, state: { not: 'SUSPENDED' } } })
    await admin.workspace.update({ where: { id: beta }, data: { maxMembers: count + 1 } })
    expect((await post(tokenB, { email: addr('overfull') })).status).toBe(409) // same-email invitation already reserves the last seat
    const email = addr('same'), token = mailToken(beta, email)
    await admin.workspace.update({ where: { id: beta }, data: { maxMembers: count } })
    expect((await accept(token, email)).status).toBe(409)
    expect(await admin.user.findUnique({ where: { email } })).toBeNull()
    const inv = await admin.userInvitation.findFirstOrThrow({ where: { workspaceId: beta, email } })
    await admin.userInvitation.update({ where: { id: inv.id }, data: { expiresAt: new Date(0) } })
    expect((await accept(token, email)).status).toBe(410)
    await admin.workspace.update({ where: { id: beta }, data: { maxMembers: 100 } })
  })
  it('rolls back the account, membership and acceptance if workspace audit persistence fails', async () => {
    const email = addr('audit-failure'), created = await post(tokenA, { email }), token = mailToken(alpha, email)
    const functionName = 'fail_' + tag.replaceAll('-', '_')
    await admin.$executeRawUnsafe(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."workspaceId"='${alpha}' AND NEW.action='invitation_accepted' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END $$`)
    await admin.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON "WorkspaceAudit" FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`)
    try {
      expect((await accept(token, email)).status).toBe(500)
      expect(await admin.user.findUnique({ where: { email } })).toBeNull()
      expect(await admin.userInvitation.findUnique({ where: { id: created.body.id } })).toMatchObject({ status: 'PENDING', acceptedUserId: null })
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON "WorkspaceAudit"`)
      await admin.$executeRawUnsafe(`DROP FUNCTION public.${functionName}()`)
    }
    expect((await accept(token, email)).status).toBe(200)
  })
  it('serializes competing acceptances at the final seat without creating an orphan account', async () => {
    const emails = [addr('race-one'), addr('race-two')]
    for (const email of emails) expect((await post(tokenB, { email })).status).toBe(200)
    const tokens = emails.map(email => mailToken(beta, email))
    const current = await admin.workspaceMember.count({ where: { workspaceId: beta, state: { not: 'SUSPENDED' } } })
    await admin.workspace.update({ where: { id: beta }, data: { maxMembers: current + 1 } })
    const results = await Promise.all(tokens.map((token, i) => accept(token, emails[i])))
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(await admin.user.count({ where: { email: { in: emails } } })).toBe(1)
    expect(await admin.workspaceMember.count({ where: { workspaceId: beta, state: { not: 'SUSPENDED' } } })).toBe(current + 1)
    await admin.workspace.update({ where: { id: beta }, data: { maxMembers: 100 } })
  })
  it('purges tenant PII and cleans it on user deletion through narrow maintenance functions', async () => {
    const { deleteInvitationsForUser, purgeClosedInvitations } = await import('../src/lib/invitations')
    const email = addr('cleanup'), u = await admin.user.create({ data: { email, emailVerified: true } })
    expect((await post(tokenA, { email })).status).toBe(200)
    const rows = await db.$transaction(tx => deleteInvitationsForUser(tx, u, platform)); expect(rows).toBe(1)
    expect(await admin.userInvitation.count({ where: { email } })).toBe(0)
    const email2 = addr('purge'), created = await post(tokenA, { email: email2 })
    await admin.userInvitation.update({ where: { id: created.body.id }, data: { status: 'REVOKED', pendingKey: null, revokedAt: new Date('2000-01-01') } })
    expect(await purgeClosedInvitations()).toBeGreaterThan(0)
    expect(await admin.userInvitation.findUnique({ where: { id: created.body.id } })).toBeNull()
  })
  it('restricts configuration to managers, snapshots invitation forms and atomically stores workspace-only responses', async () => {
    const settings = { fields: [
      { id: 'department', type: 'dropdown', label: 'Department', required: true, options: ['CS', 'ECE'] },
      { id: 'skills', type: 'checkbox', label: 'Skills', required: true, options: ['Java', 'Python'] },
      { id: 'roll', type: 'text', label: 'Roll number', required: true, options: [] },
      { id: 'welcome', type: 'message', label: 'Welcome to the college', required: false, options: [] },
    ], email: { subject: 'Welcome to our college', message: 'Please complete your department details.' } }
    const endpoint = '/api/workspaces/current/enrollment'
    expect((await request(app).put(endpoint).set(bearer(tokenLearner)).send(settings)).status).toBe(403)
    expect((await request(app).put(endpoint).set(bearer(tokenManager)).send(settings)).status).toBe(200)
    const email = addr('custom'), created = await post(tokenA, { email }); expect(created.status).toBe(200)
    const token = mailToken(alpha, email), mail = captured(alpha).find(m => m.to === email)!
    expect(mail.subject).toBe(settings.email.subject); expect(mail.text).toContain(settings.email.message)
    // Editing defaults cannot change a form or email somebody has already received.
    expect((await request(app).put(`/api/admin/workspaces/${alpha}/enrollment`).set(bearer(platformToken)).send({ fields: [], email: {} })).status).toBe(200)
    const lookup = await request(app).post('/api/invitations/lookup').send({ token })
    expect(lookup.body.enrollmentFields).toEqual(settings.fields)
    expect((await accept(token, email)).status).toBe(400)
    expect(await admin.user.findUnique({ where: { email } })).toBeNull()
    const responses = { department: 'CS', skills: ['Java', 'Python'], roll: 'CS-42' }
    const accepted = await request(app).post('/api/invitations/accept').send({ token, credential: JSON.stringify({ email }), enrollmentResponses: responses, ...SIGNUP_PROFILE })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    const user = await admin.user.findUniqueOrThrow({ where: { email } })
    const m = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: alpha, userId: user.id } } })
    expect(m.enrollmentResponses).toEqual(responses); expect(m.enrollmentFields).toEqual(settings.fields)
    const managers = await request(app).get('/api/workspaces/current/members').set(bearer(tokenManager))
    expect(managers.body.items.find((row: { id: string }) => row.id === m.id).enrollmentResponses).toEqual(responses)
    expect((await request(app).get('/api/workspaces/current/members').set(bearer(tokenLearner))).status).toBe(403)
    expect(await db.workspaceMember.findUnique({ where: { id: m.id } })).toBeNull()
    expect((await accept(token, email)).body.alreadyAccepted).toBe(true)
    expect((await admin.workspaceMember.findUniqueOrThrow({ where: { id: m.id } })).enrollmentResponses).toEqual(responses)
    const snap = await admin.userInvitation.findUniqueOrThrow({ where: { id: created.body.id } })
    await expect(admin.userInvitation.update({ where: { id: snap.id }, data: { emailMessage: 'changed' } })).rejects.toThrow()
  })
  it('sends bulk recipients privately, isolates tenant scope, and returns duplicates without resending', async () => {
    const emails = [addr('bulk-a'), addr('bulk-b')]
    const body = { emails, emailContent: { subject: 'Bulk welcome', message: 'Welcome, learner.' } }
    expect((await request(app).post(`${base}/bulk`).set(bearer(tokenLearner)).send(body)).status).toBe(403)
    expect((await request(app).post(`${base}/bulk`).set(bearer(tokenA)).send({ ...body, emails: [emails[0], emails[0]] })).status).toBe(400)
    const sent = await request(app).post(`${base}/bulk`).set(bearer(tokenA)).send(body)
    expect(sent.status).toBe(200); expect(sent.body.results.every((r: { ok: boolean }) => r.ok)).toBe(true)
    const tokens = emails.map(email => mailToken(alpha, email)); expect(tokens[0]).not.toBe(tokens[1])
    for (const email of emails) expect(captured(alpha).find(m => m.to === email)?.subject).toBe('Bulk welcome')
    const repeat = await request(app).post(`${base}/bulk`).set(bearer(tokenA)).send(body)
    expect(repeat.body.results.every((r: { ok: boolean }) => !r.ok)).toBe(true)
    expect(emails.map(email => mailToken(alpha, email))).toEqual(tokens)
    const platformBatch = await request(app).post('/api/admin/invitations/bulk').set(bearer(platformToken)).send({ emails: [addr('platform-bulk')], emailContent: { subject: 'Platform welcome', message: '<b>plain text</b>' } })
    expect(platformBatch.status).toBe(200); expect(platformBatch.body.results[0].ok).toBe(true)
    expect(captured().find(m => m.to === addr('platform-bulk'))?.subject).toBe('Platform welcome')
  })

  it('previews the exact email template without writing invitations or sending mail', async () => {
    const before = await admin.userInvitation.count({ where: { workspaceId: alpha } })
    delivery.sendEmail.mockClear()
    const body = { emailContent: { subject: 'Preview subject', message: '<script>plain text only</script>' } }
    const preview = await request(app).post(`${base}/preview`).set(bearer(tokenA)).send(body)
    expect(preview.status).toBe(200); expect(preview.body.previewOnly).toBe(true)
    expect(preview.body.subject).toBe('Preview subject'); expect(preview.body.html).toContain('&lt;script&gt;')
    expect(preview.body.html).not.toContain('<script>'); expect(preview.body.html).toContain('href="#preview-only"')
    expect(JSON.stringify(preview.body)).not.toContain('token=')
    expect((await request(app).post(`${base}/preview`).set(bearer(tokenLearner)).send(body)).status).toBe(403)
    expect((await request(app).post(`/api/admin/workspaces/${alpha}/invitations/preview`).set(bearer(platformToken)).send(body)).status).toBe(200)
    expect((await request(app).post('/api/admin/invitations/preview').set(bearer(platformToken)).send(body)).status).toBe(200)
    expect((await request(app).post(`${base}/preview`).set(bearer(tokenA)).send({ emailContent: { subject: 'bad\r\nsubject' } })).status).toBe(400)
    expect(await admin.userInvitation.count({ where: { workspaceId: alpha } })).toBe(before)
    expect(delivery.sendEmail).not.toHaveBeenCalled()
  })
  it('hands off only an already-assigned Owner; never grants access or lets tenant tokens email owners', async () => {
    const list = await request(app).get('/api/admin/workspaces').set(bearer(platformToken))
    const row = list.body.find((w: { id: string }) => w.id === alpha)
    expect(row.owners.some((m: { email: string }) => m.email === addr('owner'))).toBe(true)
    const membership = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: alpha, userId: owner } } })
    const url = `/api/admin/workspaces/${alpha}/owners/${membership.id}/send-access`
    const previous = process.env.INVITATION_EMAIL_DELIVERY
    const previousBase = process.env.FRONTEND_URL
    process.env.INVITATION_EMAIL_DELIVERY = 'smtp'; process.env.FRONTEND_URL = 'https://example.invalid'
    delivery.sendEmail.mockClear()
    try {
      expect((await request(app).post(url).set(bearer(tokenA))).status).toBe(401)
      expect((await request(app).post(`/api/admin/workspaces/${beta}/owners/${membership.id}/send-access`).set(bearer(platformToken))).status).toBe(404)
      const sent = await request(app).post(url).set(bearer(platformToken))
      expect(sent.status).toBe(200); expect(sent.body.deliveryStatus).toBe('SENT')
      expect(delivery.sendEmail).toHaveBeenCalledTimes(1)
      expect(delivery.sendEmail.mock.calls[0][0]).toMatchObject({ to: addr('owner'), logBody: false })
      expect(delivery.sendEmail.mock.calls[0][0].text).toContain(`/w/${tag}-alpha`)
      expect(await admin.workspaceMember.findUnique({ where: { id: membership.id } })).toMatchObject({ role: membership.role, state: membership.state })
      delivery.sendEmail.mockResolvedValueOnce({ sent: false })
      expect((await request(app).post(url).set(bearer(platformToken))).body.deliveryStatus).toBe('NOT_SENT')
      const functionName = 'owner_email_' + tag.replaceAll('-', '_')
      await admin.$executeRawUnsafe(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."workspaceId"='${alpha}' AND NEW.action='owner_access_email_result' THEN RAISE EXCEPTION 'fixture result audit unavailable'; END IF; RETURN NEW; END $$`)
      await admin.$executeRawUnsafe(`CREATE TRIGGER ${functionName} BEFORE INSERT ON "WorkspaceAudit" FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`)
      try { expect((await request(app).post(url).set(bearer(platformToken))).body.deliveryStatus).toBe('SENT') }
      finally {
        await admin.$executeRawUnsafe(`DROP TRIGGER ${functionName} ON "WorkspaceAudit"`)
        await admin.$executeRawUnsafe(`DROP FUNCTION public.${functionName}()`)
      }

      const nonOwner = await admin.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: alpha, userId: manager } } })
      expect((await request(app).post(`/api/admin/workspaces/${alpha}/owners/${nonOwner.id}/send-access`).set(bearer(platformToken))).status).toBe(404)
    } finally {
      if (previous === undefined) delete process.env.INVITATION_EMAIL_DELIVERY; else process.env.INVITATION_EMAIL_DELIVERY = previous
      if (previousBase === undefined) delete process.env.FRONTEND_URL; else process.env.FRONTEND_URL = previousBase
    }
  })

})
