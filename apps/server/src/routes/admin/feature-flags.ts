import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import {
  ensureFeatureFlags,
  invalidateFeatureFlagCache,
  PLATFORM_FEATURES,
  type PlatformFeature,
} from '../../lib/featureFlags'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    await ensureFeatureFlags()
    const flags = await prisma.platformFeatureFlag.findMany({
      orderBy: { feature: 'asc' },
    })
    res.json({ flags })
  } catch (err) {
    console.error('Feature flags list error:', err)
    res.status(500).json({ error: 'Failed to load feature flags' })
  }
})

router.put('/:feature', async (req: Request, res: Response) => {
  try {
    const feature = req.params.feature as PlatformFeature
    if (!PLATFORM_FEATURES.includes(feature)) {
      return res.status(400).json({ error: `Unknown feature: ${feature}` })
    }

    const { hidden, disabled, overlayComment, overlayPosition } = req.body as {
      hidden?: boolean
      disabled?: boolean
      overlayComment?: string | null
      overlayPosition?: string
    }

    const data: Record<string, unknown> = {}
    if (typeof hidden === 'boolean') data.hidden = hidden
    if (typeof disabled === 'boolean') data.disabled = disabled
    if (overlayComment !== undefined) data.overlayComment = overlayComment
    if (overlayPosition === 'top' || overlayPosition === 'center') {
      data.overlayPosition = overlayPosition
    }

    // Keep legacy enabled in sync
    const current = await prisma.platformFeatureFlag.findUnique({ where: { feature } })
    const nextHidden = typeof hidden === 'boolean' ? hidden : current?.hidden ?? false
    const nextDisabled =
      typeof disabled === 'boolean' ? disabled : current?.disabled ?? false
    data.enabled = !nextHidden && !nextDisabled

    const adminId = (req as Request & { user?: { userId: string } }).user?.userId ?? null
    data.updatedBy = adminId

    const updated = await prisma.platformFeatureFlag.update({
      where: { feature },
      data,
    })

    invalidateFeatureFlagCache()
    res.json({ flag: updated })
  } catch (err) {
    console.error('Feature flag update error:', err)
    res.status(500).json({ error: 'Failed to update feature flag' })
  }
})

export default router
