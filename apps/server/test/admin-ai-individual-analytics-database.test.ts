import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Learner analytics tests use only the isolated simple_bank database')
  return { url }
})
const bedrock = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: vi.fn().mockResolvedValue(['elevate', 'replay', 'prepare', 'interviews']) }))
vi.mock('../src/analytics/insightProviders/bedrockClient', () => ({ getBedrockClient: () => ({ send: bedrock.send }) }))
import { prisma } from '../src/lib/prisma'
import { parseAnalyticsFilters } from '../src/analytics/adminAnalyticsFilters'
import { analyticsPlanSchema, individualPlanSchema } from '../src/analytics/adminAnalyticsQuerySchema'
import { bindLearnerIdentity, redactQuestion } from '../src/analytics/analyticsIdentity'
import { interpretAdminAnalyticsQuestion } from '../src/analytics/adminAnalyticsInterpreter'
import { executeIndividualPlan } from '../src/analytics/individualAnalytics'
import { loadDailyActivity } from '../src/analytics/dailyActivity'
import { dayRange, loadLearnerProgress } from '../src/analytics/learnerReport'
import { listAdminAnalyticsQueries } from '../src/analytics/adminAnalyticsSavedQueries'
import analyticsRouter from '../src/routes/admin/analytics'
import { requireAuth } from '../src/middleware/auth'
import { requireAdmin } from '../src/middleware/admin'
import { signToken } from '../src/lib/jwt'
import { createLearnerFixture, FIXTURE_NOW, type LearnerFixture } from './fixtures/learner-analytics'

const app = express(); app.use(express.json()); app.use('/analytics', requireAuth, requireAdmin, analyticsRouter)
let fx: LearnerFixture
const token = (userId: string, role: string) => signToken({ userId, email: 'ai-analytics-test@example.invalid', role })
const modelReturns = (body: unknown) => bedrock.send.mockResolvedValueOnce({ output: { message: { content: [{ text: JSON.stringify(body) }] } }, usage: {} })
const promptSent = () => JSON.stringify(bedrock.send.mock.calls.at(-1)?.[0])
const v2 = (report: 'learner_progress' | 'daily_activity', learner: string | null, extra: Record<string, unknown> = {}) => ({
  status: 'ready',
  plan: { version: 2, title: 'LEARNER_1 progress pulse', report, learner, days: 30, explanation: 'Progress Pulse for LEARNER_1 over 30 days.', ...extra },
})

