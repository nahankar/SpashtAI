import { Router, type Request, type Response } from 'express'
import { prisma } from '../../lib/prisma'
import { ensurePlatformSettings, getPlatformSettings } from '../../lib/platformSettings'

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

export default router
