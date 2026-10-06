import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import {
  ensureFeatureFlags,
  invalidateFeatureFlagCache,
  CONFIGURABLE_FEATURES,
  type ConfigurableFeature,
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
    const feature = req.params.feature as ConfigurableFeature
    if (!CONFIGURABLE_FEATURES.includes(feature)) {
      return res.status(400).json({ error: `Unknown feature: ${feature}` })
    }

    const { hidden, disabled, overlayComment, overlayPosition, audience } = req.body as {
      audience?: 'EVERYONE' | 'SELECTED_USERS'
      hidden?: boolean
      disabled?: boolean
      overlayComment?: string | null
      overlayPosition?: string
    }

    if (audience !== undefined && !['EVERYONE', 'SELECTED_USERS'].includes(audience)) {
      return res.status(400).json({ error: 'Invalid feature audience' })
    }
    if (audience === 'SELECTED_USERS' && feature !== 'interviews') {
      return res.status(400).json({ error: 'Selected-user audience is currently supported only for Interviews' })
    }
    const data: Record<string, unknown> = {}
    if (audience !== undefined) data.audience = audience
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

router.get('/:feature/grants', async (req, res) => {
  if (req.params.feature !== 'interviews') return res.status(400).json({ error: 'Pilot grants are supported only for Interviews' })
  try {
    const grants = await prisma.userFeatureGrant.findMany({ where: { feature: req.params.feature }, select: { userId: true, grantedBy: true, createdAt: true, user: { select: { email: true } } } })
    res.json({ grants })
  } catch { res.status(500).json({ error: 'Failed to read pilot grants' }) }
})

router.put('/:feature/grants/:userId', async (req, res) => {
  if (req.params.feature !== 'interviews' || typeof req.body?.granted !== 'boolean') {
    return res.status(400).json({ error: 'Known feature and boolean granted are required' })
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.userId }, select: { id: true } })
    if (!user) return res.status(404).json({ error: 'User not found' })
    await ensureFeatureFlags()
    const key = { userId: req.params.userId, feature: req.params.feature }
    if (req.body.granted) await prisma.userFeatureGrant.upsert({
      where: { userId_feature: key }, update: { grantedBy: req.user!.userId }, create: { ...key, grantedBy: req.user!.userId },
    })
    else await prisma.userFeatureGrant.deleteMany({ where: key })
    res.json({ success: true })
  } catch { res.status(500).json({ error: 'Failed to update pilot grant' }) }
})

export default router
