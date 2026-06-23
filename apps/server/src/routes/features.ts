import type { Request, Response } from 'express'
import { getFeatureFlagsMap, PLATFORM_FEATURES } from '../lib/featureFlags'

export async function getPublicFeatures(_req: Request, res: Response) {
  try {
    const map = await getFeatureFlagsMap()
    res.json({
      features: PLATFORM_FEATURES.reduce(
        (acc, feature) => {
          acc[feature] = map[feature]
          return acc
        },
        {} as Record<string, typeof map.elevate>,
      ),
    })
  } catch (err) {
    console.error('Public features error:', err)
    res.status(500).json({ error: 'Failed to load feature flags' })
  }
}
