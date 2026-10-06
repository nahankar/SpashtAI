import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  count: vi.fn(), findMany: vi.fn(), grant: vi.fn(), createMany: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: {
  platformFeatureFlag: { count: mocks.count, findMany: mocks.findMany, createMany: mocks.createMany },
  userFeatureGrant: { findUnique: mocks.grant },
} }))
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
})
