import { Router, Request, Response } from 'express'
import os from 'os'
import { prisma } from '../../lib/prisma'
const router = Router()

// GET /api/admin/system/health
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const start = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dbLatency = Date.now() - start

    const uptime = process.uptime()
    const memUsage = process.memoryUsage()

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime),
      database: { status: 'connected', latencyMs: dbLatency },
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
      },
      system: {
        platform: os.platform(),
        cpus: os.cpus().length,
        freeMemory: Math.round(os.freemem() / 1024 / 1024),
        totalMemory: Math.round(os.totalmem() / 1024 / 1024),
      },
    })
  } catch (err) {
    console.error('Health check error:', err)
    res.status(503).json({ status: 'unhealthy', error: 'System check failed' })
  }
})

// GET /api/admin/system/metrics
router.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metrics = await prisma.systemMetrics.findMany({
      orderBy: { date: 'desc' },
      take: 30,
    })

    res.json({ metrics })
  } catch (err) {
    console.error('System metrics error:', err)
    res.status(500).json({ error: 'Failed to load metrics' })
  }
})

// GET /api/admin/system/audit
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)

    const [actions, total] = await Promise.all([
      prisma.adminAction.findMany({
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.adminAction.count(),
    ])

    res.json({
      actions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('Audit log error:', err)
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

export default router
