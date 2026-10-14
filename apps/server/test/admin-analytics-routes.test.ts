import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reports = vi.hoisted(() => ({
  loadOverviewHeadlines: vi.fn(),
  loadProgressPulseReport: vi.fn(),
  loadFeatureReport: vi.fn(),
  loadFeatureUsers: vi.fn(),
}))
const explorer = vi.hoisted(() => ({
  interpret: vi.fn(),
  execute: vi.fn(),
  users: vi.fn(),
  save: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  present: vi.fn((value) => value),
  trim: vi.fn(),
}))
const db = vi.hoisted(() => ({
  adminActionCreate: vi.fn().mockResolvedValue({}),
  savedUpdate: vi.fn(),
  savedDelete: vi.fn().mockResolvedValue({}),
}))

vi.mock('../src/lib/prisma', () => ({ prisma: {
  user: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  session: { count: vi.fn().mockResolvedValue(0) },
  replaySession: { count: vi.fn().mockResolvedValue(0) },
  preparation: { count: vi.fn().mockResolvedValue(0) },
  preparationPractice: { count: vi.fn().mockResolvedValue(0) },
  preparationRecording: { count: vi.fn().mockResolvedValue(0) },
  featureUsage: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
  adminAction: { create: db.adminActionCreate },
  adminAnalyticsQuery: { update: db.savedUpdate, delete: db.savedDelete },
} }))
vi.mock('../src/lib/featureFlags', () => ({ getEnabledFeatures: vi.fn().mockResolvedValue(['elevate', 'replay', 'prepare', 'interviews']) }))
vi.mock('../src/analytics/adminProductAnalytics', () => reports)
vi.mock('../src/analytics/adminAnalyticsInterpreter', async () => {
  const actual = await vi.importActual<typeof import('../src/analytics/adminAnalyticsInterpreter')>('../src/analytics/adminAnalyticsInterpreter')
  return { ...actual, interpretAdminAnalyticsQuestion: explorer.interpret }
})
vi.mock('../src/analytics/adminAnalyticsQueryEngine', () => ({
  executeAdminAnalyticsPlan: explorer.execute,
  loadAdminAnalyticsUsers: explorer.users,
}))
vi.mock('../src/analytics/adminAnalyticsSavedQueries', () => ({
  saveAdminAnalyticsQuery: explorer.save,
  listAdminAnalyticsQueries: explorer.list,
  getAdminAnalyticsQuery: explorer.get,
  presentSavedQuery: explorer.present,
  trimAdminAnalyticsRecent: explorer.trim,
}))

import analyticsRouter from '../src/routes/admin/analytics'

