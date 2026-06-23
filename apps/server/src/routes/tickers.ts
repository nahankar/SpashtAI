import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

export async function getPublicTickers(_req: Request, res: Response) {
  try {
    const tickers = await prisma.platformTicker.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, message: true },
    })
    res.json({ tickers })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load tickers' })
  }
}
