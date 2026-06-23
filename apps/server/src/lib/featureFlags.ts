import type { Request, Response, NextFunction } from 'express'
import { prisma } from './prisma'

export type PlatformFeature = 'elevate' | 'replay'

export const PLATFORM_FEATURES: PlatformFeature[] = ['elevate', 'replay']

export interface FeatureFlagPublicState {
  hidden: boolean
  disabled: boolean
  overlayComment: string | null
  overlayPosition: 'top' | 'center'
}

const DEFAULT_FLAGS: Array<{
  feature: PlatformFeature
  label: string
  description: string
  hidden: boolean
  disabled: boolean
}> = [
  {
    feature: 'elevate',
    label: 'Elevate',
    description: 'Live AI voice coaching sessions via LiveKit.',
    hidden: false,
    disabled: false,
  },
  {
    feature: 'replay',
    label: 'Replay',
    description: 'Upload recordings or transcripts for post-session analysis.',
    hidden: false,
    disabled: false,
  },
]

let cache: { map: Record<PlatformFeature, FeatureFlagPublicState>; expiresAt: number } | null = null
const CACHE_TTL_MS = 5_000

export function invalidateFeatureFlagCache(): void {
  cache = null
}

function rowToState(row: {
  hidden?: boolean
  disabled?: boolean
  enabled?: boolean
  overlayComment?: string | null
  overlayPosition?: string | null
}): FeatureFlagPublicState {
  const hidden = row.hidden ?? (row.enabled === false)
  const disabled = row.disabled ?? false
  return {
    hidden,
    disabled: hidden ? false : disabled,
    overlayComment: row.overlayComment ?? null,
    overlayPosition: row.overlayPosition === 'top' ? 'top' : 'center',
  }
}

export async function ensureFeatureFlags(): Promise<void> {
  const count = await prisma.platformFeatureFlag.count()
  if (count === 0) {
    await prisma.platformFeatureFlag.createMany({
      data: DEFAULT_FLAGS.map((f) => ({ ...f, enabled: !f.hidden && !f.disabled })),
    })
    console.log(`✅ Seeded ${DEFAULT_FLAGS.length} platform feature flags`)
    return
  }

  const existing = await prisma.platformFeatureFlag.findMany()
  const have = new Set(existing.map((r) => r.feature))
  const missing = DEFAULT_FLAGS.filter((f) => !have.has(f.feature))
  if (missing.length > 0) {
    await prisma.platformFeatureFlag.createMany({
      data: missing.map((f) => ({ ...f, enabled: !f.hidden && !f.disabled })),
    })
    console.log(`✅ Added ${missing.length} missing platform feature flag(s)`)
  }

  // Migrate legacy `enabled=false` → hidden=true
  for (const row of existing) {
    if (row.enabled === false && !row.hidden && !row.disabled) {
      await prisma.platformFeatureFlag.update({
        where: { feature: row.feature },
        data: { hidden: true, enabled: false },
      })
    }
  }
}

export async function getFeatureFlagsMap(): Promise<Record<PlatformFeature, FeatureFlagPublicState>> {
  const now = Date.now()
  if (cache && cache.expiresAt > now) {
    return cache.map
  }

  await ensureFeatureFlags()
  const rows = await prisma.platformFeatureFlag.findMany()
  const map: Record<PlatformFeature, FeatureFlagPublicState> = {
    elevate: { hidden: false, disabled: false, overlayComment: null, overlayPosition: 'center' },
    replay: { hidden: false, disabled: false, overlayComment: null, overlayPosition: 'center' },
  }
  for (const row of rows) {
    if (PLATFORM_FEATURES.includes(row.feature as PlatformFeature)) {
      map[row.feature as PlatformFeature] = rowToState(row)
    }
  }

  cache = { map, expiresAt: now + CACHE_TTL_MS }
  return map
}

export async function isFeatureAccessible(feature: PlatformFeature): Promise<boolean> {
  const map = await getFeatureFlagsMap()
  const s = map[feature]
  return !s.hidden && !s.disabled
}

export async function isFeatureVisible(feature: PlatformFeature): Promise<boolean> {
  const map = await getFeatureFlagsMap()
  return !map[feature].hidden
}

export async function getEnabledFeatures(): Promise<PlatformFeature[]> {
  const map = await getFeatureFlagsMap()
  return PLATFORM_FEATURES.filter((f) => !map[f].hidden && !map[f].disabled)
}

/** @deprecated use isFeatureAccessible */
export async function isFeatureEnabled(feature: PlatformFeature): Promise<boolean> {
  return isFeatureAccessible(feature)
}

export function requireFeature(feature: PlatformFeature) {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (await isFeatureAccessible(feature)) {
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
