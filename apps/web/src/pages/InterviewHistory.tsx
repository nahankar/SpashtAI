import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionFilters, type SortDir, type SortField } from '@/components/SessionFilters'
import { AutoCompleteNotice } from '@/components/session/SessionRetain'
import { apiClient } from '@/lib/api-client'
import { INTERVIEWS_API, type InterviewHistory as Practice } from '@/lib/interview-practice'
import { applyRetain, filterPractices } from '@/lib/interview-history'
import { InterviewHistoryList } from '@/features/interviews/InterviewHistoryList'

const statusOptions = [{ value: 'all', label: 'All practices' }, { value: 'active', label: 'In progress' }, { value: 'ended', label: 'Ended' }]
const sortOptions: { value: SortField; label: string }[] = [{ value: 'date', label: 'Date' }, { value: 'name', label: 'Track' }, { value: 'status', label: 'Status' }]

export function InterviewHistory() {
  const [runs, setRuns] = useState<Practice[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [search, setSearch] = useState(''); const [status, setStatus] = useState('all')
  const [sortField, setSortField] = useState<SortField>('date'); const [sortDir, setSortDir] = useState<SortDir>('desc')
  const load = useCallback((signal?: AbortSignal) => {
    setState('loading')
    apiClient<{ runs: Practice[] }>(`${INTERVIEWS_API}/runs`, { signal })
      .then(result => { setRuns(result.runs); setState('ready') })
      .catch(() => { if (!signal?.aborted) setState('error') })
  }, [])
  useEffect(() => { const abort = new AbortController(); load(abort.signal); return () => abort.abort() }, [load])
  const visible = useMemo(() => filterPractices(runs, search, status, sortField, sortDir), [runs, search, status, sortField, sortDir])
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
    {state === 'ready' && runs.length === 0 && <Card><CardContent className="space-y-3 py-16 text-center">
      <h2 className="text-lg font-medium">No interview practices yet</h2>
      <p className="text-sm text-muted-foreground">Practices you start appear here with their answered and skipped questions.</p>
      <Button asChild><Link to="/interviews">Start a practice</Link></Button>
    </CardContent></Card>}
    {state === 'ready' && runs.length > 0 && <>
      <SessionFilters search={search} onSearchChange={setSearch} searchPlaceholder="Search by track, difficulty or experience…"
        sortField={sortField} sortDir={sortDir} onSortChange={(field, dir) => { setSortField(field); setSortDir(dir) }} sortOptions={sortOptions}
        statusFilter={status} onStatusFilterChange={setStatus} statusOptions={statusOptions} totalCount={runs.length} filteredCount={visible.length} />
      <AutoCompleteNotice scope="interview" count={runs.filter(r => !r.endedAt).length} />
      {visible.length === 0 ? <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No practices match these filters.</CardContent></Card>
        : <InterviewHistoryList runs={visible} onRetain={(run, result) => setRuns(rows => applyRetain(rows, run, result))} />}
    </>}
  </div>
}
