import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { getEnabledFeatures } from '../../lib/featureFlags'
import { parseAnalyticsFilters } from '../../analytics/adminAnalyticsFilters'
import {
  loadFeatureReport,
  loadFeatureUsers,
  loadOverviewHeadlines,
  loadPageViewReport,
  loadProgressPulseReport,
} from '../../analytics/adminProductAnalytics'
import { interpretAdminAnalyticsQuestion, isAnalyticsPlanRejection } from '../../analytics/adminAnalyticsInterpreter'
import { adminAnalyticsPlanSchema } from '../../analytics/adminAnalyticsQuerySchema'
import { executeAdminAnalyticsPlan, loadAdminAnalyticsUsers } from '../../analytics/adminAnalyticsQueryEngine'
import {
  getAdminAnalyticsQuery,
  listAdminAnalyticsQueries,
  presentSavedQuery,
  saveAdminAnalyticsQuery,
  trimAdminAnalyticsRecent,
} from '../../analytics/adminAnalyticsSavedQueries'

const router = Router()

// GET /api/admin/analytics/overview
router.get('/overview', async (_req: Request, res: Response) => {
  try {
    const enabled = await getEnabledFeatures()
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

    const [
      totalUsers,
      newUsersToday,
      newUsersWeek,
      activeUsersWeek,
      totalElevateSessions,
      totalReplaySessions,
      recentElevate,
      recentReplay,
      totalPrepareJourneys,
      recentPrepareJourneys,
      totalEventPractices,
      recentEventPractices,
      totalEventRecordings,
      recentEventRecordings,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.user.count({
        where: {
          lastActiveAt: { gte: weekAgo },
          role: { notIn: ['ADMIN', 'SUPER_ADMIN'] },
        },
      }),
      enabled.includes('elevate')
        ? prisma.session.count({ where: { discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null } })
        : Promise.resolve(0),
      enabled.includes('replay') ? prisma.replaySession.count({ where: { purpose: 'COMMUNICATION', preparationRecording: null } }) : Promise.resolve(0),
      enabled.includes('elevate')
        ? prisma.session.count({
            where: { startedAt: { gte: monthAgo }, discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null },
          })
        : Promise.resolve(0),
      enabled.includes('replay')
        ? prisma.replaySession.count({ where: { createdAt: { gte: monthAgo }, purpose: 'COMMUNICATION', preparationRecording: null } })
        : Promise.resolve(0),
      enabled.includes('prepare') ? prisma.preparation.count() : Promise.resolve(0),
      enabled.includes('prepare')
        ? prisma.preparation.count({ where: { createdAt: { gte: monthAgo } } })
        : Promise.resolve(0),
      enabled.includes('prepare')
        ? prisma.preparationPractice.count({ where: { session: { discardedAt: null } } })
        : Promise.resolve(0),
      enabled.includes('prepare')
        ? prisma.preparationPractice.count({ where: { createdAt: { gte: monthAgo }, session: { discardedAt: null } } })
        : Promise.resolve(0),
      enabled.includes('prepare') ? prisma.preparationRecording.count() : Promise.resolve(0),
      enabled.includes('prepare')
        ? prisma.preparationRecording.count({ where: { createdAt: { gte: monthAgo } } })
        : Promise.resolve(0),
    ])

    const sessions: Record<string, unknown> = { enabledFeatures: enabled }
    if (enabled.includes('elevate')) {
      sessions.elevate = { total: totalElevateSessions, thisMonth: recentElevate }
    }
    if (enabled.includes('replay')) {
      sessions.replay = { total: totalReplaySessions, thisMonth: recentReplay }
    }
    if (enabled.includes('prepare')) {
      sessions.prepare = {
        journeys: { total: totalPrepareJourneys, thisMonth: recentPrepareJourneys },
        eventPractices: { total: totalEventPractices, thisMonth: recentEventPractices },
        eventRecordings: { total: totalEventRecordings, thisMonth: recentEventRecordings },
      }
    }

    const headlines = await loadOverviewHeadlines().catch(() => ({ pulseParticipants: 0, interviewRuns: 0 }))

    res.json({
      users: { total: totalUsers, newToday: newUsersToday, newThisWeek: newUsersWeek, activeThisWeek: activeUsersWeek },
      sessions,
      headlines,
    })
  } catch (err) {
    console.error('Analytics overview error:', err)
    res.status(500).json({ error: 'Failed to load analytics' })
  }
})

