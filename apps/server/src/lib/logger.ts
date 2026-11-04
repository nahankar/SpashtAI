/**
 * Central structured logger (pino).
 *
 * Emits one JSON line per record to stdout — PM2 captures it into
 * logs/spashtai-api-out.log, which you tail / rsync from your Mac. JSON (not
 * pretty) in every environment so the same `jq` filters work locally and on EC2.
 *
 * Secrets are redacted at the logger level so request logging can never leak a
 * bearer token, workspace credential, the internal agent token, or a cookie.
 *
 * This is additive: existing `console.*` calls are untouched and still land in
 * the same PM2 files. Use `req.log` (added by pino-http) inside handlers when
 * you want a record correlated to the current request.
 */
import { randomUUID } from 'crypto'
import pino from 'pino'
import type { DestinationStream } from 'pino'
import type { Request } from 'express'
import type { Options as PinoHttpOptions } from 'pino-http'

export const REQUEST_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-internal-agent-token"]',
  'req.headers["x-spasht-workspace"]',
  'req.headers["x-spasht-workspace-scope"]',
  'req.query.access_token',
  'req.query.workspace_media',
  'res.headers["set-cookie"]',
] as const

export function createApiLogger(destination?: DestinationStream) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    redact: {
      paths: [...REQUEST_REDACT_PATHS],
      censor: '[redacted]',
    },
    base: { service: 'api' },
  }, destination)
}

export const logger = createApiLogger()

/** pino-http options used by the API process; tests serialize the same logger. */
export function requestLogOptions(log = logger): PinoHttpOptions {
  return {
    logger: log,
    genReqId: (req, res) => {
      const hdr = req.headers['x-request-id']
      const id = (Array.isArray(hdr) ? hdr[0] : hdr) || randomUUID()
      res.setHeader('x-request-id', id)
      return id
    },
    customProps: (req) => {
      const conv = req.headers['x-conversation-id']
      return {
        userId: (req as { user?: { userId?: string } }).user?.userId,
        sessionId: (Array.isArray(conv) ? conv[0] : conv) || undefined,
      }
    },
    autoLogging: { ignore: (req) => req.url === '/health' },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
    serializers: {
      req: pino.stdSerializers.wrapRequestSerializer((req) => {
        if (typeof req.url === 'string' && /(access_token|workspace_media)=/.test(req.url)) {
          req.url = req.url.replace(/([?&](?:access_token|workspace_media)=)[^&]+/gi, '$1[redacted]')
        }
        return req
      }),
    },
  }
}

/**
 * Request-scoped logger: prefers the pino-http child on the request (carries the
 * requestId, so the line correlates to the request-completion log), and falls
 * back to the module logger when no request is in scope (background tasks).
 */
export function reqLog(req: Request): pino.Logger {
  return (req as unknown as { log?: pino.Logger }).log ?? logger
}
