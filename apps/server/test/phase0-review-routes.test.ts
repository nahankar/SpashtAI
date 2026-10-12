import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  session: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
  sessionMetrics: { aggregate: vi.fn() },
  platformFeatureFlag: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  userFeatureGrant: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
}))
vi.mock('../src/lib/prisma', () => ({ prisma: mocks }))
vi.mock('../src/lib/featureFlags', () => ({
  CONFIGURABLE_FEATURES: ['interviews', 'interview_evaluator', 'interview_voice', 'elevate', 'replay'], ensureFeatureFlags: vi.fn(), invalidateFeatureFlagCache: vi.fn(),
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
    mocks.user.findUnique.mockResolvedValue({ role: 'ADMIN' })
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.user = { userId: 'admin', email: 'admin@example.invalid', role: 'ADMIN' }; next() }); app.use(router)
    expect((await request(app).put('/elevate').send({ audience: 'SELECTED_USERS' })).status).toBe(400)
    expect(mocks.platformFeatureFlag.update).not.toHaveBeenCalled()
    mocks.platformFeatureFlag.findUnique.mockResolvedValue({ hidden: true, disabled: true })
    mocks.platformFeatureFlag.update.mockResolvedValue({ feature: 'interviews' })
    expect((await request(app).put('/interviews').send({ audience: 'SELECTED_USERS' })).status).toBe(200)
    expect(mocks.platformFeatureFlag.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ audience: 'SELECTED_USERS' }) }))
    expect((await request(app).put('/interview_evaluator').send({ audience: 'SELECTED_USERS' })).status).toBe(200)
    expect((await request(app).put('/interview_voice').send({ audience: 'SELECTED_USERS', hidden: false, disabled: false })).status).toBe(200)
    expect(mocks.platformFeatureFlag.update).toHaveBeenLastCalledWith(expect.objectContaining({where:{feature:'interview_voice'},data:expect.objectContaining({audience:'SELECTED_USERS',enabled:true})}))
  })
  it.each(['interviews','interview_evaluator','interview_voice'])('loads, grants and revokes selected-user access for %s',async feature=> {
    mocks.user.findUnique.mockImplementation(async ({where})=>where.id==='admin'?{role:'ADMIN'}:{id:where.id})
    const grant={userId:'pilot',user:{email:'pilot@example.invalid'}}
    mocks.userFeatureGrant.findMany.mockResolvedValue([grant])
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={userId:'admin',email:'admin@example.invalid',role:'ADMIN'};next()});app.use(router)
    const listed=await request(app).get(`/${feature}/grants`)
    expect(listed.status).toBe(200);expect(listed.body.grants).toEqual([grant])
    expect(mocks.userFeatureGrant.findMany).toHaveBeenCalledWith(expect.objectContaining({where:{feature}}))
    expect((await request(app).put(`/${feature}/grants/pilot`).send({granted:true})).status).toBe(200)
    expect(mocks.userFeatureGrant.upsert).toHaveBeenCalledWith({where:{userId_feature:{userId:'pilot',feature}},create:{userId:'pilot',feature,grantedBy:'admin'},update:{grantedBy:'admin'}})
    expect((await request(app).put(`/${feature}/grants/pilot`).send({granted:false})).status).toBe(200)
    expect(mocks.userFeatureGrant.deleteMany).toHaveBeenCalledWith({where:{userId:'pilot',feature}})
  })
  it('still rejects unsupported pilot features and malformed grant requests',async()=> {
    mocks.user.findUnique.mockResolvedValue({role:'ADMIN'})
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={userId:'admin',email:'admin@example.invalid',role:'ADMIN'};next()});app.use(router)
    expect((await request(app).get('/elevate/grants')).status).toBe(400)
    expect((await request(app).put('/elevate/grants/pilot').send({granted:true})).status).toBe(400)
    expect((await request(app).put('/interview_voice/grants/pilot').send({granted:'true'})).status).toBe(400)
    expect(mocks.userFeatureGrant.upsert).not.toHaveBeenCalled()
  })
  it('requires a current Admin role before reading or granting interview voice access',async()=> {
    mocks.user.findUnique.mockResolvedValue({role:'USER'})
    const app=express();app.use(express.json());app.use((req,_res,next)=>{req.user={userId:'demoted',email:'demoted@example.invalid',role:'SUPER_ADMIN'};next()});app.use(router)
    expect((await request(app).get('/interview_voice/grants')).status).toBe(403)
    expect((await request(app).put('/interview_voice/grants/pilot').send({granted:true})).status).toBe(403)
    expect(mocks.userFeatureGrant.findMany).not.toHaveBeenCalled()
    expect(mocks.userFeatureGrant.upsert).not.toHaveBeenCalled()
  })

})
