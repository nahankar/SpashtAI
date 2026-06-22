import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import {
  ensureFeatureFlags,
  invalidateFeatureFlagCache,
  PLATFORM_FEATURES,
  type PlatformFeature,
} from '../../lib/featureFlags'

const router = Router()

// GET /api/admin/feature-flags
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

// PUT /api/admin/feature-flags/:feature
router.put('/:feature', async (req: Request, res: Response) => {
  try {
    const feature = req.params.feature as PlatformFeature
    if (!PLATFORM_FEATURES.includes(feature)) {
      return res.status(400).json({ error: `Unknown feature: ${feature}` })
    }

    const { enabled } = req.body as { enabled?: boolean }
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) is required' })
    }

    const adminId = (req as any).user?.userId ?? null

    const updated = await prisma.platformFeatureFlag.update({
      where: { feature },
      data: { enabled, updatedBy: adminId },
    })

    invalidateFeatureFlagCache()

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: 'feature_flag.set',
          metadata: { feature, enabled },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json({ flag: updated })
  } catch (err) {
    console.error('Feature flag update error:', err)
    res.status(500).json({ error: 'Failed to update feature flag' })
  }
})

export default router
