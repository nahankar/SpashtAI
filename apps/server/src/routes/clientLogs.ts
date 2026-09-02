/**
 * Browser remote-log ingestion → S3 (one immutable JSONL object per batch).
 *
 * Operational logging only. This endpoint is deliberately fail-safe: it must
 * NEVER surface as a client-facing error and must NEVER block the app. If the
 * feature is disabled, the bucket is missing, or the S3 write fails, it still
 * returns a success status and drops the batch.
 *
 * Safeguards (see the security review that informed this):
 *  - Mounted behind `requireAuth` + a dedicated rate limiter (not an open S3
 *    write-amplifier).
 *  - Gated by CLIENT_LOGS_ENABLED so the bucket/IAM can be absent in any
 *    environment without affecting core functionality.
 *  - Per-batch S3 keys (S3 objects are immutable — we never append to one key).
 *  - Server-authoritative fields (userId, ip, receivedAt) override anything the
 *    client claims; the client-supplied sessionId is sanitised before use as a
 *    key segment.
 */
import type { Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { awsCredentialsConfig } from '../lib/awsCredentials'

const region = process.env.AWS_REGION || 'us-east-1'
const BUCKET = process.env.CLIENT_LOGS_S3_BUCKET || 'spashtai-logs'
const ENABLED = process.env.CLIENT_LOGS_ENABLED === 'true'

const MAX_EVENTS = 100 // hard cap on events persisted per batch
const MAX_EVENT_CHARS = 4000 // truncate any single serialised event line

// Lazily constructed so an unconfigured environment never even builds a client.
let s3: S3Client | null = null
function getS3(): S3Client {
  if (!s3) s3 = new S3Client({ region, ...awsCredentialsConfig() })
  return s3
}

/** Tighter than the global apiLimiter — log ingestion should not be chatty. */
export const clientLogsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many log submissions' },
  standardHeaders: true,
  legacyHeaders: false,
})

/** Constrain a client-supplied value to a safe S3 key segment. */
function safeSegment(value: unknown, fallback: string): string {
  const s = typeof value === 'string' ? value : ''
  const cleaned = s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
  return cleaned || fallback
}

export async function ingestClientLogs(req: Request, res: Response): Promise<void> {
  // Server-side gate: no-op cleanly when the feature is off.
  if (!ENABLED) {
    res.status(204).end()
    return
  }

  try {
    const body = req.body as { events?: unknown[]; meta?: Record<string, unknown> } | undefined
    const events = Array.isArray(body?.events) ? body!.events!.slice(0, MAX_EVENTS) : []
    if (events.length === 0) {
      res.status(204).end()
      return
    }

    const userId = req.user?.userId ?? 'anon'
    const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {}
    const sessionId = safeSegment((meta as Record<string, unknown>).sessionId, 'no-session')
    const now = new Date()
    const receivedAt = now.toISOString()

    // One JSON object per line (JSONL). Server-authoritative fields win.
    const lines = events.map((ev) => {
      let line: Record<string, unknown>
      try {
        line = ev && typeof ev === 'object' ? { ...(ev as object) } : { message: String(ev) }
      } catch {
        line = { message: '[unserialisable event]' }
      }
      line.userId = userId
      line.receivedAt = receivedAt
      line.ip = req.ip
      let json = JSON.stringify(line)
      if (json.length > MAX_EVENT_CHARS) {
        // Drop oversized free-form fields and re-serialise so the line stays
        // valid JSON (slicing the JSON string would corrupt the JSONL).
        json = JSON.stringify({
          ts: (line as { ts?: unknown }).ts,
          level: (line as { level?: unknown }).level,
          message: String((line as { message?: unknown }).message ?? '').slice(0, 500),
          truncated: true,
          userId,
          receivedAt,
          ip: req.ip,
        })
      }
      return json
    })
    const payload = lines.join('\n') + '\n'

    const yyyy = now.getUTCFullYear()
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(now.getUTCDate()).padStart(2, '0')
    const rand = Math.random().toString(36).slice(2, 8)
    const key = `browser/${yyyy}/${mm}/${dd}/${sessionId}/${now.getTime()}-${rand}.jsonl`

    await getS3().send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: payload,
        ContentType: 'application/x-ndjson',
      }),
    )

    res.status(204).end()
  } catch (err) {
    // Never fail the client: record server-side and accept.
    console.warn('[client-logs] failed to persist batch:', (err as Error)?.message)
    res.status(202).end()
  }
}
