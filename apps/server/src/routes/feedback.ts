import { Router, type Request, type Response } from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { prisma } from '../lib/prisma'
import { generateFeedbackNumber, isFeedbackEditable } from '../lib/feedback'

const router = Router()

const uploadDir =
  process.env.FEEDBACK_UPLOAD_DIR ||
  path.join(process.cwd(), 'storage', 'feedback_uploads')

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
    cb(null, `${Date.now()}_${safe}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 5 },
})

function userId(req: Request): string {
  return (req as Request & { user?: { userId: string } }).user!.userId
}

// POST /api/feedback
router.post('/', upload.array('attachments', 5), async (req: Request, res: Response) => {
  try {
    const uid = userId(req)
    const { type, subject, body } = req.body as {
      type?: string
      subject?: string
      body?: string
    }
    if (!body?.trim()) {
      return res.status(400).json({ error: 'body is required' })
    }
    const feedbackType =
      type === 'ISSUE' || type === 'FEATURE_REQUEST' ? type : 'FEEDBACK'

    const feedbackNumber = await generateFeedbackNumber()

    const feedback = await prisma.userFeedback.create({
      data: {
        feedbackNumber,
        userId: uid,
        type: feedbackType,
        subject: subject?.trim() || null,
        body: body.trim(),
      },
    })

    const files = (req.files as Express.Multer.File[]) || []
    for (const file of files) {
      await prisma.userFeedbackAttachment.create({
        data: {
          feedbackId: feedback.id,
          fileName: file.originalname,
          mimeType: file.mimetype,
          storedPath: file.path,
        },
      })
    }

    const full = await prisma.userFeedback.findUnique({
      where: { id: feedback.id },
      include: { attachments: true, notes: { orderBy: { createdAt: 'asc' } } },
    })

    res.status(201).json({ feedback: full })
  } catch (err) {
    console.error('Create feedback error:', err)
    res.status(500).json({ error: 'Failed to submit feedback' })
  }
})

// GET /api/feedback/mine
router.get('/mine', async (req: Request, res: Response) => {
  try {
    const uid = userId(req)
    const items = await prisma.userFeedback.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: true,
        notes: { orderBy: { createdAt: 'asc' } },
      },
    })
    res.json({ feedback: items })
  } catch (err) {
    console.error('List feedback error:', err)
    res.status(500).json({ error: 'Failed to load feedback' })
  }
})

// GET /api/feedback/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const uid = userId(req)
    const item = await prisma.userFeedback.findUnique({
      where: { id: req.params.id },
      include: {
        attachments: true,
        notes: { orderBy: { createdAt: 'asc' } },
      },
    })
    if (!item || item.userId !== uid) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.json({
      feedback: item,
      editable: isFeedbackEditable(item.status),
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load feedback' })
  }
})

// PUT /api/feedback/:id — user edit while status is OPEN
router.put('/:id', upload.array('attachments', 5), async (req: Request, res: Response) => {
  try {
    const uid = userId(req)
    const existing = await prisma.userFeedback.findUnique({
      where: { id: req.params.id },
    })
    if (!existing || existing.userId !== uid) {
      return res.status(404).json({ error: 'Not found' })
    }
    if (!isFeedbackEditable(existing.status)) {
      return res.status(403).json({
        error: 'Feedback can only be edited while status is Open (before admin acknowledges)',
      })
    }

    const { type, subject, body } = req.body as {
      type?: string
      subject?: string
      body?: string
    }
    if (!body?.trim()) {
      return res.status(400).json({ error: 'body is required' })
    }

    const feedbackType =
      type === 'ISSUE' || type === 'FEATURE_REQUEST' ? type : 'FEEDBACK'

    await prisma.userFeedback.update({
      where: { id: existing.id },
      data: {
        type: feedbackType,
        subject: subject?.trim() || null,
        body: body.trim(),
      },
    })

    const files = (req.files as Express.Multer.File[]) || []
    for (const file of files) {
      await prisma.userFeedbackAttachment.create({
        data: {
          feedbackId: existing.id,
          fileName: file.originalname,
          mimeType: file.mimetype,
          storedPath: file.path,
        },
      })
    }

    const full = await prisma.userFeedback.findUnique({
      where: { id: existing.id },
      include: { attachments: true, notes: { orderBy: { createdAt: 'asc' } } },
    })

    res.json({ feedback: full, editable: true })
  } catch (err) {
    console.error('Update feedback error:', err)
    res.status(500).json({ error: 'Failed to update feedback' })
  }
})

// GET /api/feedback/:id/attachments/:attachmentId
router.get('/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const uid = userId(req)
    const attachment = await prisma.userFeedbackAttachment.findUnique({
      where: { id: req.params.attachmentId },
      include: { feedback: true },
    })
    if (!attachment || attachment.feedback.userId !== uid) {
      return res.status(404).json({ error: 'Not found' })
    }
    res.sendFile(path.resolve(attachment.storedPath))
  } catch (err) {
    res.status(500).json({ error: 'Failed to load attachment' })
  }
})

export default router
