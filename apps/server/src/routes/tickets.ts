import { Router, Request, Response } from 'express'
import multer from 'multer'
import path from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import { fileURLToPath } from 'url'
import { prisma } from '../lib/prisma'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDev = process.env.NODE_ENV !== 'production'

const UPLOAD_DIR = path.resolve(
  process.env.TICKET_UPLOAD_PATH ||
    (isDev
      ? path.join(__dirname, '../../../../storage/ticket_uploads')
      : './ticket_uploads')
)

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }
    cb(null, UPLOAD_DIR)
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ext = path.extname(file.originalname)
    cb(null, `${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per file
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true)
    } else {
      cb(new Error('Only image files are allowed'))
    }
  },
})

const router = Router()

// GET /api/tickets — list current user's tickets
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const status = req.query.status as string | undefined
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))

    const where: any = { userId }
    if (status && status !== 'all') {
      where.status = status
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
    console.error('List tickets error:', err)
    res.status(500).json({ error: 'Failed to list tickets' })
  }
})

// GET /api/tickets/:id — get ticket detail with comments
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
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
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    })

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    // Users can only view their own tickets
    if (ticket.userId !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    res.json({ ticket })
  } catch (err) {
    console.error('Get ticket error:', err)
    res.status(500).json({ error: 'Failed to get ticket' })
  }
})

// POST /api/tickets — create a new ticket
router.post('/', upload.array('screenshots', 5), async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const { subject, description, category, priority } = req.body

    if (!subject || !description || !category) {
      res.status(400).json({ error: 'Subject, description, and category are required' })
      return
    }

    const validCategories = ['BUG', 'FEATURE_REQUEST', 'ACCOUNT_ISSUE', 'BILLING', 'OTHER']
    if (!validCategories.includes(category)) {
      res.status(400).json({ error: 'Invalid category' })
      return
    }

    const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    if (priority && !validPriorities.includes(priority)) {
      res.status(400).json({ error: 'Invalid priority' })
      return
    }

    // Generate ticket number
    const count = await prisma.ticket.count()
    const ticketNumber = `TKT-${String(count + 1).padStart(4, '0')}`

    // Auto-assign to an admin with fewest open tickets
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } },
      select: {
        id: true,
        _count: {
          select: {
            assignedTickets: {
              where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
            },
          },
        },
      },
    })

    let assignedToId: string | null = null
    if (admins.length > 0) {
      admins.sort((a, b) => a._count.assignedTickets - b._count.assignedTickets)
      assignedToId = admins[0].id
    }

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber,
        userId,
        assignedToId,
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority: priority || 'MEDIUM',
      },
    })

    // Save attachments
    const files = req.files as Express.Multer.File[] | undefined
    if (files && files.length > 0) {
      await prisma.ticketAttachment.createMany({
        data: files.map((f) => ({
          ticketId: ticket.id,
          originalName: f.originalname,
          storedPath: f.path,
          fileSize: f.size,
          mimeType: f.mimetype,
        })),
      })
    }

    res.status(201).json({
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
      },
    })
  } catch (err) {
    console.error('Create ticket error:', err)
    res.status(500).json({ error: 'Failed to create ticket' })
  }
})

// POST /api/tickets/:id/comments — add comment to own ticket
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
      select: { id: true, userId: true },
    })

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    if (ticket.userId !== userId) {
      res.status(403).json({ error: 'Access denied' })
      return
    }

    const comment = await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        userId,
        content: content.trim(),
        isAdmin: false,
      },
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    })

    res.status(201).json({ comment })
  } catch (err) {
    console.error('Add comment error:', err)
    res.status(500).json({ error: 'Failed to add comment' })
  }
})

// GET /api/tickets/:ticketId/attachments/:attachmentId — serve attachment image
router.get('/:ticketId/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId

    const attachment = await prisma.ticketAttachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { ticket: { select: { userId: true } } },
    })

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' })
      return
    }

    if (attachment.ticket.userId !== userId) {
      res.status(403).json({ error: 'Access denied' })
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
    console.error('Get attachment error:', err)
    res.status(500).json({ error: 'Failed to get attachment' })
  }
})

export default router
