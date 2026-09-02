/**
 * Browser remote logger → POST /api/client-logs (the server writes per-batch
 * JSONL to S3, browsable from your Mac).
 *
 * Hard constraints — this must never affect core functionality:
 *  - Never throws into app code. Every path is wrapped; failures are swallowed.
 *  - Additive only: existing console usage is preserved (console.error/warn are
 *    forwarded, then called as normal).
 *  - Ships only errors / warnings / explicit key events — not verbose logs.
 *  - Only flushes when an auth token exists (the endpoint requires auth), so it
 *    never spams 401s before sign-in. The server also gates on
 *    CLIENT_LOGS_ENABLED, so shipping here is harmless if the backend is off.
 *
 * Enable shipping with VITE_CLIENT_LOGS_ENABLED=true at build time; by default
 * it ships only in production builds.
 */

declare const __APP_VERSION__: string

type Level = 'error' | 'warn' | 'info' | 'event'

interface LogEvent {
  ts: string
  level: Level
  message: string
  detail?: string
  url?: string
}

const API_BASE =
  (import.meta.env.VITE_API_BASE_URL as string) ||
  (import.meta.env.VITE_API_URL as string) ||
  'http://localhost:4000'

// Default: ship in production builds; explicit env flag overrides either way.
const ENABLED =
  (import.meta.env.VITE_CLIENT_LOGS_ENABLED as string | undefined) !== undefined
    ? import.meta.env.VITE_CLIENT_LOGS_ENABLED === 'true'
    : Boolean(import.meta.env.PROD)

const MAX_BUFFER = 50
const MAX_MESSAGE_CHARS = 2000
const MAX_BODY_CHARS = 55_000 // under the 64KB keepalive cap (and the server json limit)
const FLUSH_INTERVAL_MS = 15_000

let buffer: LogEvent[] = []
let started = false
let appVersion = 'unknown'

function token(): string | null {
  try {
    return localStorage.getItem('spashtai_token')
  } catch {
    return null
  }
}

function sessionId(): string | undefined {
  try {
    return localStorage.getItem('spashtai_active_session') || undefined
  } catch {
    return undefined
  }
}

/** Strip anything that looks like a bearer token / JWT / access_token. */
function redact(s: string): string {
  return s
    .replace(/access_token=[^&\s"']+/gi, 'access_token=[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[redacted-jwt]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
}

function clip(s: string): string {
  const r = redact(s)
  return r.length > MAX_MESSAGE_CHARS ? r.slice(0, MAX_MESSAGE_CHARS) + '…[truncated]' : r
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? '\n' + v.stack : ''}`
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** Record an event. Safe to call anywhere; a no-op when shipping is disabled. */
export function logEvent(level: Level, message: unknown, detail?: unknown): void {
  try {
    if (!ENABLED) return
    buffer.push({
      ts: new Date().toISOString(),
      level,
      message: clip(stringify(message)),
      detail: detail !== undefined ? clip(stringify(detail)) : undefined,
      url: typeof location !== 'undefined' ? location.href : undefined,
    })
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER)
  } catch {
    /* logging must never throw */
  }
}

function flush(): void {
  try {
    if (!ENABLED) return
    const t = token()
    if (!t) return // endpoint requires auth — keep buffering until signed in
    if (buffer.length === 0) return

    const events = buffer
    buffer = []

    const batch = {
      events,
      meta: {
        sessionId: sessionId(),
        appVersion,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        url: typeof location !== 'undefined' ? location.href : undefined,
      },
    }

    let bodyStr = JSON.stringify(batch)
    if (bodyStr.length > MAX_BODY_CHARS) {
      // Shed detail fields first, rather than dropping the batch.
      batch.events = batch.events.map((e) => ({ ...e, detail: undefined }))
      bodyStr = JSON.stringify(batch)
    }
    // keepalive bodies are capped at 64KB by the spec — drop oldest events until
    // we fit, so an unload flush of a big batch isn't silently rejected.
    while (bodyStr.length > MAX_BODY_CHARS && batch.events.length > 1) {
      batch.events = batch.events.slice(Math.ceil(batch.events.length / 2))
      bodyStr = JSON.stringify(batch)
    }

    // fetch + keepalive (not sendBeacon) so we can send the Authorization header
    // and still survive page unload for these small payloads.
    void fetch(`${API_BASE}/api/client-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      body: bodyStr,
      keepalive: true,
    }).catch(() => {
      /* best-effort; swallow so a failed flush never bubbles up */
    })
  } catch {
    /* never throw */
  }
}

/** Install global handlers + flush timers. Call once at startup. */
export function initRemoteLogger(): void {
  try {
    if (started) return
    started = true

    try {
      appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'
    } catch {
      appVersion = 'unknown'
    }

    if (!ENABLED) return

    window.addEventListener('error', (e) => {
      const ev = e as ErrorEvent
      logEvent('error', ev.message || 'window.onerror', {
        source: ev.filename,
        line: ev.lineno,
        col: ev.colno,
        stack: ev.error?.stack,
      })
    })

    window.addEventListener('unhandledrejection', (e) => {
      logEvent('error', 'unhandledrejection', (e as PromiseRejectionEvent).reason)
    })

    // Forward console.error/warn without altering their normal behaviour.
    const origError = console.error.bind(console)
    const origWarn = console.warn.bind(console)
    console.error = (...args: unknown[]) => {
      try {
        logEvent('error', args.map(stringify).join(' '))
      } catch {
        /* noop */
      }
      origError(...args)
    }
    console.warn = (...args: unknown[]) => {
      try {
        logEvent('warn', args.map(stringify).join(' '))
      } catch {
        /* noop */
      }
      origWarn(...args)
    }

    setInterval(flush, FLUSH_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
    window.addEventListener('pagehide', flush)
  } catch {
    /* never throw */
  }
}
