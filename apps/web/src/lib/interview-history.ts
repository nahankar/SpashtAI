import type { SortDir, SortField } from '@/components/SessionFilters'
import type { RetainResult } from '@/lib/sessionRetain'
import { apiClient } from '@/lib/api-client'
import type { InterviewHistory } from '@/lib/interview-practice'

export function practiceCounts(run: InterviewHistory) {
  const parts = [`${run.answeredCount ?? 0} answered`, `${run.skippedCount ?? 0} skipped`]
  if (run.incompleteCount) parts.push(`${run.incompleteCount} incomplete`)
  return parts.join(' · ')
}

/** Apply a retain change to every listed practice (retaining one releases the others). */
export function applyRetain(runs: InterviewHistory[], run: InterviewHistory, result: RetainResult) {
  return runs.map(r => ({ ...r, retainedAt: r.sessionId === run.sessionId ? result.retainedAt : result.releasedSessionIds.includes(r.sessionId) ? null : r.retainedAt }))
}

export type HistoryPage = { runs: InterviewHistory[]; total: number; ownerTotal: number; nextOffset: number | null }
export type HistoryQuery = { q: string; status: string; sort: SortField; dir: SortDir }
/** The server applies search, status and sort to the whole owned history; the page only asks for a slice. */
export function historyPath(query: HistoryQuery, offset = 0, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset), status: query.status, sort: query.sort === 'name' || query.sort === 'status' ? query.sort : 'date', dir: query.dir })
  if (query.q.trim()) params.set('q', query.q.trim())
  return `/api/interviews/runs?${params}`
}


/**
 * Delete practices through the shared session deletion (tombstone now, durable purge later). Each result is
 * reported separately so a partial failure keeps the records that were not deleted.
 */
export async function deletePractices(runs: InterviewHistory[]) {
  const results = await Promise.allSettled(runs.map(run => apiClient(`/sessions/${encodeURIComponent(run.sessionId)}`, { method: 'DELETE' })))
  return { deleted: runs.filter((_, i) => results[i].status === 'fulfilled').map(r => r.id), failed: runs.filter((_, i) => results[i].status === 'rejected').map(r => r.id) }
}
/** Select or clear every visible practice, keeping selections outside the current filter untouched. */
export function toggleVisible(selected: Set<string>, visible: InterviewHistory[]) {
  const next = new Set(selected); const all = visible.length > 0 && visible.every(r => next.has(r.id))
  for (const run of visible) { if (all) next.delete(run.id); else next.add(run.id) }
  return next
}

/** History may open only once no practice is connected or in the middle of connecting, pausing or ending. */
export function historyNavigationBlocked(live: { token?: string | null; isJoining?: boolean; isResuming?: boolean; isPausing?: boolean; isLeaving?: boolean }) {
  return Boolean(live.token || live.isJoining || live.isResuming || live.isPausing || live.isLeaving)
}
