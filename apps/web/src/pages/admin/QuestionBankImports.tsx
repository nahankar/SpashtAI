import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API, bankFile, downloadBankFile, type BatchDetail, type BatchSummary } from '@/lib/interview-bank'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
interface Inspection { headers: string[]; rowCount: number; defaultColumns: Record<string, string>; fields: string[] }
export function QuestionBankImports() {
  const [file, setFile] = useState<File | null>(null); const [inspection, setInspection] = useState<Inspection | null>(null)
  const [mapping, setMapping] = useState<Record<string, string>>({}); const [namespace, setNamespace] = useState('automation-pilot'); const [mode, setMode] = useState('ADD_ONLY')
  const [history, setHistory] = useState<BatchSummary[]>([]); const [batch, setBatch] = useState<BatchDetail | null>(null)
  const [page, setPage] = useState(1); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [progress, setProgress] = useState('')
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    void apiClient<{ batches: BatchSummary[] }>(`${BANK_API}/imports`, { signal: controller.signal }).then(d => { if (!controller.signal.aborted) setHistory(d.batches) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [])
  async function task(fn: (signal: AbortSignal) => Promise<void>) {
    const signal = lifetime.current!.signal; setBusy(true); setError('')
    try { await fn(signal) } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Request failed') } finally { if (!signal.aborted) setBusy(false) }
  }
  async function loadBatch(id: string, targetPage: number, signal: AbortSignal) {
    const data = await apiClient<BatchDetail>(`${BANK_API}/imports/${id}?page=${targetPage}`, { signal }); if (!signal.aborted) { setBatch(data); setPage(targetPage) }
  }
  function inspect() { void task(async signal => {
    if (!file) throw new Error('Choose a UTF-8 CSV file first')
    const form = new FormData(); form.append('file', file)
    const data = await bankFile<Inspection>('/imports/inspect', form, signal)
    if (signal.aborted) return
    setInspection(data); setMapping(Object.fromEntries(data.fields.map(f => [f, data.headers.includes(data.defaultColumns[f]) ? data.defaultColumns[f] : ''])))
  }) }
  function previewImport() { void task(async signal => {
    const form = new FormData(); form.append('file', file!); form.append('options', JSON.stringify({ namespace, mode, mapping }))
    const result = await bankFile<{ id: string }>('/imports/preview', form, signal); await loadBatch(result.id, 1, signal)
    const data = await apiClient<{ batches: BatchSummary[] }>(`${BANK_API}/imports`, { signal }); if (!signal.aborted) setHistory(data.batches)
  }) }
  function confirm() { void task(async signal => {
    const id = batch!.batch.id; let remaining = 1
    while (remaining && !signal.aborted) {
      // One bounded chunk at a time. Closing the screen cancels further requests;
      // already committed rows remain resumable from import history.
      const result = await apiClient<{ remaining: number }>(`${BANK_API}/imports/${id}/confirm`, { method: 'POST', body: '{}', signal })
      remaining = result.remaining; if (!signal.aborted) setProgress(remaining ? `${remaining} rows left. You can return and resume if interrupted.` : 'Import complete. All created versions are drafts.')
    }
    if (!signal.aborted) { await loadBatch(id, page, signal); const data = await apiClient<{ batches: BatchSummary[] }>(`${BANK_API}/imports`, { signal }); setHistory(data.batches) }
  }) }
  const totalRows = batch ? Object.values(batch.counts).reduce((a, b) => a + b, 0) : 0
  return <div className="max-w-5xl space-y-6"><Link className="text-sm underline" to="/admin/interview-bank">Back to question bank</Link>
    <div><h1 className="text-2xl font-semibold">Import question drafts</h1><p className="text-muted-foreground mt-2">Save the workbook question sheet as UTF-8 CSV. Limit: 5 MB and 10,000 rows. Original file bytes are discarded; the file hash and row records are kept for review.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <section className="border rounded-xl p-5 space-y-4"><h2 className="font-semibold">1. Choose and inspect a file</h2>
      <input aria-label="Question CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { setFile(e.target.files?.[0] ?? null); setInspection(null); setBatch(null); setProgress('') }} />
      <div className="flex flex-wrap gap-3"><Button disabled={busy || !file} onClick={inspect}>Inspect columns</Button><Button variant="outline" disabled={busy} onClick={() => void task(async () => { await downloadBankFile('/imports/template', 'question-bank-template.csv') })}>Download template</Button></div>
    </section>
    {inspection && <section className="border rounded-xl p-5 space-y-4"><h2 className="font-semibold">2. Map columns · {inspection.rowCount} rows</h2>
      <div className="grid sm:grid-cols-2 gap-4"><label className="text-sm space-y-1 block">Namespace<Input disabled={busy} value={namespace} onChange={e => setNamespace(e.target.value)} /></label><label className="text-sm space-y-1 block">Import mode<select className="w-full border rounded-md bg-background p-2" disabled={busy} value={mode} onChange={e => setMode(e.target.value)}><option value="ADD_ONLY">Add new QIDs only</option><option value="UPDATE_BY_QID">Create a new draft for changed QIDs</option></select></label></div>
      <p className="text-sm text-muted-foreground">Updates preserve published versions. Unknown values stay unassigned; imported answers remain private reference material.</p>
      <div className="grid sm:grid-cols-2 gap-3">{inspection.fields.map(field => <label key={field} className="text-sm space-y-1 block">{inspection.defaultColumns[field]}{['externalQid','questionText'].includes(field) && ' (required)'}<select disabled={busy} className="w-full border rounded-md bg-background p-2" value={mapping[field] ?? ''} onChange={e => setMapping(m => ({ ...m, [field]: e.target.value }))}><option value="">Not mapped</option>{inspection.headers.map(h => <option key={h}>{h}</option>)}</select></label>)}</div>
      <Button disabled={busy || !mapping.externalQid || !mapping.questionText} onClick={previewImport}>Validate and preview rows</Button>
    </section>}
    {batch && <section className="border rounded-xl p-5 space-y-4"><h2 className="font-semibold">3. Review rows · {batch.batch.status}</h2><p className="text-sm">{totalRows} rows · {Object.entries(batch.counts).map(([s,c]) => `${c} ${s.toLowerCase()}`).join(' · ')}</p>
      <p className="text-sm text-muted-foreground">Rows with errors are skipped. Warnings require editorial review before publication.</p>
      <div className="flex flex-wrap gap-3"><Button disabled={busy || !batch.counts.READY} onClick={confirm}>{batch.batch.status === 'IMPORTING' ? 'Resume import' : 'Confirm valid rows as drafts'}</Button><Button variant="outline" disabled={busy} onClick={() => void task(async () => { await downloadBankFile(`/imports/${batch.batch.id}/report`, 'question-import-report.csv') })}>Download row report</Button></div>
      {progress && <p role="status" className="text-sm">{progress}</p>}
      <div className="space-y-2">{batch.rows.map(row => <div key={row.id} className="border rounded-lg p-3 text-sm"><p className="font-medium">Row {row.rowNumber} · {row.normalized.externalQid || 'Missing QID'} · {row.status}</p>{row.outcome && <p>{row.outcome}</p>}{row.errors.map(e => <p className="text-destructive" key={e}>{e}</p>)}{row.warnings.map(w => <p className="text-muted-foreground" key={w}>{w}</p>)}</div>)}</div>
      <div className="flex gap-3 items-center"><Button variant="outline" disabled={busy || page === 1} onClick={() => void task(s => loadBatch(batch.batch.id, page - 1, s))}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={busy || page * 50 >= totalRows} onClick={() => void task(s => loadBatch(batch.batch.id, page + 1, s))}>Next</Button></div>
    </section>}
    <section className="space-y-3"><h2 className="font-semibold">Recent imports</h2>{history.map(b => <button key={b.id} disabled={busy} onClick={() => { setProgress(''); void task(s => loadBatch(b.id, 1, s)) }} className="w-full text-left border rounded-lg p-3 hover:bg-accent"><span className="font-medium">{b.namespace} · {b.status}</span><span className="text-xs text-muted-foreground block mt-1">{new Date(b.createdAt).toLocaleString()} · {b.mode} · Hash {b.fileHash.slice(0,12)}</span></button>)}{!history.length && <p className="text-sm text-muted-foreground">No imports yet.</p>}</section>
  </div>
}