// GET /api/admin/analytics/features
router.get('/features', async (req: Request, res: Response) => {
  try {
    const enabled = await getEnabledFeatures()
    const days = Math.min(90, parseInt(req.query.days as string) || 30)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const trackedFeatures = [...enabled, 'app']

    // Analytics reflect end-user behavior only — exclude admin/super-admin activity.
    const adminUsers = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: { id: true },
    })
    const adminIds = adminUsers.map((u) => u.id)

    const usage = await prisma.featureUsage.groupBy({
      by: ['feature', 'action'],
      _count: { id: true },
      where: {
        timestamp: { gte: since },
        feature: { in: trackedFeatures },
        userId: { notIn: adminIds },
      },
      orderBy: { _count: { id: 'desc' } },
    })

    const recentUsage = await prisma.featureUsage.findMany({
      where: {
        timestamp: { gte: since },
        feature: { in: trackedFeatures },
        userId: { notIn: adminIds },
      },
      orderBy: { timestamp: 'desc' },
      take: 100,
      select: {
        feature: true,
        action: true,
        timestamp: true,
        duration: true,
        user: { select: { email: true, firstName: true } },
      },
    })

    res.json({ usage, recentUsage, enabledFeatures: enabled })
  } catch (err) {
    console.error('Feature analytics error:', err)
    res.status(500).json({ error: 'Failed to load feature analytics' })
  }
})

// GET /api/admin/analytics/users
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const enabled = await getEnabledFeatures()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    const sessionCountSelect: { sessions?: boolean; replaySessions?: boolean } = {}
    if (enabled.includes('elevate')) sessionCountSelect.sessions = true
    if (enabled.includes('replay')) sessionCountSelect.replaySessions = true

    const [roleDistribution, recentRegistrations, topUsers] = await Promise.all([
      prisma.user.groupBy({
        by: ['role'],
        _count: { id: true },
      }),
      prisma.user.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      }),
      prisma.user.findMany({
        orderBy: { loginCount: 'desc' },
        take: 10,
        select: {
          id: true,
          email: true,
          firstName: true,
          loginCount: true,
          lastActiveAt: true,
          ...(Object.keys(sessionCountSelect).length > 0
            ? { _count: { select: sessionCountSelect } }
            : {}),
        },
      }),
    ])

    res.json({ roleDistribution, recentRegistrations, topUsers, enabledFeatures: enabled })
  } catch (err) {
    console.error('User analytics error:', err)
    res.status(500).json({ error: 'Failed to load user analytics' })
  }
})

function filtersFrom(req: Request, res: Response) {
  const parsed = parseAnalyticsFilters(req.query as Record<string, unknown>)
  if ('error' in parsed) {
    res.status(400).json({ error: parsed.error })
    return null
  }
  return parsed.filters
}

router.get('/progress-pulse', async (req: Request, res: Response) => {
  try {
    const filters = filtersFrom(req, res)
    if (!filters) return
    res.json(await loadProgressPulseReport(filters))
  } catch (err) {
    console.error('Progress pulse analytics error:', err)
    res.status(500).json({ error: 'Failed to load progress pulse analytics' })
  }
})

router.get('/page-views', async (req: Request, res: Response) => {
  try {
    const filters = filtersFrom(req, res)
    if (!filters) return
    res.json(await loadPageViewReport(filters))
  } catch (err) {
    console.error('Page-view analytics error:', err)
    res.status(500).json({ error: 'Failed to load page-view analytics' })
  }
})

router.get('/features/report', async (req: Request, res: Response) => {
  try {
    const filters = filtersFrom(req, res)
    if (!filters) return
    res.json(await loadFeatureReport(filters))
  } catch (err) {
    console.error('Feature report error:', err)
    res.status(500).json({ error: 'Failed to load feature analytics' })
  }
})

router.get('/features/users', async (req: Request, res: Response) => {
  try {
    const filters = filtersFrom(req, res)
    if (!filters) return
    const report = await loadFeatureUsers(filters)
    if ('error' in report) {
      res.status(400).json({ error: report.error })
      return
    }
    res.json(report)
  } catch (err) {
    console.error('Feature user analytics error:', err)
    res.status(500).json({ error: 'Failed to load feature users' })
  }
})

const explorerAiLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  keyGenerator: (req) => req.user?.userId || 'anonymous',
  message: { error: 'Too many AI analytics questions. Please wait a moment.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const questionSchema = z.object({ question: z.string().trim().min(1).max(1_000) }).strict()
const runSchema = z.object({
  question: z.string().trim().min(1).max(1_000).optional(),
  plan: adminAnalyticsPlanSchema,
}).strict()
const savedUpdateSchema = z.object({
  pinned: z.boolean().optional(),
  title: z.string().trim().min(1).max(100).optional(),
  refreshIntervalSec: z.union([z.literal(30), z.literal(60), z.literal(300)]).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'No changes supplied')

async function auditExplorer(adminId: string, action: string, queryId: string, metadata?: Record<string, unknown>) {
  await prisma.adminAction.create({
    data: {
      adminId,
      action,
      targetResource: `admin-analytics-query:${queryId}`,
      metadata: metadata as never,
    },
  })
}

router.post('/explorer/interpret', explorerAiLimiter, async (req: Request, res: Response) => {
  const parsed = questionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Question must be between 1 and 1000 characters' })
    return
  }
  try {
    const interpretation = await interpretAdminAnalyticsQuestion(parsed.data.question)
    res.json({ interpretation })
  } catch (error) {
    console.error('AI analytics interpretation error:', error)
    if (isAnalyticsPlanRejection(error)) {
      res.status(422).json({ error: 'That question could not be turned into an analytics plan. Try rephrasing it.' })
      return
    }
    res.status(503).json({ error: 'AI analytics is temporarily unavailable. Please retry.' })
  }
})

router.post('/explorer/run', async (req: Request, res: Response) => {
  const parsed = runSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid analytics query plan' })
    return
  }
  try {
    const adminId = req.user!.userId
    const question = parsed.data.question ?? parsed.data.plan.title
    const [result, saved] = await Promise.all([
      executeAdminAnalyticsPlan(parsed.data.plan),
      saveAdminAnalyticsQuery(adminId, question, parsed.data.plan),
    ])
    await auditExplorer(adminId, 'analytics_query_run', saved.id, { planHash: result.planHash, aiInterpreted: false })
    res.json({ result, savedQuery: presentSavedQuery(saved) })
  } catch (error) {
    console.error('Analytics explorer run error:', error)
    res.status(500).json({ error: 'Failed to run analytics query' })
  }
})

router.get('/explorer/saved', async (req: Request, res: Response) => {
  try {
    res.json(await listAdminAnalyticsQueries(req.user!.userId))
  } catch (error) {
    console.error('Analytics explorer saved-query error:', error)
    res.status(500).json({ error: 'Failed to load saved analytics queries' })
  }
})

const refreshSchema = z.object({
  source: z.enum(['auto', 'manual']).optional(),
}).strict()

router.post('/explorer/saved/:id/run', async (req: Request, res: Response) => {
  const parsed = refreshSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid analytics refresh' })
    return
  }
  try {
    const found = await getAdminAnalyticsQuery(req.user!.userId, req.params.id)
    if (!found) {
      res.status(404).json({ error: 'Saved query not found' })
      return
    }
    const result = await executeAdminAnalyticsPlan(found.plan)
    const saved = await prisma.adminAnalyticsQuery.update({
      where: { id: found.row.id },
      data: { lastRunAt: new Date() },
    })
    if (parsed.data.source !== 'auto') {
      await auditExplorer(req.user!.userId, 'analytics_query_refresh', saved.id, { planHash: result.planHash })
    }
    res.json({ result, savedQuery: presentSavedQuery(saved) })
  } catch (error) {
    console.error('Analytics explorer refresh error:', error)
    res.status(500).json({ error: 'Failed to refresh analytics query' })
  }
})

router.get('/explorer/saved/:id/users', async (req: Request, res: Response) => {
  try {
    const found = await getAdminAnalyticsQuery(req.user!.userId, req.params.id)
    if (!found) {
      res.status(404).json({ error: 'Saved query not found' })
      return
    }
    const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1)
    const users = await loadAdminAnalyticsUsers(found.plan, page)
    if ('error' in users) {
      res.status(400).json(users)
      return
    }
    await auditExplorer(req.user!.userId, 'analytics_identity_list_viewed', found.row.id, {
      planHash: found.row.planHash,
      page: users.page,
    })
    res.json(users)
  } catch (error) {
    console.error('Analytics explorer user-list error:', error)
    res.status(500).json({ error: 'Failed to load matching users' })
  }
})

router.patch('/explorer/saved/:id', async (req: Request, res: Response) => {
  const parsed = savedUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid saved-query update' })
    return
  }
  try {
    const found = await getAdminAnalyticsQuery(req.user!.userId, req.params.id)
    if (!found) {
      res.status(404).json({ error: 'Saved query not found' })
      return
    }
    const saved = await prisma.adminAnalyticsQuery.update({
      where: { id: found.row.id },
      data: parsed.data,
    })
    if (parsed.data.pinned === false) await trimAdminAnalyticsRecent(req.user!.userId)
    await auditExplorer(req.user!.userId, 'analytics_query_updated', saved.id, parsed.data)
    res.json(presentSavedQuery(saved))
  } catch (error) {
    console.error('Analytics explorer update error:', error)
    res.status(500).json({ error: 'Failed to update saved analytics query' })
  }
})

router.delete('/explorer/saved/:id', async (req: Request, res: Response) => {
  try {
    const found = await getAdminAnalyticsQuery(req.user!.userId, req.params.id)
    if (!found) {
      res.status(404).json({ error: 'Saved query not found' })
      return
    }
    await prisma.adminAnalyticsQuery.delete({ where: { id: found.row.id } })
    await auditExplorer(req.user!.userId, 'analytics_query_deleted', found.row.id, { planHash: found.row.planHash })
    res.status(204).end()
  } catch (error) {
    console.error('Analytics explorer delete error:', error)
    res.status(500).json({ error: 'Failed to delete saved analytics query' })
  }
})

export default router
