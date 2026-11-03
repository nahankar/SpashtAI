import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

const model = vi.hoisted(() => ({ complete: vi.fn<(prompt: string) => Promise<string>>() }))
vi.mock('../src/workspaces/analyticsModel', () => ({ completeWorkspaceAnalytics: model.complete }))

suite('organization admin reports and AI Analytics', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED, feedback: process.env.FEEDBACK_UPLOAD_DIR }
  let uploads = ''
  let readiness: Record<string, boolean>
  const tag = 'an-' + randomUUID().replaceAll('-', '').slice(0, 10)
  const tz = 'Pacific/Kiritimati'
  let db: PrismaClient
  let api: ReturnType<typeof supertest>
  let scopes: typeof import('../src/lib/dataScope')
  let alpha = '', beta = ''
  const users: Record<string, string> = {}
  const members: Record<string, string> = {}
  const token = (workspaceId: string, who: string) =>
    ({ Authorization: `Bearer ${signWorkspaceToken({ userId: users[who], workspaceId, membershipId: members[`${workspaceId}:${who}`] })}` })
  const inScope = <T>(workspaceId: string, who: string, work: () => Promise<T>) => scopes.runWithDataScope({ actorId: users[who], workspaceId,
    membershipId: members[`${workspaceId}:${who}`], role: 'LEARNER', slug: '', timeZone: tz, features: {}, origin: 'request' }, work)
  const at = (iso: string) => new Date(iso)
  const range = 'from=2026-11-01&to=2026-11-03'

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'
    db = (await import('../src/lib/prisma')).prisma
    scopes = await import('../src/lib/dataScope')
    uploads = await mkdtemp(path.join(tmpdir(), 'spasht-feedback-'))
    process.env.FEEDBACK_UPLOAD_DIR = uploads
    readiness = (await import('../src/workspaces/productAccess')).WORKSPACE_FEATURE_READINESS
    const routes = await import('../src/workspaces/routes')
    const { bindWorkspaceRequest } = await import('../src/workspaces/requestScope')
    const { requireAuth } = await import('../src/middleware/auth')
    const feedback = (await import('../src/routes/feedback')).default
    const platformFeedback = (await import('../src/routes/admin/feedback')).default
    const app = express(); app.use(express.json()); app.use('/api/workspaces', routes.workspaceRouter)
    app.use(bindWorkspaceRequest); app.use('/api/feedback', requireAuth, feedback); app.use('/api/admin/feedback', requireAuth, platformFeedback)
    api = supertest(app)
    for (const who of ['owner', 'admin', 'learner', 'second', 'betaOwner', 'outsider', 'staff']) {
      users[who] = (await admin.user.create({ data: { email: `${tag}-${who}@example.invalid`, firstName: who, emailVerified: true, role: who === 'staff' ? 'ADMIN' : 'USER' } })).id
    }
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY', timeZone: tz } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
    }
    const join = async (workspaceId: string, who: string, role: 'OWNER' | 'ADMIN' | 'LEARNER') => {
      members[`${workspaceId}:${who}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId: users[who], role, state: 'ACTIVE', acceptedAt: new Date() } })).id
    }
    await join(alpha, 'owner', 'OWNER'); await join(alpha, 'admin', 'ADMIN'); await join(alpha, 'learner', 'LEARNER'); await join(alpha, 'second', 'LEARNER')
    await join(beta, 'betaOwner', 'OWNER'); await join(beta, 'learner', 'LEARNER')

    // Kiritimati is UTC+14: 2026-11-01T11:00Z is the organization's 2 November, and 2026-11-02T12:00Z its 3 November.
    await inScope(alpha, 'learner', async () => {
      await db.session.create({ data: { userId: users.learner, module: 'elevate', sessionName: 'SECRET-SESSION-NAME', startedAt: at('2026-11-01T11:00:00Z'), durationSec: 600 } })
      await db.session.create({ data: { userId: users.learner, module: 'interview', purpose: 'INTERVIEW', startedAt: at('2026-11-02T12:00:00Z'), durationSec: 300 } })
      await db.replaySession.create({ data: { userId: users.learner, meetingType: 'standup', userRole: 'host', sessionName: 'SECRET-REPLAY', createdAt: at('2026-11-02T12:00:00Z') } })
      await db.progressPulse.createMany({ data: [
        { userId: users.learner, skill: 'clarity', score: 6, source: 'elevate', recordedAt: at('2026-11-01T11:00:00Z'), metadata: { note: 'SECRET-PULSE' } },
        { userId: users.learner, skill: 'clarity', score: 8, source: 'replay', recordedAt: at('2026-11-02T12:00:00Z') },
      ] })
      await db.featureUsage.create({ data: { userId: users.learner, feature: 'elevate', action: 'session_start', path: '/SECRET-PATH', metadata: { secret: 'SECRET-META' }, timestamp: at('2026-11-01T11:00:00Z') } })
      await db.userFeedback.create({ data: { userId: users.learner, feedbackNumber: `${tag}-F1`, body: 'Alpha feedback body', sessionUrl: '/SECRET-URL' } })
    })
    await inScope(alpha, 'second', async () => {
      await db.session.create({ data: { userId: users.second, module: 'elevate', startedAt: at('2026-11-03T01:00:00Z'), durationSec: 120 } })
      await db.progressPulse.create({ data: { userId: users.second, skill: 'pacing', score: 4, source: 'elevate', recordedAt: at('2026-11-03T01:00:00Z') } })
    })
    await inScope(beta, 'learner', async () => {
      await db.session.create({ data: { userId: users.learner, module: 'elevate', startedAt: at('2026-11-02T00:00:00Z') } })
      await db.userFeedback.create({ data: { userId: users.learner, feedbackNumber: `${tag}-F2`, body: 'Beta feedback body' } })
    })
    // The same person's Personal activity in the same period.
    await db.session.create({ data: { userId: users.learner, module: 'elevate', startedAt: at('2026-11-02T00:00:00Z') } })
    await db.userFeedback.create({ data: { userId: users.learner, feedbackNumber: `${tag}-F3`, body: 'Personal feedback body' } })
  }, 60000)

  afterAll(async () => {
    const ids = Object.values(users)
    await admin.userFeedback.deleteMany({ where: { userId: { in: ids } } })
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    await db?.$disconnect(); await admin.$disconnect()
    if (readiness) readiness.feedback = false
    if (uploads) await rm(uploads, { recursive: true, force: true })
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled, FEEDBACK_UPLOAD_DIR: env.feedback })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  it('refuses every report to learners and outsiders', async () => {
    for (const path of ['overview', 'activity/daily', 'activity/learners', 'feature-usage', 'progress-pulse', 'feedback', 'analytics/saved']) {
      expect((await api.get(`/api/workspaces/current/admin/${path}`).set(token(alpha, 'learner'))).status).toBe(403)
    }
    const forged = { Authorization: `Bearer ${signWorkspaceToken({ userId: users.outsider, workspaceId: alpha, membershipId: members[`${alpha}:owner`] })}` }
    expect((await api.get('/api/workspaces/current/admin/overview').set(forged)).status).toBe(403)
  })

  it('groups activity by the organization calendar day and never counts Personal or other organizations', async () => {
    const daily = await api.get(`/api/workspaces/current/admin/activity/daily?${range}`).set(token(alpha, 'admin'))
    expect(daily.status).toBe(200)
    expect(daily.body.range).toMatchObject({ from: '2026-11-01', to: '2026-11-03', timeZone: tz })
    expect(daily.body.days).toEqual([
      { day: '2026-11-01', activeLearners: 0, elevate: 0, replay: 0, interviews: 0, practiceMinutes: 0 },
      { day: '2026-11-02', activeLearners: 1, elevate: 1, replay: 0, interviews: 0, practiceMinutes: 10 },
      { day: '2026-11-03', activeLearners: 2, elevate: 1, replay: 1, interviews: 1, practiceMinutes: 7 },
    ])
    const beta = await api.get(`/api/workspaces/current/admin/activity/daily?${range}`).set(token(betaId(), 'betaOwner'))
    expect(beta.body.days.map((d: { elevate: number }) => d.elevate)).toEqual([0, 1, 0])
    const product = await api.get(`/api/workspaces/current/admin/activity/daily?${range}&product=interviews`).set(token(alpha, 'owner'))
    expect(product.body.days.map((d: { interviews: number; elevate: number }) => [d.interviews, d.elevate])).toEqual([[0, 0], [0, 0], [1, 0]])
  })

  it('filters by learner only within the workspace and returns zero-filled empty results', async () => {
    const own = await api.get(`/api/workspaces/current/admin/activity/learners?${range}&learner=${members[`${alpha}:second`]}`).set(token(alpha, 'owner'))
    expect(own.body.learners).toEqual([expect.objectContaining({ memberId: members[`${alpha}:second`], elevate: 1, replay: 0, interviews: 0, lastActiveDay: '2026-11-03' })])
    expect((await api.get(`/api/workspaces/current/admin/activity/learners?learner=${members[`${beta}:learner`]}`).set(token(alpha, 'owner'))).status).toBe(404)
    const empty = await api.get('/api/workspaces/current/admin/progress-pulse?from=2026-10-01&to=2026-10-02').set(token(alpha, 'owner'))
    expect(empty.body).toMatchObject({ skills: [], learners: [], days: [{ day: '2026-10-01', average: null, samples: 0 }, { day: '2026-10-02', average: null, samples: 0 }] })
    expect((await api.get('/api/workspaces/current/admin/overview?from=2026-11-03&to=2026-11-01').set(token(alpha, 'owner'))).status).toBe(400)
    expect((await api.get('/api/workspaces/current/admin/overview?days=365').set(token(alpha, 'owner'))).status).toBe(400)
  })

  it('reports Pulse, usage and overview without raw content', async () => {
    const pulse = await api.get(`/api/workspaces/current/admin/progress-pulse?${range}`).set(token(alpha, 'admin'))
    expect(pulse.body.skills).toEqual([{ skill: 'clarity', average: 7, samples: 2, learners: 1 }, { skill: 'pacing', average: 4, samples: 1, learners: 1 }])
    expect(pulse.body.days.map((d: { average: number | null }) => d.average)).toEqual([null, 6, 6])
    expect((await api.get(`/api/workspaces/current/admin/progress-pulse?${range}&product=interviews`).set(token(alpha, 'admin'))).status).toBe(400)
    const usage = await api.get(`/api/workspaces/current/admin/feature-usage?${range}`).set(token(alpha, 'admin'))
    expect(usage.body.features).toEqual([{ feature: 'elevate', action: 'session_start', events: 1, learners: 1 }])
    expect(usage.body.days[1]).toMatchObject({ day: '2026-11-02', elevate: 1 })
    const overview = await api.get(`/api/workspaces/current/admin/overview?${range}`).set(token(alpha, 'owner'))
    expect(overview.body).toMatchObject({ members: { active: 4, invited: 0, suspended: 0 }, activeLearners: 2,
      activity: { elevate: 2, replay: 1, interviews: 1 }, evaluations: { used: 0 }, voice: { inUse: 0 } })
    for (const body of [pulse.body, usage.body, overview.body]) expect(JSON.stringify(body)).not.toMatch(/SECRET/)
  })

  it('lists only this organization feedback without session links', async () => {
    const alphaFeedback = await api.get('/api/workspaces/current/admin/feedback').set(token(alpha, 'admin'))
    expect(alphaFeedback.body.items.map((row: { body: string }) => row.body)).toEqual(['Alpha feedback body'])
    expect(alphaFeedback.body.items[0].learner).toMatchObject({ memberId: members[`${alpha}:learner`] })
    expect(JSON.stringify(alphaFeedback.body)).not.toMatch(/SECRET-URL|sessionUrl|sessionId/)
    const betaFeedback = await api.get('/api/workspaces/current/admin/feedback').set(token(betaId(), 'betaOwner'))
    expect(betaFeedback.body.items.map((row: { body: string }) => row.body)).toEqual(['Beta feedback body'])
  })

  it('pages and searches members', async () => {
    const extra = await Promise.all(Array.from({ length: 50 }, (_, i) => admin.user.create({ data: { email: `${tag}-bulk${i}@example.invalid`, emailVerified: true } })))
    extra.forEach((u, i) => { users[`bulk${i}`] = u.id })
    await admin.workspaceMember.createMany({ data: extra.map(u => ({ workspaceId: alpha, userId: u.id, role: 'LEARNER' as const, state: 'INVITED' as const })) })
    const first = await api.get('/api/workspaces/current/members').set(token(alpha, 'owner'))
    expect(first.body).toMatchObject({ total: 54 }); expect(first.body.items).toHaveLength(50)
    const second = await api.get(`/api/workspaces/current/members?after=${first.body.nextCursor}`).set(token(alpha, 'owner'))
    expect(second.body.items).toHaveLength(4); expect(second.body.nextCursor).toBeNull()
    const found = await api.get(`/api/workspaces/current/members?q=${tag}-second`).set(token(alpha, 'owner'))
    expect(found.body.items.map((m: { id: string }) => m.id)).toEqual([members[`${alpha}:second`]])
    expect((await api.get('/api/workspaces/current/members?state=INVITED').set(token(alpha, 'owner'))).body.total).toBe(50)
    await admin.workspaceMember.deleteMany({ where: { workspaceId: alpha, state: 'INVITED' } })
  })

  it('binds AI Analytics learners to this workspace, runs only allowlisted plans and keeps saved plans per organization', async () => {
    const plan = { version: 1, title: 'LEARNER_1 progress', report: 'progress_pulse', days: 30, product: null, skill: null, learner: 'LEARNER_1', explanation: 'Pulse for LEARNER_1' }
    model.complete.mockResolvedValueOnce(JSON.stringify({ status: 'ready', plan }))
    const email = `${tag}-learner@example.invalid`
    const interpreted = await api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'owner')).send({ question: `How is ${email} doing?` })
    expect(interpreted.status).toBe(200)
    expect(model.complete.mock.calls[0][0]).not.toContain(email)
    expect(model.complete.mock.calls[0][0]).toContain('AVAILABLE LEARNER: LEARNER_1')
    expect(interpreted.body).toMatchObject({ status: 'ready', plan: { report: 'progress_pulse', learnerMemberId: members[`${alpha}:learner`], title: 'Learner progress' } })

    // A member of another organization (or nobody) cannot be bound, and the model is never called.
    const calls = model.complete.mock.calls.length
    const foreign = await api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'owner')).send({ question: `How is ${tag}-betaOwner@example.invalid doing?` })
    expect(foreign.body.status).toBe('choose_learner'); expect(model.complete.mock.calls.length).toBe(calls)
    model.complete.mockResolvedValueOnce('SELECT * FROM "Session"')
    expect((await api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'owner')).send({ question: 'Everything' })).status).toBe(422)
    model.complete.mockResolvedValueOnce(JSON.stringify({ status: 'ready', plan }))
    expect((await api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'owner')).send({ question: 'How is my best learner doing?' })).status).toBe(422)

    const run = await api.post('/api/workspaces/current/admin/analytics/run').set(token(alpha, 'owner')).send({ question: `How is ${email} doing?`, plan: interpreted.body.plan })
    expect(run.status).toBe(200)
    expect(run.body.result.data.learners).toEqual([expect.objectContaining({ memberId: members[`${alpha}:learner`], average: 7 })])
    expect(run.body.savedQuery.question).toBe('How is [learner] doing?')
    expect(await admin.workspaceAudit.count({ where: { workspaceId: alpha, action: 'analytics_individual_viewed', subjectId: members[`${alpha}:learner`] } })).toBe(1)
    // A plan with a member id from another workspace fails as not found.
    expect((await api.post('/api/workspaces/current/admin/analytics/run').set(token(alpha, 'owner'))
      .send({ plan: { ...interpreted.body.plan, learnerMemberId: members[`${beta}:learner`] } })).status).toBe(404)
    expect((await api.post('/api/workspaces/current/admin/analytics/run').set(token(alpha, 'owner'))
      .send({ plan: { ...interpreted.body.plan, report: 'transcripts' } })).status).toBe(400)

    const id = run.body.savedQuery.id
    expect((await api.get('/api/workspaces/current/admin/analytics/saved').set(token(alpha, 'admin'))).body.items.map((q: { id: string }) => q.id)).toEqual([id])
    expect((await api.get('/api/workspaces/current/admin/analytics/saved').set(token(betaId(), 'betaOwner'))).body.items).toEqual([])
    expect((await api.post(`/api/workspaces/current/admin/analytics/saved/${id}/run`).set(token(betaId(), 'betaOwner'))).status).toBe(404)
    expect((await api.patch(`/api/workspaces/current/admin/analytics/saved/${id}`).set(token(alpha, 'admin')).send({ pinned: true })).body.pinned).toBe(true)
    expect((await api.post(`/api/workspaces/current/admin/analytics/saved/${id}/run`).set(token(alpha, 'admin'))).status).toBe(200)
    await admin.workspaceAnalyticsQuery.update({ where: { id }, data: { plan: { ...interpreted.body.plan, report: 'raw_sql' } } })
    expect((await api.post(`/api/workspaces/current/admin/analytics/saved/${id}/run`).set(token(alpha, 'admin'))).status).toBe(400)
    expect((await api.delete(`/api/workspaces/current/admin/analytics/saved/${id}`).set(token(betaId(), 'betaOwner'))).status).toBe(404)
    expect((await api.delete(`/api/workspaces/current/admin/analytics/saved/${id}`).set(token(alpha, 'admin'))).status).toBe(200)
  })

  it('calls the analytics model outside the workspace lock and rechecks membership before returning', async () => {
    const plan = { version: 1, title: 'Overview', report: 'overview', days: 30, product: null, skill: null, learner: null, explanation: 'Totals' }
    let release!: (value: string) => void
    const held = new Promise<string>(resolve => { release = resolve })
    model.complete.mockImplementationOnce(() => held)
    const pending = api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'owner')).send({ question: 'Show overview' })
    const started = Date.now()
    const mutated = await api.patch(`/api/workspaces/current/members/${members[`${alpha}:second`]}`).set(token(alpha, 'owner')).send({ state: 'SUSPENDED' })
    expect(mutated.status).toBe(200)
    expect(Date.now() - started).toBeLessThan(2_000)
    await api.patch(`/api/workspaces/current/members/${members[`${alpha}:second`]}`).set(token(alpha, 'owner')).send({ state: 'ACTIVE' })
    release(JSON.stringify({ status: 'ready', plan }))
    expect((await pending).status).toBe(200)

    let releaseAfter!: (value: string) => void
    const afterSuspend = new Promise<string>(resolve => { releaseAfter = resolve })
    model.complete.mockImplementationOnce(() => afterSuspend)
    const stale = api.post('/api/workspaces/current/admin/analytics/interpret').set(token(alpha, 'admin')).send({ question: 'Show overview again' })
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:admin`] }, data: { state: 'SUSPENDED' } })
    releaseAfter(JSON.stringify({ status: 'ready', plan }))
    expect((await stale).status).toBe(403)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:admin`] }, data: { state: 'ACTIVE' } })
  })

  it('lets platform staff read explicit all-workspace practice totals without raw learner rows', async () => {
    const { loadPlatformPracticeTotals } = await import('../src/analytics/platformPracticeTotals')
    const all = await loadPlatformPracticeTotals(users.staff, null)
    expect(all.scope).toEqual({ kind: 'platform', workspaceId: null, practice: 'all-workspaces' })
    expect(all.totals.elevateTotal).toBeGreaterThanOrEqual(4)
    const filtered = await loadPlatformPracticeTotals(users.staff, alpha)
    expect(filtered.scope).toEqual({ kind: 'platform', workspaceId: alpha, practice: 'workspace' })
    expect(filtered.totals.elevateTotal).toBeGreaterThanOrEqual(2)
    expect(filtered.totals.elevateTotal).toBeLessThan(all.totals.elevateTotal)
    await expect(loadPlatformPracticeTotals(users.owner, null)).rejects.toMatchObject({ code: 'PLATFORM_ADMIN_REQUIRED' })
    const empty = await scopes.runWithDataScope({
      actorId: users.learner, workspaceId: alpha, membershipId: members[`${alpha}:learner`],
      role: 'LEARNER', slug: '', timeZone: tz, features: {}, origin: 'request',
    }, () => db.$queryRaw<unknown[]>`SELECT * FROM public.platform_practice_totals(NULL)`)
    expect(empty).toEqual([])
  })

  it('accepts organization feedback only where enabled, numbers it globally and stores attachments under the workspace', async () => {
    const learnerHeaders = (workspaceId: string | null) => ({ Authorization: `Bearer ${signToken({ userId: users.learner, email: `${tag}-learner@example.invalid`, role: 'USER' })}`,
      ...(workspaceId ? { 'x-spasht-workspace': signWorkspaceToken({ userId: users.learner, workspaceId, membershipId: members[`${workspaceId}:learner`] }) } : {}) })
    const submit = (workspaceId: string | null, body: string) => api.post('/api/feedback').set(learnerHeaders(workspaceId))
      .field('body', body).attach('attachments', Buffer.from('screenshot'), { filename: 'shot.png', contentType: 'image/png' })
    expect((await submit(alpha, 'Blocked')).status).toBe(403)
    readiness.feedback = true
    await admin.workspaceFeature.create({ data: { workspaceId: alpha, feature: 'feedback', entitled: true, enabled: true } })
    const org = await submit(alpha, 'Organization feedback')
    expect(org.status).toBe(201)
    const personal = await submit(null, 'Personal feedback')
    expect(personal.status).toBe(201)
    expect(org.body.feedback.feedbackNumber).toMatch(/^FB-\d{5,}$/)
    expect(personal.body.feedback.feedbackNumber).not.toBe(org.body.feedback.feedbackNumber)
    const stored = await admin.userFeedbackAttachment.findFirstOrThrow({ where: { feedbackId: org.body.feedback.id } })
    expect(stored.storedPath.startsWith(path.join(uploads, 'workspaces', alpha, 'feedback') + path.sep)).toBe(true)
    const personalFile = await admin.userFeedbackAttachment.findFirstOrThrow({ where: { feedbackId: personal.body.feedback.id } })
    expect(personalFile.storedPath.includes(`${path.sep}workspaces${path.sep}`)).toBe(false)
    const attachmentId = stored.id
    expect((await api.get(`/api/feedback/${org.body.feedback.id}/attachments/${attachmentId}`).set(learnerHeaders(alpha))).status).toBe(200)
    expect((await api.get(`/api/feedback/${org.body.feedback.id}/attachments/${attachmentId}`).set(learnerHeaders(null))).status).toBe(404)
    expect((await api.get('/api/feedback/mine').set(learnerHeaders(null))).body.feedback.map((f: { body: string }) => f.body)).not.toContain('Organization feedback')
    const listed = await api.get('/api/workspaces/current/admin/feedback').set(token(alpha, 'owner'))
    expect(listed.body.items.map((row: { body: string }) => row.body)).toEqual(expect.arrayContaining(['Organization feedback']))
    expect(listed.body.items.map((row: { body: string }) => row.body)).not.toContain('Personal feedback')
  })

  it('lets platform staff handle Personal and organization feedback in the platform context only', async () => {
    const staff = { Authorization: `Bearer ${signToken({ userId: users.staff, email: 'staff@example.invalid', role: 'ADMIN' })}` }
    const listed = await api.get('/api/admin/feedback?limit=100').set(staff)
    expect(listed.status).toBe(200)
    const mine = listed.body.feedback.filter((row: { userId: string }) => row.userId === users.learner)
    expect(mine.map((row: { body: string }) => row.body)).toEqual(expect.arrayContaining(['Alpha feedback body', 'Beta feedback body', 'Personal feedback body']))
    const alphaRow = mine.find((row: { body: string }) => row.body === 'Alpha feedback body')
    expect(alphaRow.workspace).toMatchObject({ kind: 'ORGANIZATION', slug: `${tag}-alpha` })
    const before = await admin.user.findUniqueOrThrow({ where: { id: users.learner }, select: { rewardPoints: true } })
    const updated = await api.put(`/api/admin/feedback/${alphaRow.id}`).set(staff).send({ status: 'CONSIDERED' })
    expect(updated.status).toBe(200); expect(updated.body.pointsAwarded).toBe(0)
    expect((await admin.user.findUniqueOrThrow({ where: { id: users.learner }, select: { rewardPoints: true } })).rewardPoints).toBe(before.rewardPoints)
    expect((await api.post(`/api/admin/feedback/${alphaRow.id}/notes`).set(staff).send({ body: 'Thanks' })).status).toBe(201)
    // A forged ADMIN claim for an ordinary account is refused by the database role recheck.
    const forged = { Authorization: `Bearer ${signToken({ userId: users.outsider, email: 'x@example.invalid', role: 'ADMIN' })}` }
    expect((await api.get('/api/admin/feedback').set(forged)).status).toBe(403)
  })

  it('hides staff-only notes from learners and workspace admins, and lets the owner delete Open feedback', async () => {
    readiness.feedback = true
    await admin.workspaceFeature.upsert({
      where: { workspaceId_feature: { workspaceId: alpha, feature: 'feedback' } },
      update: { entitled: true, enabled: true },
      create: { workspaceId: alpha, feature: 'feedback', entitled: true, enabled: true },
    })
    const learnerHeaders = (workspaceId: string | null) => ({
      Authorization: `Bearer ${signToken({ userId: users.learner, email: `${tag}-learner@example.invalid`, role: 'USER' })}`,
      ...(workspaceId ? { 'x-spasht-workspace': signWorkspaceToken({ userId: users.learner, workspaceId, membershipId: members[`${workspaceId}:learner`] }) } : {}),
    })
    const staff = { Authorization: `Bearer ${signToken({ userId: users.staff, email: 'staff@example.invalid', role: 'ADMIN' })}` }
    const created = await api.post('/api/feedback').set(learnerHeaders(alpha)).field('body', 'Delete-me organization note')
    expect(created.status).toBe(201)
    const id = created.body.feedback.id as string
    expect((await api.post(`/api/admin/feedback/${id}/notes`).set(staff).send({ body: 'Visible reply to the learner' })).status).toBe(201)
    expect((await api.post(`/api/admin/feedback/${id}/notes`).set(staff).send({ body: 'Internal triage only', internal: true })).status).toBe(201)

    const mine = await api.get(`/api/feedback/${id}`).set(learnerHeaders(alpha))
    expect(mine.status).toBe(200)
    expect(mine.body.feedback.notes.map((n: { body: string }) => n.body)).toEqual(['Visible reply to the learner'])
    const listed = await api.get('/api/workspaces/current/admin/feedback').set(token(alpha, 'owner'))
    const row = listed.body.items.find((item: { id: string }) => item.id === id)
    expect(row).toMatchObject({ body: 'Delete-me organization note' })
    expect(row).not.toHaveProperty('notes')
    expect(row).not.toHaveProperty('sessionUrl')
    expect(row).not.toHaveProperty('attachments')
    const staffView = await api.get(`/api/admin/feedback/${id}`).set(staff)
    expect(staffView.body.feedback.notes.map((n: { body: string; isAdmin: boolean }) => [n.body, n.isAdmin]))
      .toEqual(expect.arrayContaining([['Visible reply to the learner', true], ['Internal triage only', false]]))

    expect((await api.delete(`/api/feedback/${id}`).set(learnerHeaders(null))).status).toBe(404)
    expect((await api.delete(`/api/feedback/${id}`).set(learnerHeaders(alpha))).status).toBe(204)
    expect((await api.get(`/api/feedback/${id}`).set(learnerHeaders(alpha))).status).toBe(404)
    expect((await api.get('/api/feedback/mine').set(learnerHeaders(alpha))).body.feedback.map((f: { id: string }) => f.id)).not.toContain(id)

    const acknowledged = await api.post('/api/feedback').set(learnerHeaders(alpha)).field('body', 'Already seen')
    await api.put(`/api/admin/feedback/${acknowledged.body.feedback.id}`).set(staff).send({ status: 'ACKNOWLEDGED' })
    expect((await api.delete(`/api/feedback/${acknowledged.body.feedback.id}`).set(learnerHeaders(alpha))).status).toBe(403)
  })

  const betaId = () => beta
})
