import rateLimit from 'express-rate-limit'
import type { Request, RequestHandler } from 'express'
import { verifyToken } from '../lib/jwt'

const passthrough: RequestHandler = (_req, _res, next) => next()

const authRateLimitDisabled =
  process.env.DISABLE_AUTH_RATE_LIMIT === 'true' ||
  process.env.NODE_ENV !== 'production'

let adminRateLimitBypassEnabled = false

export function setAdminRateLimitBypassEnabled(enabled: boolean): void {
  adminRateLimitBypassEnabled = enabled
}

function hasAdminBearerToken(req: Request): boolean {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) return false
  try {
    const role = verifyToken(header.slice(7)).role
    return role === 'ADMIN' || role === 'SUPER_ADMIN'
  } catch {
    return false
  }
}

/** Decide whether the general API limiter should be skipped for this request. */
function skipApiRateLimit(req: Request): boolean {
  // Local development should never be blocked by production abuse controls.
  if (process.env.NODE_ENV !== 'production') return true

  // Keep the authenticated emergency control reachable even after a client
  // exhausts its general API quota. requireAuth + requireAdmin still protect it.
  if (req.originalUrl.startsWith('/api/admin/platform/rate-limit')) return true

  // Production bypass is deliberately limited to valid admin JWTs. Public,
  // login, and normal-user traffic remains protected.
  return adminRateLimitBypassEnabled && hasAdminBearerToken(req)
}

export const authLimiter = authRateLimitDisabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Too many attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    })

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  skip: skipApiRateLimit,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
