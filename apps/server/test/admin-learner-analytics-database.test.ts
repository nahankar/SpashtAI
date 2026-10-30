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
})
