import type { LiveSessionApi } from './api'
import type { ActivityAdapter, CaptureReport, LiveSessionEffects } from './types'
export async function completeLiveActivity(api: LiveSessionApi, adapter: ActivityAdapter, id: string, audioCapture: CaptureReport, effects: LiveSessionEffects, now: () => Date) {
  const trackIt = adapter.trackPulse
  const capture = { audioCapture }
    if (id) {
      try {
        const endRes = await api.request(`/sessions/${id}/end`, {
          method: 'POST',
          body: JSON.stringify(adapter.endBody(now().toISOString()))
        })
        if (endRes.ok) {
          const endData = await endRes.json().catch(() => ({}))
          if (typeof endData.totalPoints === 'number') {
            effects.rewardPoints(endData.totalPoints)
          }
        }

        // Run legacy text metrics (keeps backward compatibility)
        await api.request(`/sessions/${id}/calculate-text-metrics`, {
          method: 'POST',
        })
      } catch (err) {
        console.warn('Failed to finalize session:', err)
      }

      // Snapshot / booth is a first impression, not a Pulse sample.
      // Every other finished session is tracked. The results page can remove it.

      // Run the full analytics pipeline (signal extraction + skill scores + coaching insights)
      try {
        const analyzeRes = await api.request(`/sessions/${id}/analyze`, {
          method: 'POST',
          body: JSON.stringify({
            autoTrackPulse: trackIt,
            source: 'elevate',
            audioCapture: capture.audioCapture,
          }),
        })
        if (analyzeRes.ok) {
          const result = await analyzeRes.json()
          if (trackIt && result.pulseEntriesCreated > 0) {
            effects.toast('success', `Session tracked — ${result.pulseEntriesCreated} skills updated in Progress Pulse`)
          } else if (trackIt) {
            effects.toast('success', 'Session tracked in Progress Pulse')
          }
        } else {
          console.warn('Analytics pipeline returned', analyzeRes.status)
          if (trackIt) effects.toast('success', 'Session tracked in Progress Pulse')
        }
      } catch {
        console.warn('Analytics pipeline unavailable, session still saved')
        if (trackIt) effects.toast('success', 'Session saved')
      }

      if (adapter.skipPulseCall) {
        try {
          await api.request(`/api/progress-pulse/skip`, {
            method: 'POST',
              body: JSON.stringify({ sessionId: id, source: 'elevate' }),
          })
        } catch {
          // non-critical
        }
      }
    }

}
