import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  count: vi.fn(), findMany: vi.fn(), grant: vi.fn(), createMany: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: {
  platformFeatureFlag: { count: mocks.count, findMany: mocks.findMany, createMany: mocks.createMany },
  userFeatureGrant: { findUnique: mocks.grant },
} }))
import { getPublicFeatures } from '../src/routes/features'
import { signToken } from '../src/lib/jwt'
import type { Request, Response } from 'express'
import { invalidateFeatureFlagCache, isFeatureAccessible } from '../src/lib/featureFlags'
describe('selected-user access', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    invalidateFeatureFlagCache()
    mocks.count.mockResolvedValue(0)
    mocks.findMany.mockResolvedValue([{ feature: 'interviews', hidden: false, disabled: false, audience: 'SELECTED_USERS' }])
  })
  it('denies anonymous and uninvited users', async () => {
    mocks.grant.mockResolvedValue(null)
    expect(await isFeatureAccessible('interviews')).toBe(false)
    expect(await isFeatureAccessible('interviews', 'outside')).toBe(false)
  })
  it('does not cache a user grant as global access', async () => {
    mocks.grant.mockImplementation(async ({ where }) => where.userId_feature.userId === 'pilot' ? { id: 'g1' } : null)
    expect(await isFeatureAccessible('interviews', 'pilot')).toBe(true)
    expect(await isFeatureAccessible('interviews', 'outside')).toBe(false)
  })
  it('checks grant revocation on the next request', async () => {
    mocks.grant.mockResolvedValueOnce({ id: 'g1' }).mockResolvedValue(null)
    expect(await isFeatureAccessible('interviews', 'pilot')).toBe(true)
    expect(await isFeatureAccessible('interviews', 'pilot')).toBe(false)
  })
  it('does not let a grant bypass a disabled feature', async () => {
    mocks.findMany.mockResolvedValue([{ feature: 'interviews', hidden: false, disabled: true, audience: 'SELECTED_USERS' }])
    mocks.grant.mockResolvedValue({ id: 'g1' })
    expect(await isFeatureAccessible('interviews', 'pilot')).toBe(false)
  })
  it('keeps Interviews hidden or disabled until the voice capability is available',async()=> {
    const res={json:vi.fn(),status:vi.fn()} as unknown as Response
    const req={headers:{authorization:`Bearer ${signToken({userId:'pilot',role:'USER',email:'pilot@example.invalid'})}`}} as Request
    mocks.grant.mockResolvedValue({id:'grant'})
    for (const [voice,expected] of [
      [{hidden:true,disabled:true},{hidden:true}],
      [{hidden:false,disabled:true},{hidden:false,disabled:true}],
      [{hidden:false,disabled:false},{hidden:false,disabled:false}],
    ] as const) {
      invalidateFeatureFlagCache()
      mocks.findMany.mockResolvedValue([{feature:'interviews',hidden:false,disabled:false,audience:'SELECTED_USERS'},
        {feature:'interview_voice',audience:'SELECTED_USERS',...voice}])
      await getPublicFeatures(req,res)
      expect(res.json).toHaveBeenLastCalledWith(expect.objectContaining({features:expect.objectContaining({interviews:expect.objectContaining(expected)})}))
      expect((res.json as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].features).not.toHaveProperty('interview_voice')
    }
  })

})
