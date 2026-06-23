import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

const VALID_SLUGS = ['terms', 'privacy'] as const

// GET /api/admin/legal
router.get('/', async (_req: Request, res: Response) => {
  try {
    const docs = await prisma.legalDocument.findMany({
      orderBy: { slug: 'asc' },
      select: { slug: true, title: true, updatedAt: true, updatedBy: true },
    })
    res.json({ documents: docs })
  } catch (err) {
    console.error('Admin legal list error:', err)
    res.status(500).json({ error: 'Failed to load legal documents' })
  }
})

// GET /api/admin/legal/:slug
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug
    if (!VALID_SLUGS.includes(slug as (typeof VALID_SLUGS)[number])) {
      return res.status(404).json({ error: 'Not found' })
    }

    const doc = await prisma.legalDocument.findUnique({ where: { slug } })
    if (!doc) return res.status(404).json({ error: 'Not found' })

    res.json({ document: doc })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load document' })
  }
})

// PUT /api/admin/legal/:slug
router.put('/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug
    if (!VALID_SLUGS.includes(slug as (typeof VALID_SLUGS)[number])) {
      return res.status(404).json({ error: 'Not found' })
    }

    const { title, content } = req.body as { title?: string; content?: string }
    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'title and content are required' })
    }

    const adminId = (req as Request & { user?: { userId: string } }).user!.userId

    const doc = await prisma.legalDocument.upsert({
      where: { slug },
      update: {
        title: title.trim(),
        content: content.trim(),
        updatedBy: adminId,
      },
      create: {
        slug,
        title: title.trim(),
        content: content.trim(),
        updatedBy: adminId,
      },
    })

    res.json({ document: doc })
  } catch (err) {
    console.error('Admin legal update error:', err)
    res.status(500).json({ error: 'Failed to update document' })
  }
})

export default router
