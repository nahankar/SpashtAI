import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Learner analytics tests use only the isolated simple_bank database')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: vi.fn().mockResolvedValue(['elevate', 'replay', 'prepare', 'interviews']) }))
import { prisma } from '../src/lib/prisma'
import { parseAnalyticsFilters } from '../src/analytics/adminAnalyticsFilters'
import { dayRange, learnerFilterMatch, loadLearnerProgress, searchLearners, zonedMidnight } from '../src/analytics/learnerReport'
import { loadDailyActivity } from '../src/analytics/dailyActivity'
import analyticsRouter from '../src/routes/admin/analytics'
import { requireAuth } from '../src/middleware/auth'
import { requireAdmin } from '../src/middleware/admin'
import { signToken } from '../src/lib/jwt'
import { createLearnerFixture, FIXTURE_NOW, type LearnerFixture } from './fixtures/learner-analytics'

const app = express(); app.use(express.json()); app.use('/analytics', requireAuth, requireAdmin, analyticsRouter)
let fx: LearnerFixture
const token = (userId: string, role: string) => signToken({ userId, email: 'learner-analytics-test@example.invalid', role })
const filtersFor = (query: Record<string, string>) => {
  const parsed = parseAnalyticsFilters({ days: '30', ...query }, FIXTURE_NOW)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.filters
}

describe('IST day ranges', () => {
  it('starts each range at local midnight and labels days in Asia/Kolkata', () => {
    expect(zonedMidnight('2026-10-29', 'Asia/Kolkata').toISOString()).toBe('2026-10-28T18:30:00.000Z')
    const range = dayRange(7, 'Asia/Kolkata', new Date('2026-10-30T19:00:00Z')) // 31 Oct 00:30 IST
    expect(range).toMatchObject({ firstDay: '2026-10-25', lastDay: '2026-10-31' })
    expect(range.days).toHaveLength(7)
    expect(range.since.toISOString()).toBe('2026-10-24T18:30:00.000Z')
  })
})

