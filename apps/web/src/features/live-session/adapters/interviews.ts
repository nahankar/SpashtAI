import type { ActivityAdapter } from '../types'
import type { LiveSessionApi } from '../api'
import type { InterviewSetup } from '@/lib/interview-practice'

export function interviewsAdapter(api: LiveSessionApi, setup: InterviewSetup, currentRun: () => string|null,
  created: (run: { id: string; sessionId: string }) => void): ActivityAdapter {
  async function request(path: string, method = 'POST', body: unknown = {}) {
    const response = await api.request(`/api/interviews${path}`, { method, ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body) }) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || 'Interview request failed')
    return data
  }
  const creationBody = (id: string) => ({ sessionId: id, ...setup })
  const discard = async () => { const id=currentRun(); if (id) await request(`/runs/${encodeURIComponent(id)}`, 'DELETE') }
  return {
    kind: 'interviews', preparationId: null, trackPulse: false, skipPulseCall: false, creationBody,
    async createActivity(id) {
      const run = await request('/runs', 'POST', creationBody(id)); created(run)
      await request(`/runs/${encodeURIComponent(run.id)}/next`)
    },
    cleanupFailedJoin: async () => { await discard().catch(() => undefined) }, discard,
    endBody: () => ({}),
    async complete(sessionId, capture) {
      const id = currentRun(); if (!id) throw new Error('Interview not found')
      await request(`/runs/${encodeURIComponent(id)}/end`)
      // Existing communication analysis stays separate and purpose policy
      // prevents any interview Pulse or points contribution.
      if (capture === 'uploaded') void api.request(`/sessions/${encodeURIComponent(sessionId)}/analyze`, {
        method: 'POST', body: JSON.stringify({ source: 'elevate', autoTrackPulse: false }),
      }).catch(() => undefined)
    },
  }
}
