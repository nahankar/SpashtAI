/**
 * Product and identity HTTP helpers.
 *
 * Identity Bearer (`Authorization`) is the signed-in person. Organization product
 * requests also send the workspace JWT in `x-spasht-workspace`. The server rechecks
 * membership and never falls back to Personal. Missing, invalid, expired or mismatched
 * workspace credentials fail closed (`isWorkspaceFailure`).
 *
 * Workspace administration (`/api/workspaces/current/...`) uses the workspace JWT
 * as the Bearer instead. Use `workspaceCall` / `currentWorkspaceRequest` for those
 * routes — do not send the identity token as Bearer there.
 */
import { getActiveWorkspace, isWorkspaceFailure, reportWorkspaceFailure, scopedStorageKey, workspaceHeaders } from '@/workspaces/activeWorkspace'

const API_BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

/** Storage key for the in-progress session id, namespaced per workspace. */
export function activeSessionKey() {
  return scopedStorageKey('spashtai_active_session')
}
export function sessionTimestampKey() {
  return scopedStorageKey('spashtai_session_timestamp')
}

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
    const sessionId = localStorage.getItem(activeSessionKey())
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
  return { ...headers, ...workspaceHeaders() }
}

/** Authenticated Personal media URL for `<audio src>` (cannot send Authorization headers). */
export function getAuthenticatedMediaUrl(path: string): string | null {
  const token = localStorage.getItem('spashtai_token')
  if (!token || getActiveWorkspace()) return null
  const base = API_BASE.replace(/\/$/, '')
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${base}${normalized}?access_token=${encodeURIComponent(token)}`
}

/**
 * Streamable recording URL for the current context. Inside a workspace the browser first gets a
 * session-bound playback ticket, because `<audio>` range requests cannot carry the workspace header.
 */
export async function getSessionRecordingUrl(sessionId: string): Promise<string | null> {
  const path = `/sessions/${encodeURIComponent(sessionId)}/recording/stream`
  if (!getActiveWorkspace()) return getAuthenticatedMediaUrl(path)
  const token = localStorage.getItem('spashtai_token')
  if (!token) return null
  const { ticket } = await apiClient<{ ticket: string }>(`/sessions/${encodeURIComponent(sessionId)}/recording/ticket`, { method: 'POST' })
  const query = new URLSearchParams({ access_token: token, workspace_media: ticket })
  return `${API_BASE.replace(/\/$/, '')}${path}?${query}`
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean
}

export class ApiError extends Error {
  status: number
  code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export async function apiClient<T = unknown>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth = false, headers: extraHeaders, ...rest } = options

  const headers: Record<string, string> = skipAuth
    ? { 'Content-Type': 'application/json', ...getCorrelationHeaders(), ...(extraHeaders as Record<string, string>) }
    : getAuthHeaders(extraHeaders as Record<string, string>)

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`

  const response = await fetch(url, { ...rest, headers })

  if ((response.status === 401 || response.status === 403 || response.status === 404) && getActiveWorkspace()) {
    const body = (await response.clone().json().catch(() => ({}))) as { error?: string; code?: string }
    // Workspace access ended or the token expired: re-open the workspace, never sign out or fall back to Personal.
    if (isWorkspaceFailure(body.code)) {
      reportWorkspaceFailure(body.code)
      throw new ApiError(body.error || 'Open the workspace again to continue', response.status, body.code)
    }
  }

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
      code?: string
    }
    throw new ApiError(body.message || body.error || `Request failed: ${response.status}`, response.status, body.code)
  }

  // 204 carries no body; calling .json() on it throws.
  if (response.status === 204) return null as T

  return response.json()
}
