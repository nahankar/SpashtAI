import { Router, Request, Response } from 'express'
import { recordProductEvent } from '../analytics/recordProductEvent'

const router = Router()

// POST /api/events/track — authenticated product analytics. Admins are acknowledged and not stored.
router.post('/track', async (req: Request, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const body = req.body ?? {}
  const result = await recordProductEvent({
    userId: req.user.userId,
    role: req.user.role,
    source: 'client',
    feature: body.feature,
    action: body.action,
    metadata: body.metadata,
    sessionId: body.sessionId,
    duration: body.duration,
    engagementMs: body.engagementMs,
    outcome: body.outcome,
    path: body.path,
    visitId: body.visitId,
    eventId: body.eventId,
  })

  if (!result.ok && result.error === 'Invalid feature or action') {
    res.status(400).json({ error: result.error })
    return
  }
  if (!result.ok) {
    res.status(500).json({ error: 'Failed to track event' })
    return
  }
  res.json({ ok: true, stored: result.stored, duplicate: result.duplicate === true })
})

export default router
