import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    const tickers = await prisma.platformTicker.findMany({ orderBy: { sortOrder: 'asc' } })
    res.json({ tickers })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickers' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const { message, sortOrder, active } = req.body as {
      message?: string
      sortOrder?: number
      active?: boolean
    }
    if (!message?.trim()) return res.status(400).json({ error: 'message is required' })
    const ticker = await prisma.platformTicker.create({
      data: {
        message: message.trim(),
        sortOrder: sortOrder ?? 0,
        active: active ?? true,
      },
    })
    res.status(201).json({ ticker })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ticker' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { message, sortOrder, active } = req.body as {
      message?: string
      sortOrder?: number
      active?: boolean
    }
    const ticker = await prisma.platformTicker.update({
      where: { id: req.params.id },
      data: {
        ...(message !== undefined && { message: message.trim() }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(active !== undefined && { active }),
      },
    })
    res.json({ ticker })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticker' })
  }
})

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await prisma.platformTicker.delete({ where: { id: req.params.id } })
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete ticker' })
  }
})

export default router
