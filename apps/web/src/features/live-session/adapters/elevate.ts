import { completeLiveActivity } from '../completion'
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
    async createActivity(id, startedAt) {
      const response = await api.request('/sessions', { method: 'POST', body: JSON.stringify(this.creationBody(id, startedAt)) })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to create Elevate session')
      }
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
    async complete(id, capture, effects, now) { await completeLiveActivity(api, this, id, capture, effects, now) },
    endBody(endedAt) { return { endedAt, preparationId: null } },
  }
}
