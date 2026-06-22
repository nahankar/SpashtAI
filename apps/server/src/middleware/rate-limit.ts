import rateLimit from 'express-rate-limit'
import type { RequestHandler } from 'express'

const passthrough: RequestHandler = (_req, _res, next) => next()

const authRateLimitDisabled =
  process.env.DISABLE_AUTH_RATE_LIMIT === 'true' ||
  process.env.NODE_ENV !== 'production'

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
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})
