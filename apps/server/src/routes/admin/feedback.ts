import path from 'path'
import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import { FEEDBACK_PRIORITIES, FEEDBACK_STATUSES } from '../../lib/feedback'
import { awardFeedbackConsideredPoints } from '../../lib/points'

const router = Router()

// GET /api/admin/feedback/stats
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, open, acknowledged, considered, implemented, parked] = await Promise.all([
      prisma.userFeedback.count(),
      prisma.userFeedback.count({ where: { status: 'OPEN' } }),
      prisma.userFeedback.count({ where: { status: 'ACKNOWLEDGED' } }),
      prisma.userFeedback.count({ where: { status: 'CONSIDERED' } }),
      prisma.userFeedback.count({ where: { status: 'IMPLEMENTED' } }),
      prisma.userFeedback.count({ where: { status: 'PARKED' } }),
    ])
    res.json({ total, open, acknowledged, considered, implemented, parked })
  } catch (err) {
    console.error('Feedback stats error:', err)
    res.status(500).json({ error: 'Failed to fetch feedback stats' })
  }
})

// GET /api/admin/feedback
router.get('/', async (req: Request, res: Response) => {
  try {
    const search = ((req.query.search as string) || '').trim()
    const status = req.query.status as string | undefined
    const priority = req.query.priority as string | undefined
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 100))

    const where: Record<string, unknown> = {}

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { body: { contains: search, mode: 'insensitive' } },
        { feedbackNumber: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (status && status !== 'all' && FEEDBACK_STATUSES.includes(status as any)) {
      where.status = status
    }
    if (priority === 'unset') {
      where.priority = null
    } else if (priority && priority !== 'all' && FEEDBACK_PRIORITIES.includes(priority as any)) {
      where.priority = priority
    }

    const feedback = await prisma.userFeedback.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        attachments: true,
        notes: { orderBy: { createdAt: 'asc' } },
        _count: { select: { notes: true, attachments: true } },
      },
    })

    res.json({ feedback })
  } catch (err) {
    console.error('Admin feedback list error:', err)
    res.status(500).json({ error: 'Failed to load feedback' })
  }
})

// GET /api/admin/feedback/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const item = await prisma.userFeedback.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        attachments: true,
        notes: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!item) return res.status(404).json({ error: 'Not found' })
    res.json({ feedback: item })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feedback' })
  }
})

// PUT /api/admin/feedback/:id — status, priority
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { status, priority } = req.body as { status?: string; priority?: string | null }
    const existing = await prisma.userFeedback.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const data: Record<string, unknown> = {}

    if (status !== undefined) {
      if (!FEEDBACK_STATUSES.includes(status as any)) {
        return res.status(400).json({ error: 'Invalid status' })
      }
      data.status = status
      if (status === 'ACKNOWLEDGED' && existing.status === 'OPEN') {
        data.acknowledgedAt = new Date()
      }
    }

    if (priority !== undefined) {
      if (priority === null || priority === '') {
        data.priority = null
      } else if (FEEDBACK_PRIORITIES.includes(priority as any)) {
        data.priority = priority
      } else {
        return res.status(400).json({ error: 'Invalid priority' })
      }
    }

    const updated = await prisma.userFeedback.update({
      where: { id: req.params.id },
      data,
      include: {
        user: { select: { id: true, email: true, firstName: true, lastName: true } },
        attachments: true,
        notes: { orderBy: { createdAt: 'asc' } },
      },
    })

    let pointsAwarded = 0
    let totalPoints: number | undefined
    if (status === 'CONSIDERED' && existing.status !== 'CONSIDERED') {
      const pts = await awardFeedbackConsideredPoints(existing.userId, existing.id)
      pointsAwarded = pts.awarded
      totalPoints = pts.total
    }

    const feedback =
      pointsAwarded > 0
        ? await prisma.userFeedback.findUnique({
            where: { id: req.params.id },
            include: {
              user: { select: { id: true, email: true, firstName: true, lastName: true } },
              attachments: true,
              notes: { orderBy: { createdAt: 'asc' } },
            },
          })
        : updated

    res.json({ feedback: feedback ?? updated, pointsAwarded, totalPoints })
  } catch (err) {
    console.error('Admin feedback update error:', err)
    res.status(500).json({ error: 'Failed to update feedback' })
  }
})

// POST /api/admin/feedback/:id/notes — optional admin comment to user
router.post('/:id/notes', async (req: Request, res: Response) => {
  try {
    const { body } = req.body as { body?: string }
    if (!body?.trim()) {
      return res.status(400).json({ error: 'body is required' })
    }
    const adminId = (req as Request & { user?: { userId: string } }).user!.userId
    const existing = await prisma.userFeedback.findUnique({ where: { id: req.params.id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const note = await prisma.userFeedbackNote.create({
      data: {
        feedbackId: req.params.id,
        authorId: adminId,
        isAdmin: true,
        body: body.trim(),
      },
    })
    res.status(201).json({ note })
  } catch (err) {
    res.status(500).json({ error: 'Failed to add note' })
  }
})

router.get('/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const attachment = await prisma.userFeedbackAttachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { feedback: true },
    })
    if (!attachment || attachment.feedbackId !== req.params.id) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.sendFile(path.resolve(attachment.storedPath))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load attachment' })
  }
})

export default router
