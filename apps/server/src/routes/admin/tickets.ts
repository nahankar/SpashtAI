import { Router, Request, Response } from 'express'
import path from 'path'
import { prisma } from '../../lib/prisma'

const UPLOAD_DIR = path.resolve(
  process.env.TICKET_UPLOAD_PATH ||
    (process.env.NODE_ENV !== 'production'
      ? path.join(path.dirname(new URL(import.meta.url).pathname), '../../../../../storage/ticket_uploads')
      : './ticket_uploads')
)

const router = Router()

// GET /api/admin/tickets/stats — ticket counts by status
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const [total, open, inProgress, awaitingUser, resolved, closed] = await Promise.all([
      prisma.ticket.count(),
      prisma.ticket.count({ where: { status: 'OPEN' } }),
      prisma.ticket.count({ where: { status: 'IN_PROGRESS' } }),
      prisma.ticket.count({ where: { status: 'AWAITING_USER' } }),
      prisma.ticket.count({ where: { status: 'RESOLVED' } }),
      prisma.ticket.count({ where: { status: 'CLOSED' } }),
    ])

    res.json({ total, open, inProgress, awaitingUser, resolved, closed })
  } catch (err) {
    console.error('Ticket stats error:', err)
    res.status(500).json({ error: 'Failed to fetch ticket stats' })
  }
})

// GET /api/admin/tickets — list all tickets
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const search = (req.query.search as string) || ''
    const status = req.query.status as string | undefined
    const priority = req.query.priority as string | undefined
    const category = req.query.category as string | undefined

    const where: any = {}

    if (search) {
      where.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (status && status !== 'all') {
      where.status = status
    }
    if (priority && priority !== 'all') {
      where.priority = priority
    }
    if (category && category !== 'all') {
      where.category = category
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        select: {
          id: true,
          ticketNumber: true,
          subject: true,
          category: true,
          priority: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
          assignedTo: {
            select: { id: true, email: true, firstName: true },
          },
          _count: { select: { comments: true, attachments: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ])

    res.json({
      tickets,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('Admin list tickets error:', err)
    res.status(500).json({ error: 'Failed to list tickets' })
  }
})

// GET /api/admin/tickets/:id — get ticket detail
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        assignedTo: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        attachments: {
          select: {
            id: true,
            originalName: true,
            fileSize: true,
            mimeType: true,
            createdAt: true,
          },
        },
        comments: {
          include: {
            user: {
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    res.json({ ticket })
  } catch (err) {
    console.error('Admin get ticket error:', err)
    res.status(500).json({ error: 'Failed to get ticket' })
  }
})

// PUT /api/admin/tickets/:id — update ticket status, priority, assignment
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { status, priority, assignedToId } = req.body

    const existing = await prisma.ticket.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    const validStatuses = ['OPEN', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED']
    if (status && !validStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status' })
      return
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    if (priority && !validPriorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid priority' })
      return
    }

    const data: any = {}
    if (status !== undefined) data.status = status
    if (priority !== undefined) data.priority = priority
    if (assignedToId !== undefined) data.assignedToId = assignedToId || null

    // Set resolvedAt when transitioning to RESOLVED or CLOSED
    if (status === 'RESOLVED' || status === 'CLOSED') {
      if (!existing.resolvedAt) {
        data.resolvedAt = new Date()
      }
    } else if (status === 'OPEN' || status === 'IN_PROGRESS') {
      data.resolvedAt = null
    }

    const ticket = await prisma.ticket.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        assignedToId: true,
        resolvedAt: true,
      },
    })

    await prisma.adminAction.create({
      data: {
        adminId: req.user!.userId,
        action: 'ticket_updated',
        targetResource: 'ticket',
        metadata: { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, changes: req.body },
      },
    })

    res.json({ ticket })
  } catch (err) {
    console.error('Admin update ticket error:', err)
    res.status(500).json({ error: 'Failed to update ticket' })
  }
})

// POST /api/admin/tickets/:id/comments — add admin comment
router.post('/:id/comments', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const { content } = req.body

    if (!content || !content.trim()) {
      res.status(400).json({ error: 'Comment content is required' })
      return
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        userId,
        content: content.trim(),
        isAdmin: true,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    })

    res.status(201).json({ comment })
  } catch (err) {
    console.error('Admin add comment error:', err)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// GET /api/admin/tickets/:ticketId/attachments/:attachmentId — serve attachment (admin can view all)
router.get('/:ticketId/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const attachment = await prisma.ticketAttachment.findUnique({
      where: { id: req.params.attachmentId },
    })

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' })
      return
    }

    const resolvedPath = path.resolve(attachment.storedPath)
    if (!resolvedPath.startsWith(path.resolve(UPLOAD_DIR))) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.sendFile(resolvedPath, (err) => {
      if (err) {
        res.status(404).json({ error: 'File not found' })
      }
    })
  } catch (err) {
    console.error('Admin get attachment error:', err)
    res.status(500).json({ error: 'Failed to get attachment' })
  }
})

export default router
