import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API, bankWrite, bankStatus, type BankAction, type BankQuestion } from '@/lib/interview-bank'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BankProvenanceConfirmation } from '@/components/admin/BankProvenanceConfirmation'
interface Listing { questions: BankQuestion[]; total: number; canActivate: boolean }
export function QuestionBank() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const [difficulty, setDifficulty] = useState(''); const [category, setCategory] = useState(''); const [categories, setCategories] = useState<string[]>([])
  const [track, setTrack] = useState(''); const [tracks, setTracks] = useState<string[]>([]); const [loadingFilters, setLoadingFilters] = useState(true)
  const [data, setData] = useState<Listing | null>(null); const [error, setError] = useState(''); const [message, setMessage] = useState('')
  const [selected, setSelected] = useState<Record<string,number>>({}); const [busy, setBusy] = useState(false); const [deleting, setDeleting] = useState(false); const [reload, setReload] = useState(0)
  const lifetime = useRef<AbortController | null>(null)
  const [confirmingProvenance, setConfirmingProvenance] = useState(false)
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [])
  useEffect(() => { setSelected({}); setDeleting(false); setConfirmingProvenance(false); setMessage('') }, [search, status, difficulty, category, track])
  useEffect(() => {
    const controller = new AbortController(); setLoadingFilters(true)
    const query = new URLSearchParams(); if (track) query.set('track', track)
    void apiClient<{ categories: string[]; tracks: string[] }>(`${BANK_API}/filters?${query}`, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) { setCategories(d.categories); setTracks(d.tracks) } }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoadingFilters(false) })
    return () => controller.abort()
  }, [track, reload])
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('')
    const query = new URLSearchParams({ page: String(page), search }); if (status) query.set('status', status)
    if (difficulty) query.set('difficulty', difficulty); if (category) query.set('category', category)
    if (track) query.set('track', track)
    void apiClient<Listing>(`${BANK_API}/questions?${query}`, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setData(d) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [search, status, difficulty, category, track, page, reload])
  const count = Object.keys(selected).length
  async function confirmProvenance(note: string) {
    const signal = lifetime.current!.signal; setBusy(true); setError('')
    try {
      const result = await bankWrite<{ changed: number }>('/questions/provenance', { confirmed: true, note, questions: Object.entries(selected).map(([id, revision]) => ({ id, revision })) }, 'POST', signal)
      if (!signal.aborted) { setMessage(`Provenance confirmed for ${result.changed} questions. Approval and activation are preserved.`); setSelected({}); setConfirmingProvenance(false); setReload(v => v+1) }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Confirmation failed') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  async function action(action: BankAction) {
    const signal = lifetime.current!.signal; setBusy(true); setError(''); setMessage('')
    try {
      const result = await bankWrite<{ changed: number }>('/questions/bulk', { action, questions: Object.entries(selected).map(([id,revision]) => ({ id, revision })) }, 'POST', signal)
      if (!signal.aborted) { setMessage(`${result.changed} question${result.changed === 1 ? '' : 's'} ${action === 'delete' ? 'deleted' : action === 'approve' ? 'approved' : action === 'deactivate' ? 'deactivated' : action === 'activate' ? 'activated' : 'approved and activated'}.`); setSelected({}); setDeleting(false); setPage(1); setReload(v => v+1) }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Request failed') } finally { if (!signal.aborted) setBusy(false) }
  }
  async function selectAllMatching() {
    const signal = lifetime.current!.signal; setBusy(true); setError('')
    try {
      const result = await bankWrite<{ questions: { id: string; revision: number }[] }>('/questions/selection', { search, ...(status ? { status } : {}), ...(difficulty ? { difficulty } : {}), ...(category ? { category } : {}), ...(track ? { track } : {}) }, 'POST', signal)
      if (!signal.aborted) setSelected(Object.fromEntries(result.questions.map(q => [q.id,q.revision])))
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Selection failed') } finally { if (!signal.aborted) setBusy(false) }
  }
  const pageSelected = !!data?.questions.length && data.questions.every(q => selected[q.id] !== undefined)
  return <div className="space-y-6 max-w-5xl">
    <div><h1 className="text-2xl font-semibold">Interview question bank</h1><p className="text-muted-foreground mt-2">One editable copy of each question. Approve content, then activate it for practice. Imported and generated questions start as inactive drafts.</p></div>
    <div className="flex flex-wrap gap-3"><Button asChild><Link to="/admin/interview-bank/new">Write a question</Link></Button><Button variant="outline" asChild><Link to="/admin/interview-bank/imports">Import CSV</Link></Button></div>
    <div className="flex flex-wrap gap-3"><Input disabled={busy} className="max-w-sm" aria-label="Search question or QID" placeholder="Search question or QID" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      <select disabled={busy} className="rounded-md border bg-background p-2" aria-label="Filter question status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All questions</option><option value="DRAFT">Draft</option><option value="APPROVED">Approved · inactive</option><option value="ACTIVE">Active</option><option value="INACTIVE">All inactive</option></select>
      <label className="text-sm flex items-center gap-2">Track<select disabled={busy || !tracks.length} className="rounded-md border bg-background p-2 max-w-full sm:max-w-xs" value={track} onChange={e => { setTrack(e.target.value); setCategory(''); setCategories([]); setPage(1) }}><option value="">All tracks</option>{tracks.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="text-sm flex items-center gap-2">Complexity<select disabled={busy} className="rounded-md border bg-background p-2" value={difficulty} onChange={e => { setDifficulty(e.target.value); setPage(1) }}><option value="">All complexities</option>{['Simple','Medium','Complex','Very Complex'].map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="text-sm flex items-center gap-2">Category<select disabled={busy || loadingFilters} className="rounded-md border bg-background p-2 max-w-full sm:max-w-xs" value={category} onChange={e => { setCategory(e.target.value); setPage(1) }}><option value="">All categories</option>{categories.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      {(search || status || difficulty || category || track) && <Button variant="outline" disabled={busy} onClick={() => { setSearch(''); setStatus(''); setDifficulty(''); setCategory(''); setTrack(''); setPage(1) }}>Clear filters</Button>}
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}{message && <p role="status">{message}</p>}
    {!data && !error && <p role="status">Loading questions…</p>}
    {data && <><div className="flex gap-4 items-center flex-wrap"><p className="text-sm text-muted-foreground">{data.total} question{data.total === 1 ? '' : 's'} · {count} selected</p>
      <label className="text-sm flex gap-2 items-center"><input type="checkbox" disabled={busy || !data.questions.length} checked={pageSelected} onChange={e => { const checked = e.target.checked; setSelected(previous => { const next = { ...previous }; for (const q of data.questions) { if (checked) next[q.id]=q.revision; else delete next[q.id] } return next }) }} />Select this page</label>
      {data.total > 30 && <Button variant="outline" disabled={busy} onClick={() => void selectAllMatching()}>Select all {data.total} matching questions</Button>}
      {count > 0 && <Button variant="outline" disabled={busy} onClick={() => { setSelected({}); setDeleting(false) }}>Clear selection</Button>}
    </div>
    {count > 0 && <div className="flex flex-wrap gap-2">{(['approve','approve_activate','activate','deactivate'] as const).map(actionName => <Button key={actionName} variant="outline" disabled={busy || (['activate','approve_activate'].includes(actionName) && !data.canActivate)} onClick={() => void action(actionName)}>{{ approve:'Approve', approve_activate:'Approve and activate', activate:'Activate', deactivate:'Deactivate' }[actionName]} selected</Button>)}<Button variant="outline" disabled={busy} onClick={() => setConfirmingProvenance(true)}>Confirm provenance for selected</Button><Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>Delete selected</Button></div>}
    {!data.canActivate && <p className="text-sm text-muted-foreground">Super Admin access is required to activate questions. You can edit, approve and confirm provenance.</p>}
    {confirmingProvenance && count > 0 && <BankProvenanceConfirmation key={Object.keys(selected).sort().join(',')} count={count} disabled={busy} onConfirm={confirmProvenance} onCancel={() => setConfirmingProvenance(false)} />}
    {deleting && <div role="alertdialog" aria-label="Bulk deletion confirmation" className="rounded-xl border p-5 space-y-3"><p>Permanently delete {count} selected questions? Their current content will be removed.</p><div className="flex gap-3"><Button variant="destructive" disabled={busy || !count} onClick={() => void action('delete')}>Confirm delete {count} questions</Button><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>Cancel</Button></div></div>}
    <div className="space-y-3">{data.questions.map(q => <div key={q.id} className="rounded-xl border p-4 flex items-start gap-3">
      <input className="mt-1" type="checkbox" aria-label={`Select ${q.externalQid}`} disabled={busy} checked={selected[q.id] !== undefined} onChange={e => { const checked=e.target.checked; setSelected(previous => { const next={ ...previous }; if (checked) next[q.id]=q.revision; else delete next[q.id]; return next }) }} />
      <Link to={`/admin/interview-bank/questions/${q.id}`} className="flex-1 hover:underline focus-visible:ring-2"><div className="text-xs text-muted-foreground">{q.namespace} / {q.externalQid} · {bankStatus(q)}{q.origin === 'GENERATED_FOLLOW_UP' ? ' · Generated follow-up' : ''}</div><h2 className="font-medium mt-2">{q.questionText}</h2><p className="text-sm text-muted-foreground mt-1">{q.track} · {q.category} · {q.difficulty} · {q.provenanceConfirmedAt ? 'Provenance confirmed' : 'Provenance needed for learner practice'}</p></Link>
    </div>)}{!data.total && <p>{search || status || difficulty || category || track ? 'No questions match these filters. Clear or change a filter to see more.' : 'No questions yet. Write one or import a CSV to begin.'}</p>}</div>
    <div className="flex items-center gap-3"><Button variant="outline" disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={busy || page * 30 >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div></>}
  </div>
}
