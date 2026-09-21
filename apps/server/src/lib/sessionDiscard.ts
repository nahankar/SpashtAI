import type { NextFunction, Request, Response } from 'express'
import type { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { isValidInternalAgentRequest } from '../middleware/auth'

export class SessionDiscardedError extends Error {
  readonly status = 410

  constructor() {
    super('Session discarded')
    this.name = 'SessionDiscardedError'
  }
}

export class SessionMissingError extends Error {
  readonly status = 404

  constructor() {
    super('Session not found')
    this.name = 'SessionMissingError'
  }
}

export class RecordingOwnershipError extends Error {
  readonly status = 409

  constructor() {
    super('Egress recording belongs to another session')
    this.name = 'RecordingOwnershipError'
  }
}

/**
 * Serialize a persistence transaction with the discard tombstone update.
 * If persistence wins the row lock, the later cleanup sees its rows/files. If
 * discard wins, persistence receives 410 and must compensate external writes.
 */
export async function lockWritableSession(
  tx: Prisma.TransactionClient,
  sessionId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ discardedAt: Date | null }>>`
    SELECT "discardedAt"
    FROM "Session"
    WHERE "id" = ${sessionId}
    FOR UPDATE
  `
  if (rows.length === 0) throw new SessionMissingError()
  if (rows[0].discardedAt) throw new SessionDiscardedError()
}

export async function discardedSessionGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === 'DELETE') return next()
  // Egress/audio completion callbacks may be the first place their exact
  // object path becomes known. Let only the authenticated agent reach the
  // compensating handler after a tombstone has been written.
  if (
    req.method === 'POST' &&
    isValidInternalAgentRequest(req) &&
    /^\/sessions\/[^/]+\/(?:recording|audio)$/.test(req.path)
  ) {
    return next()
  }
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
