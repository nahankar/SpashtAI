import { Writable } from 'node:stream'
import express from 'express'
import pinoHttp from 'pino-http'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApiLogger, requestLogOptions } from '../src/lib/logger'

function captureLogger() {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk))
      callback()
    },
  })
  return { lines, log: createApiLogger(destination) }
}

function parsedRequests(lines: string[]) {
  return lines
    .flatMap(chunk => chunk.split('\n').filter(Boolean))
    .map(line => JSON.parse(line) as { req?: { headers?: Record<string, string>; url?: string }; res?: { statusCode?: number } })
    .filter(record => record.req && record.res)
}

describe('request log redaction', () => {
  it('redacts workspace credentials on successful and failed serialized request logs', async () => {
    const { lines, log } = captureLogger()
    const app = express()
    app.use(pinoHttp(requestLogOptions(log)))
    app.get('/ok', (_req, res) => { res.json({ ok: true }) })
    app.get('/denied', (_req, res) => { res.status(401).json({ error: 'Sign in again', code: 'IDENTITY_REQUIRED' }) })

    const credentials = {
      authorization: 'Bearer identity-secret',
      'x-spasht-workspace': 'workspace-jwt-secret',
      'x-spasht-workspace-scope': 'agent-scope-secret',
      'x-internal-agent-token': 'internal-secret',
    }

    expect((await request(app).get('/ok').set(credentials)).status).toBe(200)
    expect((await request(app).get('/denied').set(credentials)).status).toBe(401)
    expect((await request(app).get('/sessions/s1/recording/stream?access_token=play-secret&workspace_media=ticket-secret').set(credentials)).status).toBe(404)

    const records = parsedRequests(lines)
    expect(records.map(record => record.res?.statusCode).sort()).toEqual([200, 401, 404])
    for (const record of records) {
      const serialized = JSON.stringify(record)
      expect(serialized).not.toContain('identity-secret')
      expect(serialized).not.toContain('workspace-jwt-secret')
      expect(serialized).not.toContain('agent-scope-secret')
      expect(serialized).not.toContain('internal-secret')
      expect(serialized).not.toContain('play-secret')
      expect(serialized).not.toContain('ticket-secret')
      expect(record.req?.headers?.authorization).toBe('[redacted]')
      expect(record.req?.headers?.['x-spasht-workspace']).toBe('[redacted]')
      expect(record.req?.headers?.['x-spasht-workspace-scope']).toBe('[redacted]')
      expect(record.req?.headers?.['x-internal-agent-token']).toBe('[redacted]')
    }
    const media = records.find(record => record.req?.url?.includes('recording/stream'))
    expect(media?.req?.url).toContain('access_token=[redacted]')
    expect(media?.req?.url).toContain('workspace_media=[redacted]')
  })
})
