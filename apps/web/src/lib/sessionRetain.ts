import { getAuthHeaders } from '@/lib/api-client'

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

export type RetainResult = { sessionId: string; retainedAt: string | null; releasedSessionIds: string[] }

export async function setSessionRetained(sessionId: string, retain: boolean): Promise<RetainResult> {
  const res = await fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/retain`, {
    method: 'PUT',
    headers: getAuthHeaders(),
    body: JSON.stringify({ retain }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body?.error || 'Could not update retain setting')
  return body as RetainResult
}

/** Applies a retain response: one retained session per user at most. */
export function applyRetainResult<T extends { id: string; retainedAt?: string | null }>(
  items: T[],
  result: RetainResult,
): T[] {
  const released = new Set(result.releasedSessionIds)
  return items.map((item) => {
    if (item.id === result.sessionId) return { ...item, retainedAt: result.retainedAt }
    if (released.has(item.id)) return { ...item, retainedAt: null }
    return item
  })
}
