/**
 * Central structured logger (pino).
 *
 * Emits one JSON line per record to stdout — PM2 captures it into
 * logs/spashtai-api-out.log, which you tail / rsync from your Mac. JSON (not
 * pretty) in every environment so the same `jq` filters work locally and on EC2.
 *
 * Secrets are redacted at the logger level so request logging can never leak a
 * bearer token, the internal agent token, or a cookie — see `redact` below.
 *
 * This is additive: existing `console.*` calls are untouched and still land in
 * the same PM2 files. Use `req.log` (added by pino-http) inside handlers when
 * you want a record correlated to the current request.
 */
import pino from 'pino'
import type { Request } from 'express'

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-internal-agent-token"]',
      'req.query.access_token',
      'res.headers["set-cookie"]',
    ],
    censor: '[redacted]',
  },
  // Drop noisy default keys we don't need; keep output compact.
  base: { service: 'api' },
})

/**
 * Request-scoped logger: prefers the pino-http child on the request (carries the
 * requestId, so the line correlates to the request-completion log), and falls
 * back to the module logger when no request is in scope (background tasks).
 */
export function reqLog(req: Request): pino.Logger {
  return (req as unknown as { log?: pino.Logger }).log ?? logger
}
