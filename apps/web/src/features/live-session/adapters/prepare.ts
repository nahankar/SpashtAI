import type { ActivityAdapter, LaunchConfig } from '../types'
import type { LiveSessionApi } from '../api'
import { elevateAdapter } from './elevate'
export function prepareAdapter(api: LiveSessionApi, config: LaunchConfig): ActivityAdapter {
  const ordinary = elevateAdapter(api, config)
  const path = (id: string) => `/api/preparations/${encodeURIComponent(config.preparationId!)}/practices/${encodeURIComponent(id)}/discard`
  return { ...ordinary, kind: 'prepare', preparationId: config.preparationId ?? null,
    creationBody(id, startedAt) { return { ...ordinary.creationBody(id, startedAt), preparationId: config.preparationId, stageId: config.stageId || null } },
    async cleanupFailedJoin(id, linked) {
      // Preserve the legacy creation-failure cleanup path until linked creation succeeds.
      if (!linked) return ordinary.cleanupFailedJoin(id, false)
      await api.request(path(id), { method: 'POST' }).catch(() => null)
    },
    async discard(id) {
      const response = await api.request(path(id), { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || `Discard failed with HTTP ${response.status}`)
      }
    },
    trackPulse: false, skipPulseCall: false,
    endBody(endedAt) { return { endedAt, preparationId: config.preparationId || null } },
  }
}
