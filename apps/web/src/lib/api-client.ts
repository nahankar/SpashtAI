const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extra,
  }
  const token = localStorage.getItem('spashtai_token')
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return headers
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean
}

export async function apiClient<T = any>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth = false, headers: extraHeaders, ...rest } = options

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `Request failed: ${response.status}`)
  }

  return response.json()
}
