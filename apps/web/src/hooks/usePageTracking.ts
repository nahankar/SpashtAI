import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { apiClient } from '@/lib/api-client'

/** Records authenticated page views to server-side FeatureUsage (for admin analytics). */
export function usePageTracking() {
  const location = useLocation()
  const { user } = useAuth()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!user) return
    const path = location.pathname
    if (path === lastPath.current) return
    lastPath.current = path

    apiClient('/api/events/track', {
      method: 'POST',
      body: JSON.stringify({
        feature: 'app',
        action: 'page_view',
        metadata: { path },
      }),
    }).catch(() => {
      // Non-blocking — analytics must not break navigation
    })
  }, [location.pathname, user])
}
