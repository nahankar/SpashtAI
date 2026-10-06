import type { Request, Response } from 'express'
import { verifyToken } from '../lib/jwt'
import { getFeatureFlagsMap, PLATFORM_FEATURES, isFeatureVisible } from '../lib/featureFlags'

export async function getPublicFeatures(req: Request, res: Response) {
  try {
    const map = await getFeatureFlagsMap()
    let userId: string | undefined
    const header = req.headers.authorization
    if (header?.startsWith('Bearer ')) {
      try { userId = verifyToken(header.slice(7)).userId } catch { /* anonymous visibility */ }
    }
    const resolved = { ...map }
    for (const feature of PLATFORM_FEATURES) {
      if (map[feature].audience === 'SELECTED_USERS' && !await isFeatureVisible(feature, userId)) {
        resolved[feature] = { ...map[feature], hidden: true }
      }
    }
    res.json({
      features: PLATFORM_FEATURES.reduce(
        (acc, feature) => {
          acc[feature] = resolved[feature]
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
