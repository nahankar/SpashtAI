import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import {
  ensureFeatureFlags,
  invalidateFeatureFlagCache,
  CONFIGURABLE_FEATURES,
  type ConfigurableFeature,
} from '../../lib/featureFlags'

const router = Router()
// interview_conversation is a pilot capability but not a learner-evaluation dependency: toggling it
// never cancels evaluation jobs (revocation falls back to manual progression).
const PILOT_FEATURES = ['interviews', 'interview_evaluator', 'interview_voice', 'interview_adaptive', 'interview_conversation']
const LEARNER_FEATURES = ['interviews', 'interview_voice', 'interview_adaptive']
async function cancelLearnerJobs(ownerId?: string) {
  const where = { snapshot: { source: 'LIVE_ATTEMPT' as const, ...(ownerId ? { ownerId } : {}) } }
  await prisma.$transaction(async tx => {
    const running = await tx.interviewAssessment.findMany({ where: { ...where, status: 'RUNNING' }, select: { leaseToken: true } })
    await tx.interviewAssessment.updateMany({ where: { ...where, status: { in: ['PENDING', 'RUNNING'] } },
      data: { status: 'CANCELLED', errorCode: 'PILOT_ACCESS_UNAVAILABLE', leaseToken: null, leaseUntil: null } })
    // A cancelled in-flight call may still be billed: close its claim ledger row with unknown usage.
    // A finish that arrives later still records the actual usage under the same key.
    await tx.interviewEvaluatorUsage.updateMany({ where: { invocationKey: { in: running.flatMap(r => r.leaseToken ? [r.leaseToken] : []) }, outcome: 'STARTED' },
      data: { outcome: 'CANCELLED' } })
  })
}
router.use((req, res, next) => {
  if (!req.user?.userId) { res.status(403).json({ error: 'Admin access required' }); return }
  void prisma.user.findUnique({ where: { id: req.user.userId }, select: { role: true } }).then(user => {
    if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Current Admin access required' }); return }
    next()
  }).catch(next)
})

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
    if (audience === 'SELECTED_USERS' && !PILOT_FEATURES.includes(feature)) {
      return res.status(400).json({ error: 'Selected-user audience is supported only for interview capabilities' })
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
    if (LEARNER_FEATURES.includes(feature) && (nextHidden || nextDisabled)) await cancelLearnerJobs()

    invalidateFeatureFlagCache()
    res.json({ flag: updated })
  } catch (err) {
    console.error('Feature flag update error:', err)
    res.status(500).json({ error: 'Failed to update feature flag' })
  }
})

router.get('/:feature/grants', async (req, res) => {
  if (!PILOT_FEATURES.includes(req.params.feature)) return res.status(400).json({ error: 'Pilot grants are supported only for interview capabilities' })
  try {
    const grants = await prisma.userFeatureGrant.findMany({ where: { feature: req.params.feature }, select: { userId: true, grantedBy: true, createdAt: true, user: { select: { email: true } } } })
    res.json({ grants })
  } catch { res.status(500).json({ error: 'Failed to read pilot grants' }) }
})

router.put('/:feature/grants/:userId', async (req, res) => {
  if (!PILOT_FEATURES.includes(req.params.feature) || typeof req.body?.granted !== 'boolean') {
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
    else {
      await prisma.userFeatureGrant.deleteMany({ where: key })
      if (LEARNER_FEATURES.includes(req.params.feature)) await cancelLearnerJobs(req.params.userId)
    }
    res.json({ success: true })
  } catch { res.status(500).json({ error: 'Failed to update pilot grant' }) }
})

export default router
