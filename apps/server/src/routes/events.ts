import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'

const router = Router()

const ALLOWED_FEATURES = new Set(['app', 'elevate', 'replay'])
const MAX_ACTION_LEN = 64

// POST /api/events/track — lightweight product analytics (auth required)
router.post('/track', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const { feature, action, metadata, sessionId, duration } = req.body as {
      feature?: string
      action?: string
      metadata?: Record<string, unknown>
      sessionId?: string
      duration?: number
    }

    if (!feature || !action || !ALLOWED_FEATURES.has(feature)) {
      res.status(400).json({ error: 'Invalid feature or action' })
      return
    }

    const safeAction = String(action).slice(0, MAX_ACTION_LEN)

    await prisma.featureUsage.create({
      data: {
        userId: req.user.userId,
        feature,
        action: safeAction,
        sessionId: sessionId || null,
        duration: typeof duration === 'number' ? Math.round(duration) : null,
        metadata: metadata || undefined,
      },
    })

    res.json({ ok: true })
  } catch (err) {
    console.error('Event track error:', err)
    res.status(500).json({ error: 'Failed to track event' })
  }
})

export default router