describe.skipIf(!testDb.url)('individual learner reporting (PostgreSQL)', () => {
  beforeAll(async () => { fx = await createLearnerFixture(prisma) })
  afterAll(async () => { await fx?.cleanup(); await prisma.$disconnect() })

  it('finds both same-name learners with distinguishing details, never admins', async () => {
    const found = await searchLearners(`Rao ${fx.tag}`)
    expect(found.map(l => l.id).sort()).toEqual([fx.asha.id, fx.twin.id].sort())
    expect(found.every(l => l.email && l.joinedAt)).toBe(true)
    expect(found.map(l => l.city).sort()).toEqual(['Mysuru', 'Pune'])
    expect(await searchLearners(`${fx.tag}_admin`)).toEqual([])
    expect((await searchLearners(fx.asha.email))[0].id).toBe(fx.asha.id)
    expect(await searchLearners('%')).toEqual([]) // too short, and wildcards are literal
  })

  it('reports eligible Pulse evidence per skill without inventing change', async () => {
    const report = await loadLearnerProgress(fx.asha.id, filtersFor({}), dayRange(30, 'Asia/Kolkata', FIXTURE_NOW))
    // 7 eligible entries: legacy Replay and Interviews entries are excluded.
    expect(report.summary).toMatchObject({ scoreEntries: 7, sessionsRepresented: 4, skillsMeasured: 5 })
    const skill = (name: string) => report.skills.find(s => s.skill === name)!
    expect(skill('clarity')).toMatchObject({ samples: 2, observations: 2, first: { score: 5 }, latest: { score: 7 }, change: 2, direction: 'improving' })
    expect(skill('pacing')).toMatchObject({ change: 0.1, direction: 'stable' })
    expect(skill('confidence')).toMatchObject({ samples: 1, change: null, direction: null })
    expect(skill('structure')).toMatchObject({ latest: { source: 'replay' }, change: null })
    expect(report.history.some(h => h.score === 9 || h.score === 1)).toBe(false)
    // The 18:59 UTC entry lands on the IST day after.
    expect(skill('engagement').latest.day).toBe('2026-10-29')
    // Days without scores are absent, not zero.
    expect(report.daily.map(d => d.day)).toEqual(['2026-10-20', '2026-10-20', '2026-10-25', '2026-10-25', '2026-10-25', '2026-10-27', '2026-10-29'])
    expect(report.daily.every(d => d.samples > 0)).toBe(true)
  })

  it('lists tracking decisions per session, excluding Interviews', async () => {
    const report = await loadLearnerProgress(fx.asha.id, filtersFor({}), dayRange(30, 'Asia/Kolkata', FIXTURE_NOW))
    expect(report.decisions.counts).toEqual([
      { source: 'elevate', sessions: 4, tracked: 2, skipped: 0, undecided: 1, open: 1 },
      { source: 'replay', sessions: 2, tracked: 1, skipped: 1, undecided: 0, open: 0 },
    ])
    expect(report.decisions.sessions.some(s => s.sessionId === fx.sessions.interview.id)).toBe(false)
  })

  it('applies source and skill filters to the individual evidence', async () => {
    const report = await loadLearnerProgress(fx.asha.id, filtersFor({ source: 'replay' }), dayRange(30, 'Asia/Kolkata', FIXTURE_NOW))
    expect(report.summary.scoreEntries).toBe(1)
    expect(report.decisions.counts.map(c => c.source)).toEqual(['replay'])
    const clarity = await loadLearnerProgress(fx.asha.id, filtersFor({ skill: 'clarity' }), dayRange(30, 'Asia/Kolkata', FIXTURE_NOW))
    expect(clarity.skills.map(s => s.skill)).toEqual(['clarity'])
  })

  it('explains which conflicting demographic filter excludes the learner', async () => {
    expect(await learnerFilterMatch(fx.asha.id, filtersFor({ gender: 'MALE' }))).toEqual({ matches: false, excludedBy: ['gender'] })
    expect(await learnerFilterMatch(fx.asha.id, filtersFor({ gender: 'FEMALE' }))).toEqual({ matches: true, excludedBy: [] })
  })

  it('serves individual mode only to a current Admin, audits access, and keeps aggregate suppression', async () => {
    const adminToken = token(fx.admin.id, 'ADMIN')
    expect((await request(app).get(`/analytics/learners/search?q=Rao%20${fx.tag}`).auth(token(fx.asha.id, 'USER'), { type: 'bearer' })).status).toBe(403)
    const ok = await request(app).get(`/analytics/progress-pulse?learner=${fx.asha.id}`).auth(adminToken, { type: 'bearer' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ mode: 'individual', learner: { id: fx.asha.id }, match: { matches: true }, range: { timeZone: 'Asia/Kolkata' } })
    expect(ok.body.report.summary.scoreEntries).toBeGreaterThan(0)
    const audit = await prisma.adminAction.findFirst({ where: { adminId: fx.admin.id, action: 'analytics_individual_report_viewed' }, orderBy: { timestamp: 'desc' } })
    expect(audit).toMatchObject({ targetUserId: fx.asha.id })
    expect(JSON.stringify(audit?.metadata)).not.toContain('score')

    const noMatch = await request(app).get(`/analytics/progress-pulse?learner=${fx.asha.id}&gender=MALE`).auth(adminToken, { type: 'bearer' })
    expect(noMatch.body).toMatchObject({ match: { matches: false, excludedBy: ['gender'] }, report: null })
    expect((await request(app).get(`/analytics/progress-pulse?learner=${fx.admin.id}`).auth(adminToken, { type: 'bearer' })).status).toBe(404)
    expect((await request(app).get('/analytics/progress-pulse?learner=someone@example.com').auth(adminToken, { type: 'bearer' })).status).toBe(400)

    // A demographic filter matching fewer than five learners stays suppressed in aggregate mode.
    const aggregate = await request(app).get(`/analytics/progress-pulse?city=Pune`).auth(adminToken, { type: 'bearer' })
    if (aggregate.body.summary.suppressed === false) expect(aggregate.body.summary.users).toBeGreaterThanOrEqual(5)
    else expect(aggregate.body.summary).toMatchObject({ users: null, suppressed: true })

    // Revoked Admin: the old token no longer reaches individual data.
    await prisma.user.update({ where: { id: fx.admin.id }, data: { role: 'USER' } })
    try {
      expect((await request(app).get(`/analytics/progress-pulse?learner=${fx.asha.id}`).auth(adminToken, { type: 'bearer' })).status).toBe(403)
      expect((await request(app).get(`/analytics/learners/search?q=Rao%20${fx.tag}`).auth(adminToken, { type: 'bearer' })).status).toBe(403)
    } finally {
      await prisma.user.update({ where: { id: fx.admin.id }, data: { role: 'ADMIN' } })
    }
  })

  describe('daily activity', () => {
    const range = () => dayRange(30, 'Asia/Kolkata', FIXTURE_NOW)
    const individual = async (query: Record<string, string> = {}) => {
      const result = await loadDailyActivity(filtersFor(query), range(), { learnerId: fx.asha.id })
      if ('error' in result || result.suppressed) throw new Error('unexpected')
      return result
    }
    const dayOf = (result: Awaited<ReturnType<typeof individual>>, day: string) => result.days.find((d) => d.day === day)!
    const feature = (row: ReturnType<typeof dayOf>, name: string) => row.features.find((f) => f.feature === name)!

    it('keeps page views, actions, starts and completions as separate measures on IST days', async () => {
      const result = await individual()
      expect(result.days).toHaveLength(30)
      const oct20 = feature(dayOf(result, '2026-10-20'), 'elevate')
      // results_viewed is not a feature-use action; the page view is not an action either.
      expect(oct20).toMatchObject({ pageViews: 1, actions: 2, starts: 1, completions: 1, activeMs: 60_000, activeLearners: 1 })
      // 18:45 UTC on 28 Oct counts on 29 Oct IST.
      expect(feature(dayOf(result, '2026-10-29'), 'elevate')).toMatchObject({ actions: 1, starts: 1, completions: 1 })
      expect(feature(dayOf(result, '2026-10-28'), 'elevate')).toMatchObject({ starts: 0, actions: 0 })
      expect(feature(dayOf(result, '2026-10-27'), 'replay')).toMatchObject({ starts: 1, completions: 1 })
      expect(feature(dayOf(result, '2026-10-26'), 'interviews')).toMatchObject({ pageViews: 1, actions: 1, starts: 1, completions: 1 })
    })

    it('reports Interviews activity without counting it as Pulse evidence', async () => {
      const result = await individual()
      expect(dayOf(result, '2026-10-26').pulseEntries).toBe(0)
      expect(result.totals).toMatchObject({ pulseEntries: 7, pulseSessions: 4 })
      expect(dayOf(result, '2026-10-25')).toMatchObject({ pulseEntries: 3, pulseSessions: 1 }) // three skills, one session
    })

    it('marks unrecorded and not-applicable measures instead of zero', async () => {
      const result = await individual()
      expect(result.recordedSince.progress_pulse.starts).toBe('not_applicable')
      expect(feature(dayOf(result, '2026-10-20'), 'progress_pulse').starts).toBeNull()
      for (const name of Object.keys(result.recordedSince)) {
        for (const [measure, first] of Object.entries(result.recordedSince[name])) {
          for (const day of result.days) {
            const value = feature(day, name)[measure as 'pageViews']
            if (first === null || first === 'not_applicable' || day.day < first) expect(value).toBeNull()
            else expect(value).not.toBeNull()
          }
        }
      }
    })

    it('scopes features and sources independently', async () => {
      const result = await individual({ source: 'elevate', feature: 'replay' })
      expect(result.scope.activity.features).toEqual(['replay'])
      expect(result.scope.pulse.sources).toEqual(['elevate'])
      expect(result.days.every((d) => d.features.every((f) => f.feature === 'replay'))).toBe(true)
      // Pulse entries follow the source filter only: six Elevate entries, regardless of the Replay activity filter.
      expect(result.totals.pulseEntries).toBe(6)
      // The Elevate page view on 20 Oct does not leak into the Replay scope (zero, or not recorded yet).
      expect(dayOf(result, '2026-10-20').pageViews ?? 0).toBe(0)
      await expect(loadDailyActivity(filtersFor({ feature: 'app' }), range(), null)).resolves.toEqual({ error: 'Invalid activity feature' })
    })

    it('counts distinct learners without double counting across features, excluding admins', async () => {
      const result = await loadDailyActivity(filtersFor({}), range(), null)
      if ('error' in result || result.suppressed) throw new Error('unexpected')
      const oct27 = result.days.find((d) => d.day === '2026-10-27')!
      const byFeature = Object.fromEntries(oct27.features.map((f) => [f.feature, f.activeLearners]))
      // quiet used Replay and Prepare and asha used Replay: two learners that day, not three; the admin is not counted.
      expect(oct27.activeLearners).toBeGreaterThanOrEqual(2)
      expect(oct27.activeLearners).toBeLessThan(byFeature.replay + byFeature.prepare + byFeature.elevate + 1)
      expect(result.totals.activeLearners).toBeLessThanOrEqual(result.totals.byFeature.reduce((sum, f) => sum + f.activeLearners, 0))
    })

    it('suppresses small demographic cohorts in aggregate mode only', async () => {
      const aggregate = await loadDailyActivity(filtersFor({ city: 'Pune' }), range(), null)
      expect(aggregate).toMatchObject({ suppressed: true, days: null, totals: null })
      const one = await loadDailyActivity(filtersFor({ city: 'Pune' }), range(), { learnerId: fx.asha.id })
      expect(one).toMatchObject({ suppressed: false })
    })

    it('reports a learner with activity but no Pulse scores', async () => {
      const result = await loadDailyActivity(filtersFor({}), range(), { learnerId: fx.quiet.id })
      if ('error' in result || result.suppressed) throw new Error('unexpected')
      expect(result.totals.pulseEntries).toBe(0)
      expect(result.days.find((d) => d.day === '2026-10-27')).toMatchObject({ activeLearners: 1, pageViews: 2, activeMs: 45_000 })
    })

    it('serves the daily route with the same individual checks and audit', async () => {
      const adminToken = token(fx.admin.id, 'ADMIN')
      const ok = await request(app).get(`/analytics/activity/daily?learner=${fx.asha.id}&feature=elevate`).auth(adminToken, { type: 'bearer' })
      expect(ok.status).toBe(200)
      expect(ok.body).toMatchObject({ learner: { id: fx.asha.id }, range: { timeZone: 'Asia/Kolkata' }, activity: { mode: 'individual' } })
      expect(await prisma.adminAction.count({ where: { adminId: fx.admin.id, targetUserId: fx.asha.id, action: 'analytics_individual_report_viewed' } })).toBeGreaterThan(0)
      expect((await request(app).get(`/analytics/activity/daily?learner=${fx.asha.id}`).auth(token(fx.asha.id, 'USER'), { type: 'bearer' })).status).toBe(403)
      const conflict = await request(app).get(`/analytics/activity/daily?learner=${fx.asha.id}&gender=MALE`).auth(adminToken, { type: 'bearer' })
      expect(conflict.body).toMatchObject({ match: { matches: false }, activity: null })
    })
  })
})
