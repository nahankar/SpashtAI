import { apiClient } from '@/lib/api-client'
import type {
  AnalyticsPlan,
  AnalyticsResult,
  IdentityPage,
  InterpretResponse,
  RefreshIntervalSec,
  SavedQuery,
  SavedQueryLists,
} from './types'

const ROOT = '/api/admin/analytics/explorer'

function savedPath(id: string, suffix = '') {
  return `${ROOT}/saved/${encodeURIComponent(id)}${suffix}`
}

export function interpretQuestion(question: string, signal?: AbortSignal) {
  return apiClient<InterpretResponse>(`${ROOT}/interpret`, {
    method: 'POST',
    body: JSON.stringify({ question }),
    signal,
  })
}

export function runAnalyticsPlan(question: string, plan: AnalyticsPlan, signal?: AbortSignal) {
  return apiClient<{ result: AnalyticsResult; savedQuery: SavedQuery }>(`${ROOT}/run`, {
    method: 'POST',
    body: JSON.stringify({ question, plan }),
    signal,
  })
}

export function listSavedQueries(signal?: AbortSignal) {
  return apiClient<SavedQueryLists>(`${ROOT}/saved`, { signal })
}

export function runSavedQuery(id: string, signal?: AbortSignal, source: 'auto' | 'manual' = 'manual') {
  return apiClient<{ result: AnalyticsResult; savedQuery: SavedQuery }>(savedPath(id, '/run'), {
    method: 'POST',
    body: JSON.stringify({ source }),
    signal,
  })
}

export function listIdentity(id: string, page: number, signal?: AbortSignal) {
  return apiClient<IdentityPage>(`${savedPath(id, '/users')}?page=${page}`, { signal })
}

export function updateSavedQuery(
  id: string,
  patch: { pinned?: boolean; title?: string; refreshIntervalSec?: RefreshIntervalSec },
) {
  return apiClient<SavedQuery>(savedPath(id), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteSavedQuery(id: string) {
  return apiClient<null>(savedPath(id), { method: 'DELETE' })
}

export function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
