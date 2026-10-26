import type { SortDir, SortField } from '@/components/SessionFilters'
import type { RetainResult } from '@/lib/sessionRetain'
import { apiClient } from '@/lib/api-client'
import { selectionLabel, type InterviewHistory } from '@/lib/interview-practice'

export function practiceCounts(run: InterviewHistory) {
  const parts = [`${run.answeredCount ?? 0} answered`, `${run.skippedCount ?? 0} skipped`]
  if (run.incompleteCount) parts.push(`${run.incompleteCount} incomplete`)
  return parts.join(' · ')
}

/** Apply a retain change to every listed practice (retaining one releases the others). */
export function applyRetain(runs: InterviewHistory[], run: InterviewHistory, result: RetainResult) {
  return runs.map(r => ({ ...r, retainedAt: r.sessionId === run.sessionId ? result.retainedAt : result.releasedSessionIds.includes(r.sessionId) ? null : r.retainedAt }))
}

/** Search, filter and sort the owner's interview practices (the same rules as Elevate and Replay history). */
export function filterPractices(runs: InterviewHistory[], search: string, status: string, sortField: SortField, sortDir: SortDir) {
  const query = search.trim().toLowerCase()
  const rows = runs.filter(run => (status === 'all' || (status === 'ended') === Boolean(run.endedAt))
    && (!query || [selectionLabel(run.track), selectionLabel(run.startingDifficulty), selectionLabel(run.experienceBand)].join(' ').toLowerCase().includes(query)))
  const key = (run: InterviewHistory) => sortField === 'name' ? selectionLabel(run.track).toLowerCase() : sortField === 'status' ? (run.endedAt ? 1 : 0) : Date.parse(run.startedAt)
  return [...rows].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * (sortDir === 'asc' ? 1 : -1) })
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