describe.skipIf(!testDb.url)('AI Analytics individual queries (PostgreSQL)', () => {
  beforeAll(async () => { fx = await createLearnerFixture(prisma) })
  afterAll(async () => {
    if (fx) await prisma.adminAnalyticsQuery.deleteMany({ where: { adminId: fx.admin.id } })
    await fx?.cleanup(); await prisma.$disconnect()
  })
  beforeEach(() => bedrock.send.mockReset())

  it('binds an exact email and sends the model only a placeholder', async () => {
    modelReturns(v2('learner_progress', 'LEARNER_1'))
    const answer = await interpretAdminAnalyticsQuestion(`${fx.asha.email} progress pulse for the last 30 days`)
    expect(answer).toMatchObject({ status: 'ready', learner: { id: fx.asha.id }, plan: { version: 2, learnerId: fx.asha.id, report: 'learner_progress' } })
    const prompt = promptSent()
    expect(prompt).toContain('LEARNER_1')
    expect(prompt).not.toContain(fx.asha.email)
    expect(prompt).not.toContain(fx.asha.id)
    if (answer.status === 'ready') expect(JSON.stringify(answer.plan)).not.toContain(fx.asha.email)
  })

  it('returns no-match for an unknown or non-learner email without calling the model', async () => {
    expect(await interpretAdminAnalyticsQuestion(`nobody_${fx.tag}@example.invalid daily activity`)).toMatchObject({ status: 'no_match' })
    expect(await interpretAdminAnalyticsQuestion(`${fx.admin.email} progress pulse`)).toMatchObject({ status: 'no_match' })
    expect(bedrock.send).not.toHaveBeenCalled()
  })

  it('asks the admin to choose between learners who share a name', async () => {
    const ambiguous = await bindLearnerIdentity(`Asha Rao ${fx.nameWord} progress pulse`)
    expect(ambiguous.status).toBe('choose_learner')
    if (ambiguous.status === 'choose_learner') expect(ambiguous.candidates.map((c) => c.id).sort()).toEqual([fx.asha.id, fx.twin.id].sort())
    // Choosing one binds it, and the name is replaced before the model sees it.
    modelReturns(v2('daily_activity', 'LEARNER_1'))
    const chosen = await interpretAdminAnalyticsQuestion(`Asha Rao ${fx.nameWord} daily activity`, { learnerId: fx.twin.id })
    expect(chosen).toMatchObject({ status: 'ready', plan: { learnerId: fx.twin.id } })
    expect(promptSent()).not.toContain(`Rao ${fx.nameWord}`)
  })

  it('binds a unique full name, and turns a named-person question with no match into a learner choice', async () => {
    const quiet = await bindLearnerIdentity(`Quiet Learner ${fx.nameWord} daily activity`)
    expect(quiet).toMatchObject({ status: 'bound', learner: { id: fx.quiet.id } })
    modelReturns({ status: 'learner_required', reason: 'Names a person.' })
    expect(await interpretAdminAnalyticsQuestion('Show Zed Unknownperson progress pulse')).toMatchObject({ status: 'choose_learner', candidates: [] })
  })

  it('rejects model output that invents a learner reference or id', async () => {
    modelReturns(v2('learner_progress', 'LEARNER_2'))
    await expect(interpretAdminAnalyticsQuestion(`${fx.asha.email} progress pulse`)).rejects.toThrow()
    modelReturns(v2('learner_progress', fx.asha.id))
    await expect(interpretAdminAnalyticsQuestion(`${fx.asha.email} progress pulse`)).rejects.toThrow()
    modelReturns({ status: 'ready', plan: { ...v2('learner_progress', null).plan, learnerId: fx.twin.id } })
    await expect(interpretAdminAnalyticsQuestion(`${fx.asha.email} progress pulse`)).rejects.toThrow()
  })

  it('still answers aggregate daily activity without a learner', async () => {
    modelReturns(v2('daily_activity', null, { title: 'Daily activity' }))
    expect(await interpretAdminAnalyticsQuestion('daily activity for the last 30 days')).toMatchObject({ status: 'ready', plan: { version: 2, learnerId: null } })
  })

  it('returns the same figures as the dashboard services, with range, timezone and sample size', async () => {
    const plan = individualPlanSchema.parse({ version: 2, title: 'Learner progress', report: 'learner_progress', learnerId: fx.asha.id, explanation: 'x' })
    const result = await executeIndividualPlan(plan, FIXTURE_NOW)
    const parsed = parseAnalyticsFilters({ days: '30', learner: fx.asha.id }, FIXTURE_NOW)
    if ('error' in parsed) throw new Error(parsed.error)
    const dashboard = await loadLearnerProgress(fx.asha.id, parsed.filters, dayRange(30, 'Asia/Kolkata', FIXTURE_NOW))
    expect(result).toMatchObject({ status: 'ok', range: { timeZone: 'Asia/Kolkata', firstDay: '2026-10-02', lastDay: '2026-10-31' },
      sampleSize: { scoreEntries: 7, sessions: 4 } })
    if (!('progress' in result)) throw new Error('expected progress')
    expect(result.progress).toEqual(dashboard)
    expect(result.missingData.join(' ')).toContain('two different sessions')

    const daily = individualPlanSchema.parse({ version: 2, title: 'Daily', report: 'daily_activity', learnerId: fx.asha.id, feature: 'elevate', explanation: 'x' })
    const activity = await executeIndividualPlan(daily, FIXTURE_NOW)
    const sameDay = await loadDailyActivity({ ...parsed.filters, feature: 'elevate' }, dayRange(30, 'Asia/Kolkata', FIXTURE_NOW), { learnerId: fx.asha.id })
    if (!('activity' in activity)) throw new Error('expected activity')
    expect(activity.activity).toEqual(sameDay)
  })

  it('matches the dashboard route for the same learner and period', async () => {
    const adminToken = token(fx.admin.id, 'ADMIN')
    const plan = { version: 2, title: 'Learner progress', report: 'learner_progress', learnerId: fx.asha.id, days: 30, sources: [], skills: [], feature: null, explanation: 'x' }
    const run = await request(app).post('/analytics/explorer/run').auth(adminToken, { type: 'bearer' }).send({ question: `${fx.asha.email} progress`, plan })
    const dashboard = await request(app).get(`/analytics/progress-pulse?learner=${fx.asha.id}&days=30`).auth(adminToken, { type: 'bearer' })
    expect(run.status).toBe(200)
    expect(run.body.result.progress.summary).toEqual(dashboard.body.report.summary)
    expect(run.body.result.progress.skills).toEqual(dashboard.body.report.skills)
    const dailyRun = await request(app).post('/analytics/explorer/run').auth(adminToken, { type: 'bearer' })
      .send({ plan: { ...plan, report: 'daily_activity', title: 'Daily activity' } })
    const dailyDashboard = await request(app).get(`/analytics/activity/daily?learner=${fx.asha.id}&days=30`).auth(adminToken, { type: 'bearer' })
    expect(dailyRun.body.result.activity.totals).toEqual(dailyDashboard.body.activity.totals)
  })

  it('keeps the target through saved and pinned refreshes and rechecks access each time', async () => {
    const adminToken = token(fx.admin.id, 'ADMIN')
    const plan = { version: 2, title: 'Learner progress', report: 'learner_progress', learnerId: fx.asha.id, days: 30, sources: ['elevate'], skills: [], feature: null, explanation: 'x' }
    const run = await request(app).post('/analytics/explorer/run').auth(adminToken, { type: 'bearer' })
      .send({ question: `${fx.asha.email} progress pulse for the last 30 days`, plan })
    expect(run.status).toBe(200)
    const id = run.body.savedQuery.id
    expect(run.body.savedQuery.question).toBe('[learner] progress pulse for the last 30 days')
    expect(run.body.savedQuery.plan).toMatchObject({ version: 2, learnerId: fx.asha.id })
    await request(app).patch(`/analytics/explorer/saved/${id}`).auth(adminToken, { type: 'bearer' }).send({ pinned: true }).expect(200)

    const refresh = await request(app).post(`/analytics/explorer/saved/${id}/run`).auth(adminToken, { type: 'bearer' }).send({ source: 'auto' })
    expect(refresh.status).toBe(200)
    expect(refresh.body.result).toMatchObject({ kind: 'individual', learner: { id: fx.asha.id } })
    expect(await prisma.adminAction.count({ where: { adminId: fx.admin.id, action: 'analytics_query_refresh', targetUserId: fx.asha.id } })).toBe(1)
    expect((await request(app).get(`/analytics/explorer/saved/${id}/users`).auth(adminToken, { type: 'bearer' })).status).toBe(400)

    // Saved v1 and v2 plans list side by side.
    const v1 = analyticsPlanSchema.parse({ version: 1, title: 'Learners', answerKind: 'aggregate', cohorts: [{ id: 'all', label: 'All', predicates: [] }],
      metrics: [{ type: 'learner_count' }], explanation: 'Count learners.' })
    await request(app).post('/analytics/explorer/run').auth(adminToken, { type: 'bearer' }).send({ plan: v1 }).expect(200)
    const lists = await listAdminAnalyticsQueries(fx.admin.id)
    expect(lists.pinned.map((q) => q.plan.version)).toEqual([2])
    expect(lists.recent.map((q) => q.plan.version)).toContain(1)

    expect((await request(app).post(`/analytics/explorer/saved/${id}/run`).auth(token(fx.asha.id, 'USER'), { type: 'bearer' }).send({})).status).toBe(403)
    await prisma.user.update({ where: { id: fx.admin.id }, data: { role: 'USER' } })
    try {
      expect((await request(app).post(`/analytics/explorer/saved/${id}/run`).auth(adminToken, { type: 'bearer' }).send({ source: 'auto' })).status).toBe(403)
      expect((await request(app).post('/analytics/explorer/run').auth(adminToken, { type: 'bearer' }).send({ plan })).status).toBe(403)
    } finally {
      await prisma.user.update({ where: { id: fx.admin.id }, data: { role: 'ADMIN' } })
    }
  })

  it('redacts identity from stored question text', () => {
    expect(redactQuestion('ASHA@example.invalid and asha@example.invalid daily', null)).toBe('[learner] and [learner] daily')
  })
})
