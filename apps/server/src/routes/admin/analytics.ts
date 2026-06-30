import { Router, Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { getEnabledFeatures, type PlatformFeature } from '../../lib/featureFlags'

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
      enabled.includes('elevate') ? prisma.session.count() : Promise.resolve(0),
      enabled.includes('replay') ? prisma.replaySession.count() : Promise.resolve(0),
      enabled.includes('elevate')
        ? prisma.session.count({ where: { startedAt: { gte: monthAgo } } })
        : Promise.resolve(0),
      enabled.includes('replay')
        ? prisma.replaySession.count({ where: { createdAt: { gte: monthAgo } } })
        : Promise.resolve(0),
    ])

    const sessions: Record<string, unknown> = { enabledFeatures: enabled }
    if (enabled.includes('elevate')) {
      sessions.elevate = { total: totalElevateSessions, thisMonth: recentElevate }
    }
    if (enabled.includes('replay')) {
      sessions.replay = { total: totalReplaySessions, thisMonth: recentReplay }
    }

    res.json({
      users: { total: totalUsers, newToday: newUsersToday, newThisWeek: newUsersWeek, activeThisWeek: activeUsersWeek },
      sessions,
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

export default router
