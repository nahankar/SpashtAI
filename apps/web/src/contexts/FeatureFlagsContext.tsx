import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

export type PlatformFeature = 'elevate' | 'replay'

export type FeatureFlags = Record<PlatformFeature, boolean>

const DEFAULT_FLAGS: FeatureFlags = { elevate: true, replay: true }

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface FeatureFlagsContextType {
  flags: FeatureFlags
  loading: boolean
  isEnabled: (feature: PlatformFeature) => boolean
  refresh: () => Promise<void>
}

const FeatureFlagsContext = createContext<FeatureFlagsContextType | null>(null)

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/features`)
      if (!res.ok) throw new Error('Failed to load feature flags')
      const data = await res.json()
      setFlags({
        elevate: data.features?.elevate ?? true,
        replay: data.features?.replay ?? true,
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

  const isEnabled = useCallback(
    (feature: PlatformFeature) => flags[feature],
    [flags],
  )

  return (
    <FeatureFlagsContext.Provider value={{ flags, loading, isEnabled, refresh }}>
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
