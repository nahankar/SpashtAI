import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { EngagementClock } from '@/lib/engagementClock'
import { trackProductEvent } from '@/lib/productTelemetry'

/** Records authenticated page views and visible, non-idle time. Background tabs are excluded. */
export function usePageTracking() {
  const location = useLocation()
  const { user } = useAuth()
  const userId = user?.id

  useEffect(() => {
    if (!userId) return
    const path = location.pathname
    const clock = new EngagementClock()
    trackProductEvent({ feature: 'app', action: 'page_view', path, outcome: 'viewed', metadata: { path } })

    const onVisibility = () => clock.setHidden(document.visibilityState === 'hidden')
    const onActivity = () => clock.markActivity()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pointerdown', onActivity, { passive: true })
    window.addEventListener('keydown', onActivity)
    onVisibility()

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pointerdown', onActivity)
      window.removeEventListener('keydown', onActivity)
      trackProductEvent({
        feature: 'app',
        action: 'page_exit',
        path,
        engagementMs: clock.flush(),
        outcome: 'completed',
        metadata: { path },
      })
    }
  }, [location.pathname, userId])
}
