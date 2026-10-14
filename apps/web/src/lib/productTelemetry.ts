const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
const VISIT_KEY = 'spashtai_visit_id'

export type ClientFeature = 'app' | 'elevate' | 'replay' | 'prepare' | 'interviews' | 'progress_pulse' | 'feedback'

type TrackInput = {
  feature: ClientFeature
  action: string
  sessionId?: string | null
  path?: string | null
  engagementMs?: number | null
  outcome?: string | null
  metadata?: Record<string, string | number | boolean>
}

export function visitId() {
  try {
    const existing = sessionStorage.getItem(VISIT_KEY)
    if (existing) return existing
    const created = crypto.randomUUID()
    sessionStorage.setItem(VISIT_KEY, created)
    return created
  } catch {
    return 'visit-unavailable'
  }
}

export function trackProductEvent(input: TrackInput) {
  try {
    const token = localStorage.getItem('spashtai_token')
    if (!token) return
    const eventId = crypto.randomUUID()
    void fetch(`${API_BASE}/api/events/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...input, eventId, visitId: visitId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* analytics must not affect the product */
  }
}
