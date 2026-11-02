import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { signWorkspaceToken } from '../src/lib/jwt'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

const model = vi.hoisted(() => ({ complete: vi.fn<(prompt: string) => Promise<string>>() }))
vi.mock('../src/workspaces/analyticsModel', () => ({ completeWorkspaceAnalytics: model.complete }))

suite('organization admin reports and AI Analytics', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED }
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
    const routes = await import('../src/workspaces/routes')
    const app = express(); app.use(express.json()); app.use('/api/workspaces', routes.workspaceRouter)
    api = supertest(app)
    for (const who of ['owner', 'admin', 'learner', 'second', 'betaOwner', 'outsider']) {
      users[who] = (await admin.user.create({ data: { email: `${tag}-${who}@example.invalid`, firstName: who, emailVerified: true } })).id
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
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled })) {
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

  const betaId = () => beta
})
