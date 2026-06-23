import type { Request, Response } from 'express'
import { getPublicPlatformSettings } from '../lib/platformSettings'

export async function getPublicPlatform(_req: Request, res: Response) {
  try {
    const settings = await getPublicPlatformSettings()
    res.json(settings)
  } catch (err) {
    console.error('Public platform settings error:', err)
    res.status(500).json({ error: 'Failed to load platform settings' })
  }
}
