import { useEffect, useRef } from 'react'
import { trackProductEvent, type ClientFeature } from '@/lib/productTelemetry'

export function useFeatureMilestone(feature: ClientFeature, action: string, sessionId?: string | null, enabled = true) {
  const sent = useRef<string | null>(null)
  useEffect(() => {
    if (!enabled) return
    const key = `${feature}:${action}:${sessionId ?? ''}`
    if (sent.current === key) return
    sent.current = key
    trackProductEvent({ feature, action, sessionId, outcome: 'viewed', metadata: sessionId ? { source: feature } : undefined })
  }, [action, enabled, feature, sessionId])
}
