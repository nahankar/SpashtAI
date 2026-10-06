import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  sessionMetrics: { aggregate: vi.fn() },
  platformFeatureFlag: { findUnique: vi.fn(), update: vi.fn() },
}))
vi.mock('../src/lib/prisma', () => ({ prisma: mocks }))
vi.mock('../src/lib/featureFlags', () => ({
  CONFIGURABLE_FEATURES: ['interviews', 'elevate', 'replay'], ensureFeatureFlags: vi.fn(), invalidateFeatureFlagCache: vi.fn(),
}))
import { getUserSessionsMetrics } from '../src/routes/metrics'
import { addConversationMessage } from '../src/routes/conversations'
import router from '../src/routes/admin/feature-flags'
import express from 'express'
import request from 'supertest'
function response() {
  const res: any = { statusCode: 200 }
  res.status = vi.fn((code) => { res.statusCode = code; return res })
  res.json = vi.fn((body) => { res.body = body; return res })
  return res
}
describe('Phase 0 review boundaries', () => {
  beforeEach(() => vi.resetAllMocks())
  it('denies cross-user metrics before querying any session data', async () => {
    const res = response()
    await getUserSessionsMetrics({ params: { userId: 'victim' }, user: { userId: 'caller', role: 'USER' }, query: {} } as any, res)
    expect(res.statusCode).toBe(403)
    expect(mocks.session.findMany).not.toHaveBeenCalled()
    expect(mocks.sessionMetrics.aggregate).not.toHaveBeenCalled()
  })
  it.each(['USER', 'ADMIN'])('filters owner and privileged communication metrics consistently (%s)', async role => {
    mocks.session.findMany.mockResolvedValue([])
    mocks.session.count.mockResolvedValue(0)
    mocks.sessionMetrics.aggregate.mockResolvedValue({ _avg: {} })
    const res = response()
    await getUserSessionsMetrics({ params: { userId: 'owner' }, user: { userId: role === 'USER' ? 'owner' : 'admin', role }, query: {} } as any, res)
    expect(res.statusCode).toBe(200)
    const where = { userId: 'owner', discardedAt: null, purpose: 'COMMUNICATION', preparationPractice: null }
    expect(mocks.session.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }))
    expect(mocks.session.count).toHaveBeenCalledWith({ where })
    expect(mocks.sessionMetrics.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: { session: where } }))
  })
  it('does not create a session while logging a message', async () => {
    mocks.session.findUnique.mockResolvedValue(null)
    const res = response()
    await addConversationMessage({ params: { sessionId: 'unknown' }, user: { userId: 'caller' }, body: { role: 'user', content: 'answer' } } as any, res)
    expect(res.statusCode).toBe(404)
    expect(mocks.session.create).not.toHaveBeenCalled()
  })
  it('rejects selected-user audience on Elevate and accepts it on Interviews', async () => {
    const app = express(); app.use(express.json()); app.use(router)
    expect((await request(app).put('/elevate').send({ audience: 'SELECTED_USERS' })).status).toBe(400)
    expect(mocks.platformFeatureFlag.update).not.toHaveBeenCalled()
    mocks.platformFeatureFlag.findUnique.mockResolvedValue({ hidden: true, disabled: true })
    mocks.platformFeatureFlag.update.mockResolvedValue({ feature: 'interviews' })
    expect((await request(app).put('/interviews').send({ audience: 'SELECTED_USERS' })).status).toBe(200)
    expect(mocks.platformFeatureFlag.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ audience: 'SELECTED_USERS' }) }))
  })
})
