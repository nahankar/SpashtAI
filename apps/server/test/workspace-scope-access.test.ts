import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataScope } from '../src/lib/dataScope'

const prismaMock = vi.hoisted(() => ({
  platformFeatureFlag: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  userFeatureGrant: { findUnique: vi.fn() },
  user: { findUniqueOrThrow: vi.fn() },
  $queryRaw: vi.fn(),
}))
vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }))

import { runWithDataScope } from '../src/lib/dataScope'
import { getEffectiveExportFlags, isPrivilegedRole, DEFAULT_EXPORT_FLAGS } from '../src/lib/userExportFlags'
import { invalidateFeatureFlagCache, isFeatureAccessible } from '../src/lib/featureFlags'
import { ownerPracticeDurations, practiceExecutionAccess, conversationAccess } from '../src/interviews/practice/access'

const scope = (features: Record<string, boolean>, actorId = 'learner'): DataScope => ({
  actorId, workspaceId: 'ws-alpha', membershipId: 'm1', role: 'LEARNER', slug: 'alpha', timeZone: 'Asia/Kolkata', features, origin: 'request',
})
const flag = (feature: string, extra: Record<string, unknown> = {}) => ({ feature, audience: 'EVERYONE', hidden: false, disabled: false, overlayComment: null, overlayPosition: 'center', ...extra })

describe('organization scope access rules', () => {
  beforeEach(() => {
    vi.clearAllMocks(); invalidateFeatureFlagCache()
    prismaMock.platformFeatureFlag.count.mockResolvedValue(10)
    prismaMock.$queryRaw.mockResolvedValue([])
  })

  it('never applies platform staff privilege inside an organization', async () => {
    expect(isPrivilegedRole('ADMIN')).toBe(true)
    await runWithDataScope(scope({}), async () => {
      expect(isPrivilegedRole('ADMIN')).toBe(false)
      expect(await getEffectiveExportFlags('learner', 'ADMIN')).not.toEqual(DEFAULT_EXPORT_FLAGS)
    })
  })

  it('derives export actions from the workspace decision only', async () => {
    const none = await runWithDataScope(scope({}), () => getEffectiveExportFlags('learner'))
    expect(none).toMatchObject({ enableTxtExport: false, enableAudioExport: false, enableReprocess: false, hideAudioDownload: true })
    const all = await runWithDataScope(scope({ text_export: true, audio_export: true, reprocess: true }), () => getEffectiveExportFlags('learner'))
    expect(all).toMatchObject({ enableTxtExport: true, enableJsonExport: true, enableAudioExport: true, enableReprocess: true, hideAudioDownload: false })
  })

  it('uses the organization entitlement instead of Personal pilot grants', async () => {
    prismaMock.platformFeatureFlag.findMany.mockResolvedValue([flag('replay', { audience: 'SELECTED_USERS' }), flag('quick_try'), flag('elevate', { disabled: true })])
    prismaMock.userFeatureGrant.findUnique.mockResolvedValue({ id: 'personal-grant' })
    expect(await isFeatureAccessible('replay', 'learner')).toBe(true)
    await runWithDataScope(scope({ replay: false }), async () => expect(await isFeatureAccessible('replay', 'learner')).toBe(false))
    await runWithDataScope(scope({ replay: true }), async () => expect(await isFeatureAccessible('replay', 'learner')).toBe(true))
    await runWithDataScope(scope({ elevate: true }), async () => expect(await isFeatureAccessible('elevate', 'learner')).toBe(false))
    await runWithDataScope(scope({}), async () => expect(await isFeatureAccessible('quick_try', 'learner')).toBe(false))
  })

  it('gates interview practice and plan time on the organization scope', async () => {
    prismaMock.platformFeatureFlag.findUnique.mockImplementation(({ where }: { where: { feature: string } }) => flag(where.feature, { audience: 'SELECTED_USERS' }))
    prismaMock.userFeatureGrant.findUnique.mockResolvedValue(null)
    await expect(runWithDataScope(scope({ interviews: true }), () => practiceExecutionAccess('learner'))).resolves.toBeUndefined()
    await expect(runWithDataScope(scope({ interviews: false }), () => practiceExecutionAccess('learner'))).rejects.toThrow()
    await expect(runWithDataScope(scope({ interviews: true }), () => practiceExecutionAccess('someone-else'))).rejects.toThrow()
    expect(await runWithDataScope(scope({ interviews: true }), () => conversationAccess('learner'))).toBe(true)
    expect(prismaMock.userFeatureGrant.findUnique).not.toHaveBeenCalled()
    prismaMock.user.findUniqueOrThrow.mockResolvedValue({ role: 'ADMIN', enablePro: true, enableUltra: true })
    expect((await runWithDataScope(scope({}), () => ownerPracticeDurations('learner'))).plan).toBe('standard')
    expect((await runWithDataScope(scope({ pro: true }), () => ownerPracticeDurations('learner'))).plan).toBe('pro')
    expect((await ownerPracticeDurations('learner')).plan).toBe('ultra')
  })
})
