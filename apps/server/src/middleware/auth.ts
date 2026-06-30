import { Request, Response, NextFunction } from 'express'
import { verifyToken, TokenPayload } from '../lib/jwt'

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7)
  const q = req.query.access_token
  if (typeof q === 'string' && q.trim()) return q.trim()
  return null
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerToken(req)
  if (!token) {
    res.status(401).json({ error: 'Authentication required' })
    return
  }

  try {
    req.user = verifyToken(token)
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/** Like requireAuth but also accepts `?access_token=` for `<audio src>` playback. */
export function requireAuthOrMediaToken(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, next)
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
