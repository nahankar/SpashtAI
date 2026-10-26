import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionFilters, type SortDir, type SortField } from '@/components/SessionFilters'
import { AutoCompleteNotice } from '@/components/session/SessionRetain'
import { apiClient } from '@/lib/api-client'
import type { InterviewHistory as Practice } from '@/lib/interview-practice'
import { applyRetain, deletePractices, historyPath, toggleVisible, type HistoryPage } from '@/lib/interview-history'
import { InterviewHistoryList } from '@/features/interviews/InterviewHistoryList'

const statusOptions = [{ value: 'all', label: 'All practices' }, { value: 'active', label: 'In progress' }, { value: 'ended', label: 'Ended' }]
const sortOptions: { value: SortField; label: string }[] = [{ value: 'date', label: 'Date' }, { value: 'name', label: 'Track' }, { value: 'status', label: 'Status' }]

export function InterviewHistory() {
  const [page, setPage] = useState<HistoryPage>({ runs: [], total: 0, ownerTotal: 0, nextOffset: null })
  const runs = page.runs
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading'); const [loadingMore, setLoadingMore] = useState(false)
  const [search, setSearch] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('all')
  const [sortField, setSortField] = useState<SortField>('date'); const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [deleting, setDeleting] = useState(false)
  const confirmDialog = useConfirm()
  // Typing waits briefly before asking the server, which searches the whole history.
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 300); return () => clearTimeout(timer) }, [search])
  const filters = useMemo(() => ({ q: query, status, sort: sortField, dir: sortDir }), [query, status, sortField, sortDir])
  const load = useCallback((signal?: AbortSignal, keep = 0) => {
    if (!keep) setState(previous => previous === 'ready' ? 'ready' : 'loading')
    apiClient<HistoryPage>(historyPath(filters, 0, Math.min(100, Math.max(20, keep))), { signal })
      .then(result => { setPage(result); setState('ready')
        // A selection only ever covers records that are loaded and shown.
        setSelected(previous => new Set([...previous].filter(id => result.runs.some(run => run.id === id)))) })
      .catch(() => { if (!signal?.aborted) setState('error') })
  }, [filters])
  useEffect(() => { const abort = new AbortController(); load(abort.signal); return () => abort.abort() }, [load])
  async function loadMore() {
    if (page.nextOffset === null) return
    setLoadingMore(true)
    try {
      const more = await apiClient<HistoryPage>(historyPath(filters, page.nextOffset))
      setPage(previous => ({ ...more, runs: [...previous.runs, ...more.runs.filter(run => !previous.runs.some(r => r.id === run.id))] }))
    } catch { toast.error('More practices could not be loaded. Try again.') } finally { setLoadingMore(false) }
  }
  const visible = runs
  const allVisibleSelected = visible.length > 0 && visible.every(run => selected.has(run.id))
  // Bulk actions only ever apply to records the learner can currently see.
  const selectedVisible = visible.filter(run => selected.has(run.id))
  async function remove(targets: Practice[]) {
    const ok = await confirmDialog({ title: targets.length === 1 ? 'Delete practice' : 'Delete practices',
      description: targets.length === 1 ? 'Delete this practice, its recording, transcript and technical feedback? This cannot be undone.'
        : `Delete ${targets.length} practices, with their recordings, transcripts and technical feedback? This cannot be undone.`,
      confirmLabel: targets.length === 1 ? 'Delete' : 'Delete all', variant: 'destructive' })
    if (!ok) return
    setDeleting(true)
    try {
      const { deleted, failed } = await deletePractices(targets)
      // Successful deletions leave immediately; failed ones stay listed and selected for a retry.
      setPage(previous => ({ ...previous, runs: previous.runs.filter(row => !deleted.includes(row.id)) }))
      setSelected(previous => new Set([...previous].filter(id => !deleted.includes(id))))
      if (failed.length) toast.error(`${failed.length} of ${targets.length} could not be deleted. They are still listed; try again.`)
      else toast.success(deleted.length === 1 ? 'Practice deleted' : `${deleted.length} practices deleted`)
      load(undefined, runs.length)
    } finally { setDeleting(false) }
  }
  return <div className="mx-auto max-w-5xl space-y-5">
    <header className="space-y-1">
      <Link to="/interviews" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" /> Interviews</Link>
      <h1 className="text-3xl font-semibold">Interview history</h1>
      <p className="text-muted-foreground">Your interview practices only. Resume an unfinished practice or review a finished one. Separate from Elevate, Replay and Progress Pulse.</p>
    </header>
    {state === 'loading' && <p role="status" className="text-sm text-muted-foreground">Loading your interview history…</p>}
    {state === 'error' && <Card><CardContent className="space-y-3 py-10 text-center">
      <p role="alert">Your interview history could not be loaded.</p><Button variant="outline" onClick={() => load()}>Retry</Button>
    </CardContent></Card>}
    {state === 'ready' && page.ownerTotal === 0 && <Card><CardContent className="space-y-3 py-16 text-center">
      <h2 className="text-lg font-medium">No interview practices yet</h2>
      <p className="text-sm text-muted-foreground">Practices you start appear here with their answered and skipped questions.</p>
      <Button asChild><Link to="/interviews">Start a practice</Link></Button>
    </CardContent></Card>}
    {state === 'ready' && page.ownerTotal > 0 && <>
      <SessionFilters search={search} onSearchChange={setSearch} searchPlaceholder="Search by track, difficulty or experience…"
        sortField={sortField} sortDir={sortDir} onSortChange={(field, dir) => { setSortField(field); setSortDir(dir) }} sortOptions={sortOptions}
        statusFilter={status} onStatusFilterChange={setStatus} statusOptions={statusOptions} totalCount={page.ownerTotal} filteredCount={page.total} />
      <AutoCompleteNotice scope="interview" count={runs.filter(r => !r.endedAt).length} />
      {visible.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No practices match these filters.</CardContent></Card>
        : <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-2"><input type="checkbox" className="h-4 w-4 accent-primary" checked={allVisibleSelected}
              onChange={() => setSelected(previous => toggleVisible(previous, visible))} />Select all {visible.length} shown</label>
            {selectedVisible.length > 0 && <>
              <span className="text-muted-foreground">{selectedVisible.length} selected</span>
              <Button variant="destructive" size="sm" disabled={deleting} onClick={() => void remove(selectedVisible)}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedVisible.length} selected</Button>
              <Button variant="outline" size="sm" disabled={deleting} onClick={() => setSelected(new Set())}>Clear</Button>
            </>}
          </div>
          <InterviewHistoryList runs={visible} onRetain={(run, result) => setPage(previous => ({ ...previous, runs: applyRetain(previous.runs, run, result) }))}
            selected={selected} onToggle={run => setSelected(previous => { const next = new Set(previous); if (next.has(run.id)) next.delete(run.id); else next.add(run.id); return next })}
            onDelete={run => void remove([run])} />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>Showing {visible.length} of {page.total}{page.total !== page.ownerTotal ? ` matching (${page.ownerTotal} in total)` : ''}</span>
            {page.nextOffset !== null && <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more'}</Button>}
          </div>
        </>}
    </>}
  </div>
}
