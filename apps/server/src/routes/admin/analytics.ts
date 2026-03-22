import { Router, Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
const router = Router()

// GET /api/admin/analytics/overview
router.get('/overview', async (_req: Request, res: Response) => {
  try {
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
      prisma.user.count({ where: { lastActiveAt: { gte: weekAgo } } }),
      prisma.session.count(),
      prisma.replaySession.count(),
      prisma.session.count({ where: { startedAt: { gte: monthAgo } } }),
      prisma.replaySession.count({ where: { createdAt: { gte: monthAgo } } }),
    ])

    res.json({
      users: { total: totalUsers, newToday: newUsersToday, newThisWeek: newUsersWeek, activeThisWeek: activeUsersWeek },
      sessions: {
        totalElevate: totalElevateSessions,
        totalReplay: totalReplaySessions,
        elevateThisMonth: recentElevate,
        replayThisMonth: recentReplay,
      },
    })
  } catch (err) {
    console.error('Analytics overview error:', err)
    res.status(500).json({ error: 'Failed to load analytics' })
  }
})

// GET /api/admin/analytics/features
router.get('/features', async (req: Request, res: Response) => {
  try {
    const days = Math.min(90, parseInt(req.query.days as string) || 30)
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const usage = await prisma.featureUsage.groupBy({
      by: ['feature', 'action'],
      _count: { id: true },
      where: { timestamp: { gte: since } },
      orderBy: { _count: { id: 'desc' } },
    })

    const recentUsage = await prisma.featureUsage.findMany({
      where: { timestamp: { gte: since } },
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

    res.json({ usage, recentUsage })
  } catch (err) {
    console.error('Feature analytics error:', err)
    res.status(500).json({ error: 'Failed to load feature analytics' })
  }
})

// GET /api/admin/analytics/users
router.get('/users', async (_req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

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
          _count: { select: { sessions: true, replaySessions: true } },
        },
      }),
    ])

    res.json({ roleDistribution, recentRegistrations, topUsers })
  } catch (err) {
    console.error('User analytics error:', err)
    res.status(500).json({ error: 'Failed to load user analytics' })
  }
})

export default router
