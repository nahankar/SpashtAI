import { completeLiveActivity } from '../completion'
import type { ActivityAdapter, LaunchConfig } from '../types'
import type { LiveSessionApi } from '../api'

/** Shared request helpers; each adapter is built from closures so no method depends on `this`. */
export function liveSessionRequests(api: LiveSessionApi) {
  return {
    async create(body: Record<string, unknown>) {
      const response = await api.request('/sessions', { method: 'POST', body: JSON.stringify(body) })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to create Elevate session')
      }
    },
    async deleteSession(id: string) {
      await api.request(`/sessions/${id}`, { method: 'DELETE' }).catch(() => null)
    },
    async discardBy(path: string, method: 'DELETE' | 'POST') {
      const response = await api.request(path, { method })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Discard failed with HTTP ${response.status}`)
      }
    },
  }
}

export function elevateAdapter(api: LiveSessionApi, config: LaunchConfig): ActivityAdapter {
  const requests = liveSessionRequests(api)
  const snapshotLike = config.boothDemo || config.focusArea === 'snapshot'
  const creationBody = (id: string, startedAt: string) => ({
    id, module: 'elevate', sessionName: config.sessionName.trim() || null,
    focusArea: config.focusArea || null, focusContext: config.focusContext || null,
    preparationId: null, stageId: null, startedAt,
  })
  const adapter: ActivityAdapter = {
    kind: 'elevate', preparationId: null,
    creationBody,
    createActivity: (id, startedAt) => requests.create(creationBody(id, startedAt)),
    cleanupFailedJoin: id => requests.deleteSession(id),
    discard: id => requests.discardBy(`/sessions/${id}`, 'DELETE'),
    trackPulse: !snapshotLike,
    skipPulseCall: snapshotLike,
    endBody: endedAt => ({ endedAt, preparationId: null }),
    complete: (id, capture, effects, now) => completeLiveActivity(api, adapter, id, capture, effects, now),
  }
  return adapter
}
