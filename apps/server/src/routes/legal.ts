import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'

const router = Router()

// GET /api/legal/:slug — public (terms | privacy)
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const slug = req.params.slug
    if (slug !== 'terms' && slug !== 'privacy') {
      return res.status(404).json({ error: 'Not found' })
    }

    const doc = await prisma.legalDocument.findUnique({ where: { slug } })
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' })
    }

    res.json({
      slug: doc.slug,
      title: doc.title,
      content: doc.content,
      updatedAt: doc.updatedAt,
    })
  } catch (err) {
    console.error('Legal document error:', err)
    res.status(500).json({ error: 'Failed to load document' })
  }
})

export default router
