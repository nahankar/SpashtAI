import { completeLiveActivity } from '../completion'
import type { ActivityAdapter, LaunchConfig } from '../types'
import type { LiveSessionApi } from '../api'
import { elevateAdapter, liveSessionRequests } from './elevate'

export function prepareAdapter(api: LiveSessionApi, config: LaunchConfig): ActivityAdapter {
  const requests = liveSessionRequests(api)
  const ordinary = elevateAdapter(api, config)
  const discardPath = (id: string) =>
    `/api/preparations/${encodeURIComponent(config.preparationId!)}/practices/${encodeURIComponent(id)}/discard`
  const creationBody = (id: string, startedAt: string) => ({
    ...ordinary.creationBody(id, startedAt), preparationId: config.preparationId, stageId: config.stageId || null,
  })
  const adapter: ActivityAdapter = {
    kind: 'prepare', preparationId: config.preparationId ?? null,
    creationBody,
    createActivity: (id, startedAt) => requests.create(creationBody(id, startedAt)),
    async cleanupFailedJoin(id, linked) {
      // Preserve the legacy creation-failure cleanup path until linked creation succeeds.
      if (!linked) return requests.deleteSession(id)
      await api.request(discardPath(id), { method: 'POST' }).catch(() => null)
    },
    discard: id => requests.discardBy(discardPath(id), 'POST'),
    trackPulse: false,
    skipPulseCall: false,
    endBody: endedAt => ({ endedAt, preparationId: config.preparationId || null }),
    complete: (id, capture, effects, now) => completeLiveActivity(api, adapter, id, capture, effects, now),
  }
  return adapter
}
