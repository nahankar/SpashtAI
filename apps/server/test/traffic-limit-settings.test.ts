import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(), update: vi.fn(), audit: vi.fn(), transaction: vi.fn(), apply: vi.fn(), ensure: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: {
  user: { findUnique: mocks.findUnique }, platformSettings: { update: mocks.update },
  adminAction: { create: mocks.audit }, $transaction: mocks.transaction,
} }))
vi.mock('../src/lib/platformSettings', () => ({ ensurePlatformSettings: mocks.ensure, getPlatformSettings: vi.fn() }))
vi.mock('../src/middleware/rate-limit', () => ({ setRateLimitSettings: mocks.apply, setAdminRateLimitBypassEnabled: vi.fn() }))
import router from '../src/routes/admin/platform'
const settings = { apiRateLimitMax: 2000, apiRateLimitWindowMinutes: 1, authRateLimitMax: 500, authRateLimitWindowMinutes: 15 }
const app = express()
app.use(express.json(), (req, _res, next) => { req.user = { userId: 'super', email: 'super@example.invalid', role: 'SUPER_ADMIN' }; next() })
app.use(router)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.findUnique.mockResolvedValue({ role: 'SUPER_ADMIN' })
  mocks.update.mockImplementation(async ({ data }) => ({ id: 'default', ...data }))
  mocks.audit.mockResolvedValue({})
  mocks.transaction.mockImplementation(fn => fn({ platformSettings: { update: mocks.update }, adminAction: { create: mocks.audit } }))
})
describe('Super Admin traffic settings', () => {
  it('persists and audits settings before applying them live', async () => {
    const res = await request(app).put('/rate-limit/settings').send(settings)
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'default' }, data: { ...settings, updatedBy: 'super' } })
    expect(mocks.audit).toHaveBeenCalledWith({ data: { adminId: 'super', action: 'platform.rate_limits_updated', metadata: settings } })
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining(settings))
  })
  it.each(['ADMIN', 'USER', null])('rejects a current database role of %s even with a Super Admin token snapshot', async role => {
    mocks.findUnique.mockResolvedValue(role ? { role } : null)
    expect((await request(app).put('/rate-limit/settings').send(settings)).status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it.each([
    { apiRateLimitMax: 0 }, { authRateLimitMax: -1 }, { authRateLimitMax: 1.5 },
    { apiRateLimitMax: '2000' }, { apiRateLimitMax: 1000001 },
    { authRateLimitWindowMinutes: 1441 }, { apiRateLimitWindowMinutes: 0 }, { extra: true },
  ])('rejects invalid settings %j', async invalid => {
    expect((await request(app).put('/rate-limit/settings').send({ ...settings, ...invalid })).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it('rejects missing fields', async () => {
    expect((await request(app).put('/rate-limit/settings').send({})).status).toBe(400)
  })
  it('keeps runtime limits unchanged if persistence fails', async () => {
    mocks.transaction.mockRejectedValueOnce(new Error('database unavailable'))
    expect((await request(app).put('/rate-limit/settings').send(settings)).status).toBe(500)
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
