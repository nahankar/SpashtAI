import rateLimit, { MemoryStore } from 'express-rate-limit'
import { DEFAULT_RATE_LIMIT_SETTINGS, rateLimitSettingsSchema, type RateLimitSettings } from '../lib/rateLimitSettings'
import type { Request, RequestHandler } from 'express'
import { verifyToken, verifyWorkspaceToken } from '../lib/jwt'

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

let settings: RateLimitSettings = { ...DEFAULT_RATE_LIMIT_SETTINGS }

function createLimiter(kind: 'api' | 'auth') {
  const store = new MemoryStore()
  const middleware = rateLimit({
    windowMs: settings[kind === 'api' ? 'apiRateLimitWindowMinutes' : 'authRateLimitWindowMinutes'] * 60_000,
    limit: () => settings[kind === 'api' ? 'apiRateLimitMax' : 'authRateLimitMax'],
    ...(kind === 'api' ? { skip: skipApiRateLimit } : {}),
    store,
    message: { error: kind === 'api' ? 'Too many requests, please try again later' : 'Too many attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  return { middleware, store }
}
let api = createLimiter('api')
let auth = createLimiter('auth')

/** Counts survive limit changes. Changing a window starts a fresh window for that limiter. */
export function setRateLimitSettings(value: RateLimitSettings): void {
  const next = rateLimitSettingsSchema.parse(value)
  const previous = settings
  settings = next
  if (previous.apiRateLimitWindowMinutes !== next.apiRateLimitWindowMinutes) {
    api.store.shutdown()
    api = createLimiter('api')
  }
  if (previous.authRateLimitWindowMinutes !== next.authRateLimitWindowMinutes) {
    auth.store.shutdown()
    auth = createLimiter('auth')
  }
}

export const authLimiter: RequestHandler = (req, res, next) =>
  authRateLimitDisabled ? passthrough(req, res, next) : auth.middleware(req, res, next)
export const apiLimiter: RequestHandler = (req, res, next) => api.middleware(req, res, next)

/** Invitation sends and resends, per admin account (production only, like the auth limiter). */
export const invitationSendLimiter = authRateLimitDisabled
  ? passthrough
  : rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 60,
      keyGenerator: (req) => `invite-send:${req.user?.userId ?? 'anonymous'}`,
      message: { error: 'Too many invitations sent, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    })

/** Public invitation lookup and acceptance: allows a few retries (e.g. switching Google account). */
export const invitationAcceptLimiter = authRateLimitDisabled
  ? passthrough
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: 'Too many attempts, please try again later' },
      standardHeaders: true,
      legacyHeaders: false,
    })

/** AI Analytics interpretation calls a model; one budget per identity across workspaces. */
export const workspaceAnalyticsLimiter = authRateLimitDisabled ? passthrough : rateLimit({
  windowMs: 60_000, max: 10,
  keyGenerator: req => {
    try { return `workspace-analytics:${verifyWorkspaceToken(req.headers.authorization?.slice(7) || '').userId}` }
    catch { return 'workspace-analytics:unauthenticated' }
  },
  message: { error: 'Too many AI Analytics questions. Please wait a moment.' }, standardHeaders: true, legacyHeaders: false,
})
