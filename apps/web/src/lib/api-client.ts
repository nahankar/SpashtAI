const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

/**
 * Correlation headers for log tracing. `x-request-id` lets the server echo a
 * per-call id; `x-conversation-id` ties the call to the active session so API,
 * agent, and browser logs share one key. Additive and best-effort — never
 * throws, so it can't affect a request.
 */
export function getCorrelationHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  try {
    const rid =
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(36).slice(2)}`
    headers['x-request-id'] = rid
    const sessionId = localStorage.getItem('spashtai_active_session')
    if (sessionId) headers['x-conversation-id'] = sessionId
  } catch {
    /* correlation is best-effort */
  }
  return headers
}

export function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getCorrelationHeaders(),
    ...extra,
  }
  const token = localStorage.getItem('spashtai_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

/** Authenticated media URL for `<audio src>` (cannot send Authorization headers). */
export function getAuthenticatedMediaUrl(path: string): string | null {
  const token = localStorage.getItem('spashtai_token')
  if (!token) return null
  const base = API_BASE.replace(/\/$/, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}?access_token=${encodeURIComponent(token)}`
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean
}

export async function apiClient<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth = false, headers: extraHeaders, ...rest } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...getCorrelationHeaders(),
    ...(extraHeaders as Record<string, string>),
  }

  if (!skipAuth) {
    const token = localStorage.getItem('spashtai_token')
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`

  const response = await fetch(url, { ...rest, headers })

  if (response.status === 401) {
    localStorage.removeItem('spashtai_token')
    const currentPath = window.location.pathname
    if (currentPath !== '/auth/login' && currentPath !== '/auth/register') {
      window.location.href = '/auth/login'
    }
    throw new Error('Authentication required')
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      message?: string
      error?: string
    }
    throw new Error(body.message || body.error || `Request failed: ${response.status}`)
  }

  // 204 carries no body; calling .json() on it throws.
  if (response.status === 204) return null as T

  return response.json()
}
