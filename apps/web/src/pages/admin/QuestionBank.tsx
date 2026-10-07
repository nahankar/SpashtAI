import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API } from '@/lib/interview-bank'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
interface Listing { versions: { id: string; version: number; status: string; questionText: string; track: string | null; difficulty: string | null; question: { externalQid: string; namespace: string } }[]; total: number }
export function QuestionBank() {
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const [data, setData] = useState<Listing | null>(null); const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setData(null); setError('')
    const query = new URLSearchParams({ page: String(page), search }); if (status) query.set('status', status)
    void apiClient<Listing>(`${BANK_API}/questions?${query}`, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setData(d) }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => controller.abort()
  }, [search, status, page])
  return <div className="space-y-6 max-w-5xl">
    <div><h1 className="text-2xl font-semibold">Interview question bank</h1><p className="text-muted-foreground mt-2">Prepare and review content for the Automation Testing pilot. Importing creates private drafts; publishing requires content rights and a complete rubric.</p></div>
    <div className="flex flex-wrap gap-3"><Button asChild><Link to="/admin/interview-bank/new">Write a question</Link></Button><Button variant="outline" asChild><Link to="/admin/interview-bank/imports">Import CSV</Link></Button></div>
    <div className="flex flex-wrap gap-3"><Input className="max-w-sm" aria-label="Search question or QID" placeholder="Search question or QID" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
      <select className="rounded-md border bg-background p-2" aria-label="Filter question status" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{['DRAFT','REVIEWED','PUBLISHED','RETIRED'].map(s => <option key={s}>{s}</option>)}</select></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!data && !error && <p role="status">Loading questions…</p>}
    {data && <><p className="text-sm text-muted-foreground">{data.total} question versions</p><div className="space-y-3">{data.versions.map(v => <Link key={v.id} to={`/admin/interview-bank/versions/${v.id}`} className="block rounded-xl border p-4 hover:bg-accent focus-visible:ring-2">
      <div className="text-xs text-muted-foreground">{v.question.namespace} / {v.question.externalQid} · Version {v.version} · {v.status}</div><h2 className="font-medium mt-2">{v.questionText}</h2><p className="text-sm text-muted-foreground mt-1">{v.track || 'Track needs review'} · {v.difficulty || 'Difficulty needs review'}</p></Link>)}{!data.total && <p>No questions yet. Write one or import a CSV to begin.</p>}</div>
      <div className="flex items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={page * 30 >= data.total} onClick={() => setPage(p => p + 1)}>Next</Button></div></>}
  </div>
}
