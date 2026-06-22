import type { Request, Response, NextFunction } from 'express'
import { prisma } from './prisma'

export type PlatformFeature = 'elevate' | 'replay'

export const PLATFORM_FEATURES: PlatformFeature[] = ['elevate', 'replay']

const DEFAULT_FLAGS: Array<{
  feature: PlatformFeature
  label: string
  description: string
  enabled: boolean
}> = [
  {
    feature: 'elevate',
    label: 'Elevate',
    description: 'Live AI voice coaching sessions via LiveKit.',
    enabled: true,
  },
  {
    feature: 'replay',
    label: 'Replay',
    description: 'Upload recordings or transcripts for post-session analysis.',
    enabled: true,
  },
]

let cache: { map: Record<PlatformFeature, boolean>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5_000

export function invalidateFeatureFlagCache(): void {
  cache = null
}

export async function ensureFeatureFlags(): Promise<void> {
  const count = await prisma.platformFeatureFlag.count()
  if (count === 0) {
    await prisma.platformFeatureFlag.createMany({ data: DEFAULT_FLAGS })
    console.log(`✅ Seeded ${DEFAULT_FLAGS.length} platform feature flags`)
    return
  }

  const existing = await prisma.platformFeatureFlag.findMany({ select: { feature: true } })
  const have = new Set(existing.map((r) => r.feature))
  const missing = DEFAULT_FLAGS.filter((f) => !have.has(f.feature))
  if (missing.length > 0) {
    await prisma.platformFeatureFlag.createMany({ data: missing })
    console.log(`✅ Added ${missing.length} missing platform feature flag(s)`)
  }
}

export async function getFeatureFlagsMap(): Promise<Record<PlatformFeature, boolean>> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) {
    return cache.map
  }

  await ensureFeatureFlags()
  const rows = await prisma.platformFeatureFlag.findMany()
  const map: Record<PlatformFeature, boolean> = { elevate: true, replay: true }
  for (const row of rows) {
    if (PLATFORM_FEATURES.includes(row.feature as PlatformFeature)) {
      map[row.feature as PlatformFeature] = row.enabled
    }
  }

  cache = { map, expiresAt: now + CACHE_TTL_MS }
  return map
}

export async function getEnabledFeatures(): Promise<PlatformFeature[]> {
  const map = await getFeatureFlagsMap()
  return PLATFORM_FEATURES.filter((f) => map[f])
}

export async function isFeatureEnabled(feature: PlatformFeature): Promise<boolean> {
  const map = await getFeatureFlagsMap()
  return map[feature]
}

export function requireFeature(feature: PlatformFeature) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await isFeatureEnabled(feature)) {
        next()
        return
      }
      res.status(403).json({
        error: 'Feature is not available',
        feature,
        code: 'FEATURE_DISABLED',
      })
    } catch (err) {
      console.error('Feature flag check failed:', err)
      res.status(500).json({ error: 'Failed to verify feature availability' })
    }
  }
}
