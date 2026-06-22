import { Request, Response, NextFunction } from 'express'
import { verifyToken, TokenPayload } from '../lib/jwt'

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  const token = header.slice(7)

  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Allow either a normal user JWT or the LiveKit agent's internal shared-secret
// (`x-internal-agent-token` header). Use this on endpoints that the Python
// agent worker calls server-side at session end (metrics persistence, etc.).
export function requireAuthOrAgent(req: Request, res: Response, next: NextFunction): void {
  const internalToken = req.header('x-internal-agent-token')
  const configured = process.env.INTERNAL_AGENT_TOKEN?.trim()
  const isProduction = process.env.NODE_ENV === 'production'
  // Keep a fallback only for explicit local development convenience.
  const expected = configured || (!isProduction ? 'dev-internal-agent-token' : '')
  if (internalToken && internalToken === expected) {
    return next()
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }
  const token = header.slice(7)
  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