describe('admin analytics routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reports.loadOverviewHeadlines.mockResolvedValue({ pulseParticipants: 6, interviewRuns: 2 })
    reports.loadProgressPulseReport.mockResolvedValue({ summary: { users: null, suppressed: true } })
    reports.loadFeatureReport.mockResolvedValue({ summary: { replay: { events: 0, activeTimeStatus: 'not_yet_recorded' } } })
    reports.loadFeatureUsers.mockResolvedValue({ users: [], suppressed: true, page: 1, pageSize: 20 })
    explorer.execute.mockResolvedValue({ planHash: 'hash', cohorts: [], executedAt: 'now', privacyThreshold: 5 })
    explorer.save.mockResolvedValue({ id: 'query-1', planHash: 'hash' })
    explorer.list.mockResolvedValue({ pinned: [], recent: [] })
    explorer.users.mockResolvedValue({ users: [], total: 0, page: 1, pageSize: 20 })
  })

  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role: 'ADMIN' }
    next()
  })
  app.use('/api/admin/analytics', analyticsRouter)

  it('adds pulse and interview headlines without changing session totals', async () => {
    const response = await request(app).get('/api/admin/analytics/overview')
    expect(response.status).toBe(200)
    expect(response.body.headlines).toEqual({ pulseParticipants: 6, interviewRuns: 2 })
  })

  it('rejects an unknown age band before querying', async () => {
    const response = await request(app).get('/api/admin/analytics/progress-pulse?ageBand=ancient')
    expect(response.status).toBe(400)
    expect(reports.loadProgressPulseReport).not.toHaveBeenCalled()
  })

  it('passes a bounded filter set to the pulse and feature reports', async () => {
    const pulse = await request(app).get('/api/admin/analytics/progress-pulse?days=7&gender=FEMALE&pincode=560001')
    const features = await request(app).get('/api/admin/analytics/features/report?days=30')
    const users = await request(app).get('/api/admin/analytics/features/users?feature=replay')
    expect(pulse.status).toBe(200)
    expect(pulse.body.summary.suppressed).toBe(true)
    expect(reports.loadProgressPulseReport).toHaveBeenCalledWith(expect.objectContaining({
      days: 7, genders: ['FEMALE'], pincodes: [],
    }))
    expect(features.status).toBe(200)
    expect(features.body.summary.replay.activeTimeStatus).toBe('not_yet_recorded')
    expect(users.status).toBe(200)
    expect(users.body.suppressed).toBe(true)
  })

  it('returns a plan for review without executing or saving it', async () => {
    const plan = {
      version: 1,
      title: 'Elevate without Replay',
      answerKind: 'users',
      days: null,
      cohorts: [{
        id: 'target',
        label: 'Target learners',
        predicates: [
          { type: 'feature', feature: 'elevate', used: true, timeframe: 'lifetime' },
          { type: 'feature', feature: 'replay', used: false, timeframe: 'lifetime' },
        ],
      }],
      metrics: [{ type: 'learner_count' }],
      breakdown: 'none',
      explanation: 'Learners who used Elevate and never Replay.',
    }
    explorer.interpret.mockResolvedValue({ status: 'ready', plan })
    const response = await request(app)
      .post('/api/admin/analytics/explorer/interpret')
      .send({ question: 'Who used Elevate but never Replay?' })
    expect(response.status).toBe(200)
    expect(response.body.interpretation.plan).toEqual(plan)
    expect(explorer.execute).not.toHaveBeenCalled()
    expect(explorer.save).not.toHaveBeenCalled()
    expect(db.adminActionCreate).not.toHaveBeenCalled()
  })

  it('returns a plan rejection separately from an AI outage', async () => {
    explorer.interpret.mockRejectedValueOnce(new Error('The analytics model did not return JSON'))
    const rejected = await request(app)
      .post('/api/admin/analytics/explorer/interpret')
      .send({ question: 'Who used Elevate?' })
    expect(rejected.status).toBe(422)

    explorer.interpret.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const outage = await request(app)
      .post('/api/admin/analytics/explorer/interpret')
      .send({ question: 'Who used Elevate?' })
    expect(outage.status).toBe(503)
  })

  it('audits a manual refresh and skips the audit for a visible-tab refresh', async () => {
    explorer.get.mockResolvedValue({ row: { id: 'query-1', planHash: 'hash' }, plan: { answerKind: 'aggregate' } })
    db.savedUpdate.mockResolvedValue({ id: 'query-1' })
    const manual = await request(app).post('/api/admin/analytics/explorer/saved/query-1/run').send({})
    expect(manual.status).toBe(200)
    expect(db.adminActionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'analytics_query_refresh' }),
    }))

    db.adminActionCreate.mockClear()
    const automatic = await request(app)
      .post('/api/admin/analytics/explorer/saved/query-1/run')
      .send({ source: 'auto' })
    expect(automatic.status).toBe(200)
    expect(db.adminActionCreate).not.toHaveBeenCalled()
  })

  it('returns clarification without executing a query', async () => {
    explorer.interpret.mockResolvedValue({ status: 'clarification', question: 'Which feature?' })
    const response = await request(app)
      .post('/api/admin/analytics/explorer/interpret')
      .send({ question: 'Show usage' })
    expect(response.status).toBe(200)
    expect(response.body.interpretation.status).toBe('clarification')
    expect(explorer.execute).not.toHaveBeenCalled()
  })

  it('keeps saved queries and identity pages scoped to the current admin', async () => {
    const plan = { answerKind: 'users' }
    explorer.get.mockResolvedValue({ row: { id: 'query-1', planHash: 'hash' }, plan })
    const saved = await request(app).get('/api/admin/analytics/explorer/saved')
    const users = await request(app).get('/api/admin/analytics/explorer/saved/query-1/users?page=2')
    expect(saved.status).toBe(200)
    expect(explorer.list).toHaveBeenCalledWith('admin-1')
    expect(users.status).toBe(200)
    expect(explorer.get).toHaveBeenCalledWith('admin-1', 'query-1')
    expect(explorer.users).toHaveBeenCalledWith(plan, 2)
    expect(db.adminActionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'analytics_identity_list_viewed' }),
    }))
  })

  it('pins, configures, and removes only an owned saved query', async () => {
    explorer.get.mockResolvedValue({ row: { id: 'query-1', planHash: 'hash' }, plan: {} })
    db.savedUpdate.mockResolvedValue({ id: 'query-1', pinned: true, refreshIntervalSec: 60 })
    const updated = await request(app)
      .patch('/api/admin/analytics/explorer/saved/query-1')
      .send({ pinned: true, refreshIntervalSec: 60 })
    expect(updated.status).toBe(200)
    expect(db.savedUpdate).toHaveBeenCalledWith({
      where: { id: 'query-1' },
      data: { pinned: true, refreshIntervalSec: 60 },
    })

    db.savedUpdate.mockResolvedValue({ id: 'query-1', pinned: false, refreshIntervalSec: 60 })
    const unpinned = await request(app)
      .patch('/api/admin/analytics/explorer/saved/query-1')
      .send({ pinned: false })
    expect(unpinned.status).toBe(200)
    expect(explorer.trim).toHaveBeenCalledWith('admin-1')

    const removed = await request(app).delete('/api/admin/analytics/explorer/saved/query-1')
    expect(removed.status).toBe(204)
    expect(db.savedDelete).toHaveBeenCalledWith({ where: { id: 'query-1' } })
  })
})
