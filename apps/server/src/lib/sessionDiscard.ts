import type { NextFunction, Request, Response } from 'express'
import { prisma } from './prisma'

export async function discardedSessionGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'DELETE') return next()
  const match = req.path.match(/^\/(?:internal\/)?sessions\/([^/]+)/)
  if (!match) return next()

  try {
    const sessionId = decodeURIComponent(match[1])
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { discardedAt: true, deletionStatus: true },
    })
    if (!session?.discardedAt) return next()

    res.status(410).json({
      error: 'Session discarded',
      deletionStatus: session.deletionStatus || 'pending',
    })
  } catch (error) {
    next(error)
  }
}
