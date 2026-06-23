import type { ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useFeatureFlags, type PlatformFeature } from '@/contexts/FeatureFlagsContext'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const FEATURE_LABELS: Record<PlatformFeature, string> = {
  elevate: 'Elevate',
  replay: 'Replay',
}

export function FeatureGate({
  feature,
  children,
}: {
  feature: PlatformFeature
  children: ReactNode
}) {
  const { isVisible, isAccessible, getFlag, loading } = useFeatureFlags()

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!isVisible(feature)) {
    return <Navigate to="/" replace />
  }

  if (!isAccessible(feature)) {
    const flag = getFlag(feature)
    const message =
      flag.overlayComment?.trim() || 'This feature is temporarily unavailable. Please check back later.'

    return (
      <div className="flex min-h-[40vh] items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{FEATURE_LABELS[feature]} unavailable</CardTitle>
            <CardDescription>{message}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/">
              <Button variant="outline" className="w-full">
                Back to Home
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return children
}
