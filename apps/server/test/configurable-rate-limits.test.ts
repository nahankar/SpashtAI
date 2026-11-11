import express from 'express'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/jwt', () => ({ verifyToken: (token: string) => {
  if (token !== 'admin') throw new Error('invalid token')
  return { role: 'SUPER_ADMIN' }
}, verifyWorkspaceToken: vi.fn() }))

let limits: typeof import('../src/middleware/rate-limit')
beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('DISABLE_AUTH_RATE_LIMIT', 'false')
  limits = await import('../src/middleware/rate-limit')
})
afterAll(() => vi.unstubAllEnvs())
const defaults = { apiRateLimitMax: 100, apiRateLimitWindowMinutes: 1, authRateLimitMax: 5, authRateLimitWindowMinutes: 15 }
function app() {
  const app = express()
  app.use('/api', (req, res, next) => limits.apiLimiter(req, res, next))
  app.get('/api/auth', (req, res, next) => limits.authLimiter(req, res, next), (_req, res) => res.sendStatus(200))
  app.get('/api/ordinary', (_req, res) => res.sendStatus(200))
  app.put('/api/admin/platform/rate-limit/settings', (_req, res) => res.sendStatus(204))
  return app
}

describe('production traffic limits', () => {
  it('keeps counts while changing API limits live and returns rate-limit headers', async () => {
    limits.setRateLimitSettings({ ...defaults, apiRateLimitMax: 2, apiRateLimitWindowMinutes: 2 })
    const server = app()
    expect((await request(server).get('/api/ordinary')).status).toBe(200)
    expect((await request(server).get('/api/ordinary')).status).toBe(200)
    const blocked = await request(server).get('/api/ordinary')
    expect(blocked.status).toBe(429)
    expect(blocked.headers['retry-after']).toBeDefined()
    limits.setRateLimitSettings({ ...defaults, apiRateLimitMax: 4, apiRateLimitWindowMinutes: 2 })
    expect((await request(server).get('/api/ordinary')).status).toBe(200)
    expect((await request(server).get('/api/ordinary')).status).toBe(429)
    expect((await request(server).put('/api/admin/platform/rate-limit/settings')).status).toBe(204)
  })

  it('applies the login allowance independently and changing its window resets it', async () => {
    limits.setRateLimitSettings({ ...defaults, apiRateLimitWindowMinutes: 3, authRateLimitMax: 1, authRateLimitWindowMinutes: 16 })
    const server = app()
    expect((await request(server).get('/api/auth')).status).toBe(200)
    expect((await request(server).get('/api/auth')).status).toBe(429)
    expect((await request(server).get('/api/ordinary')).status).toBe(200)
    limits.setRateLimitSettings({ ...defaults, apiRateLimitWindowMinutes: 3, authRateLimitMax: 1, authRateLimitWindowMinutes: 17 })
    expect((await request(server).get('/api/auth')).status).toBe(200)
    expect((await request(server).get('/api/auth')).status).toBe(429)
    const ordinary = await request(server).get('/api/ordinary')
    expect(ordinary.headers['ratelimit-remaining']).toBe('94')
  })

  it('keeps admin bypass scoped to authenticated admin API requests, not login', async () => {
    limits.setRateLimitSettings({ ...defaults, apiRateLimitMax: 1, apiRateLimitWindowMinutes: 4, authRateLimitMax: 1, authRateLimitWindowMinutes: 18 })
    limits.setAdminRateLimitBypassEnabled(true)
    const server = app()
    expect((await request(server).get('/api/ordinary')).status).toBe(200)
    expect((await request(server).get('/api/ordinary').auth('invalid', { type: 'bearer' })).status).toBe(429)
    expect((await request(server).get('/api/ordinary').auth('admin', { type: 'bearer' })).status).toBe(200)
    expect((await request(server).get('/api/auth').auth('admin', { type: 'bearer' })).status).toBe(200)
    expect((await request(server).get('/api/auth').auth('admin', { type: 'bearer' })).status).toBe(429)
    limits.setAdminRateLimitBypassEnabled(false)
  })
})
