import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useFeatureFlags, type PlatformFeature } from '@/contexts/FeatureFlagsContext'

export function FeatureGate({
  feature,
  children,
}: {
  feature: PlatformFeature
  children: ReactNode
}) {
  const { isEnabled, loading } = useFeatureFlags()

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!isEnabled(feature)) {
    return <Navigate to="/" replace />
  }

  return children
}
