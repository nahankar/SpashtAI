import type { ActivityAdapter, LaunchConfig } from '../types'
import type { LiveSessionApi } from '../api'
export function elevateAdapter(api: LiveSessionApi, config: LaunchConfig): ActivityAdapter {
  return {
    kind: 'elevate', preparationId: null,
    creationBody(id, startedAt) {
      return { id, module: 'elevate', sessionName: config.sessionName.trim() || null,
        focusArea: config.focusArea || null, focusContext: config.focusContext || null,
        preparationId: null, stageId: null, startedAt }
    },
    async cleanupFailedJoin(id) { await api.request(`/sessions/${id}`, { method: 'DELETE' }).catch(() => null) },
    async discard(id) {
      const response = await api.request(`/sessions/${id}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Discard failed with HTTP ${response.status}`)
      }
    },
    trackPulse: !(config.boothDemo || config.focusArea === 'snapshot'),
    skipPulseCall: config.boothDemo || config.focusArea === 'snapshot',
    endBody(endedAt) { return { endedAt, preparationId: null } },
  }
}
