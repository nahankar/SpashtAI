import type { SortDir, SortField } from '@/components/SessionFilters'
import type { RetainResult } from '@/lib/sessionRetain'
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

