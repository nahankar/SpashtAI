import { signInPolicySchema } from '../../lib/signInPolicy'
import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ensurePlatformSettings, getPlatformSettings } from '../../lib/platformSettings'
import { setAdminRateLimitBypassEnabled, setRateLimitSettings } from '../../middleware/rate-limit'
import { requireSuperAdmin } from '../../middleware/admin'
import { rateLimitSettingsSchema } from '../../lib/rateLimitSettings'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await getPlatformSettings()
    res.json({ settings })
  } catch (err) {
    console.error('Admin platform settings error:', err)
    res.status(500).json({ error: 'Failed to load platform settings' })
  }
})

router.put('/sign-in', async (req, res) => {
  const parsed = signInPolicySchema.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Select at least one sign-in method' }); return }
  try {
    await ensurePlatformSettings()
    const settings = await prisma.$transaction(async tx => {
      const value = await tx.platformSettings.update({ where: { id: 'default' }, data: { googleSignInEnabled: parsed.data.google, emailCodeSignInEnabled: parsed.data.emailCode, updatedBy: req.user!.userId } })
      await tx.adminAction.create({ data: { adminId: req.user!.userId, action: 'platform.sign_in_policy_updated', metadata: parsed.data } })
      return value
    })
    res.json({ settings })
  } catch { res.status(500).json({ error: 'Unable to save sign-in settings' }) }
})

router.put('/signups', async (req: Request, res: Response) => {
  try {
    await ensurePlatformSettings()
    const { signupsPaused, signupsPausedMessage } = req.body as {
      signupsPaused?: boolean
      signupsPausedMessage?: string | null
    }

    if (signupsPaused !== undefined && typeof signupsPaused !== 'boolean') {
      res.status(400).json({ error: 'signupsPaused must be a boolean' })
      return
    }

    const adminId = req.user?.userId ?? null

    const settings = await prisma.platformSettings.update({
      where: { id: 'default' },
      data: {
        ...(signupsPaused !== undefined && { signupsPaused }),
        ...(signupsPausedMessage !== undefined && {
          signupsPausedMessage: signupsPausedMessage?.trim() || null,
        }),
        updatedBy: adminId,
      },
    })

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: settings.signupsPaused ? 'platform.signups_paused' : 'platform.signups_resumed',
          metadata: { signupsPaused: settings.signupsPaused },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json({ settings })
  } catch (err) {
    console.error('Update signups setting error:', err)
    res.status(500).json({ error: 'Failed to update signup settings' })
  }
})

router.put('/rate-limit', async (req: Request, res: Response) => {
  try {
    const { adminRateLimitBypass } = req.body as {
      adminRateLimitBypass?: boolean
    }
    if (typeof adminRateLimitBypass !== 'boolean') {
      res.status(400).json({ error: 'adminRateLimitBypass must be a boolean' })
      return
    }

    await ensurePlatformSettings()
    const adminId = req.user?.userId ?? null
    const settings = await prisma.platformSettings.update({
      where: { id: 'default' },
      data: {
        adminRateLimitBypass,
        updatedBy: adminId,
      },
    })
    setAdminRateLimitBypassEnabled(settings.adminRateLimitBypass)

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: settings.adminRateLimitBypass
            ? 'platform.admin_rate_limit_bypass_enabled'
            : 'platform.admin_rate_limit_bypass_disabled',
          metadata: { adminRateLimitBypass: settings.adminRateLimitBypass },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json({ settings })
  } catch (err) {
    console.error('Update API rate-limit setting error:', err)
    res.status(500).json({ error: 'Failed to update API rate-limit setting' })
  }
})

// Numeric traffic limits are platform-wide and restricted to the current Super Admin role.
router.put('/rate-limit/settings', requireSuperAdmin, async (req: Request, res: Response) => {
  const parsed = rateLimitSettingsSchema.strict().safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Enter whole-number request limits from 1 to 1,000,000 and windows from 1 to 1,440 minutes.' })
    return
  }
  try {
    await ensurePlatformSettings()
    const adminId = req.user!.userId
    const settings = await prisma.$transaction(async tx => {
      const updated = await tx.platformSettings.update({
        where: { id: 'default' }, data: { ...parsed.data, updatedBy: adminId },
      })
      await tx.adminAction.create({ data: {
        adminId, action: 'platform.rate_limits_updated', metadata: parsed.data,
      } })
      return updated
    })
    setRateLimitSettings(settings)
    res.json({ settings })
  } catch (err) {
    console.error('Update traffic limits error:', err)
    res.status(500).json({ error: 'Failed to update traffic limits' })
  }
})

router.put('/reward-points', async (req: Request, res: Response) => {
  try {
    const { rewardPointsEnabled } = req.body as { rewardPointsEnabled?: boolean }
    if (typeof rewardPointsEnabled !== 'boolean') {
      res.status(400).json({ error: 'rewardPointsEnabled must be a boolean' })
      return
    }

    await ensurePlatformSettings()
    const adminId = req.user?.userId ?? null
    const settings = await prisma.platformSettings.update({
      where: { id: 'default' },
      data: { rewardPointsEnabled, updatedBy: adminId },
    })

    try {
      await prisma.adminAction.create({
        data: {
          adminId: adminId ?? 'unknown',
          action: settings.rewardPointsEnabled
            ? 'platform.reward_points_enabled'
            : 'platform.reward_points_disabled',
          metadata: { rewardPointsEnabled: settings.rewardPointsEnabled },
        },
      })
    } catch (auditErr) {
      console.warn('Audit log skipped:', auditErr)
    }

    res.json({ settings })
  } catch (err) {
    console.error('Update reward points setting error:', err)
    res.status(500).json({ error: 'Failed to update reward points setting' })
  }
})

export default router
