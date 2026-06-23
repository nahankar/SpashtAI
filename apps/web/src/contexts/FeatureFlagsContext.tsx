import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type PlatformFeature = 'elevate' | 'replay'

export interface FeatureFlagState {
  hidden: boolean
  disabled: boolean
  overlayComment: string | null
  overlayPosition: 'top' | 'center'
}

export type FeatureFlags = Record<PlatformFeature, FeatureFlagState>

const DEFAULT_FLAG: FeatureFlagState = {
  hidden: false,
  disabled: false,
  overlayComment: null,
  overlayPosition: 'center',
}

const DEFAULT_FLAGS: FeatureFlags = { elevate: DEFAULT_FLAG, replay: DEFAULT_FLAG }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface FeatureFlagsContextType {
  flags: FeatureFlags
  loading: boolean
  isVisible: (feature: PlatformFeature) => boolean
  isAccessible: (feature: PlatformFeature) => boolean
  /** @deprecated use isAccessible */
  isEnabled: (feature: PlatformFeature) => boolean
  getFlag: (feature: PlatformFeature) => FeatureFlagState
  refresh: () => Promise<void>
}

const FeatureFlagsContext = createContext<FeatureFlagsContextType | null>(null)

function normalizeFlag(raw: unknown): FeatureFlagState {
  if (typeof raw === 'boolean') {
    return raw
      ? { hidden: false, disabled: false, overlayComment: null, overlayPosition: 'center' }
      : { hidden: true, disabled: false, overlayComment: null, overlayPosition: 'center' }
  }
  const o = raw as Partial<FeatureFlagState>
  return {
    hidden: Boolean(o.hidden),
    disabled: Boolean(o.disabled),
    overlayComment: o.overlayComment ?? null,
    overlayPosition: o.overlayPosition === 'top' ? 'top' : 'center',
  }
}

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/features`)
      if (!res.ok) throw new Error('Failed to load feature flags')
      const data = await res.json()
      setFlags({
        elevate: normalizeFlag(data.features?.elevate),
        replay: normalizeFlag(data.features?.replay),
      })
    } catch (err) {
      console.warn('Feature flags unavailable, defaulting to all enabled:', err)
      setFlags(DEFAULT_FLAGS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const getFlag = useCallback((feature: PlatformFeature) => flags[feature], [flags])
  const isVisible = useCallback((feature: PlatformFeature) => !flags[feature].hidden, [flags])
  const isAccessible = useCallback(
    (feature: PlatformFeature) => !flags[feature].hidden && !flags[feature].disabled,
    [flags],
  )
  const isEnabled = isAccessible

  return (
    <FeatureFlagsContext.Provider
      value={{ flags, loading, isVisible, isAccessible, isEnabled, getFlag, refresh }}
    >
      {children}
    </FeatureFlagsContext.Provider>
  )
}

export function useFeatureFlags() {
  const ctx = useContext(FeatureFlagsContext)
  if (!ctx) {
    throw new Error('useFeatureFlags must be used within FeatureFlagsProvider')
  }
  return ctx
}
