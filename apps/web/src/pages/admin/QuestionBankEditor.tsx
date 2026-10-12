import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API, bankWrite, bankStatus, emptyDraft, type BankDraft, type BankDetail, type BankPreview, type BankAction } from '@/lib/interview-bank'
import { Button } from '@/components/ui/button'
import { QuestionBankPreview } from '@/components/admin/QuestionBankPreview'
import { BankProvenanceConfirmation } from '@/components/admin/BankProvenanceConfirmation'
const control = 'w-full rounded-md border bg-background px-3 py-2 text-sm'
const lines = (value: string) => value.split('\n')
function TextField({ label, value, onChange, multiline = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean }) {
  return <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span>{multiline ? <textarea rows={4} className={control} value={value} onChange={e => onChange(e.target.value)} /> : <input className={control} value={value} onChange={e => onChange(e.target.value)} />}</label>
}
export function QuestionBankEditor() {
  const { id } = useParams(); const navigate = useNavigate()
  const [data, setData] = useState<BankDetail | null>(null); const [draft, setDraft] = useState<BankDraft>(emptyDraft)
  const [identity, setIdentity] = useState({ namespace: 'automation-pilot', externalQid: '' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(Boolean(id))
  const [preview, setPreview] = useState<BankPreview | null>(null); const [deleting, setDeleting] = useState(false)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setBusy(false); setData(null); setPreview(null); setDeleting(false); setError(''); setLoading(Boolean(id)); setDraft(emptyDraft())
    if (id) void apiClient<BankDetail>(`${BANK_API}/questions/${id}`, { signal: controller.signal }).then(v => { if (!controller.signal.aborted) { setData(v); setDraft(v.draft) } }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  const dirty = !data || JSON.stringify(draft) !== JSON.stringify(data.draft)
  async function confirmProvenance(note: string) {
    const signal = lifetime.current!.signal; setBusy(true); setError('')
    try {
      await bankWrite('/questions/provenance', { confirmed: true, note, questions: [{ id, revision: data!.question.revision }] }, 'POST', signal)
      const result = await apiClient<BankDetail>(`${BANK_API}/questions/${id}`, { signal })
      if (!signal.aborted) { setData(result); setDraft(result.draft) }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Confirmation failed') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  function change<K extends keyof BankDraft>(key: K, value: BankDraft[K]) { setDraft(d => ({ ...d, [key]: value })); setPreview(null) }
  async function act(action: 'save' | 'preview' | BankAction) {
    const signal = lifetime.current!.signal; setBusy(true); setError('')
    try {
      if (action === 'preview' && id) {
        const result = await apiClient<BankPreview>(`${BANK_API}/questions/${id}/learner-preview`, { signal }); if (!signal.aborted) setPreview(result)
      } else if (action === 'delete') {
        await bankWrite(`/questions/${id}`, { revision: data!.question.revision }, 'DELETE', signal)
        if (!signal.aborted) navigate('/admin/interview-bank')
      } else {
        const clean = (values: string[]) => values.map(v => v.trim()).filter(Boolean)
        const savedDraft = { ...draft, tags: clean(draft.tags), referenceSources: clean(draft.referenceSources) }
        const result = action === 'save' ? await bankWrite<BankDetail>(id ? `/questions/${id}` : '/questions', id ? { revision: data!.question.revision, draft: savedDraft } : { identity, draft: savedDraft }, id ? 'PUT' : 'POST', signal)
          : await bankWrite<BankDetail>(`/questions/${id}/${action}`, { revision: data!.question.revision }, 'POST', signal)
        if (signal.aborted) return
        setData(result); setDraft(result.draft); setPreview(null)
        if (result.question.id !== id) navigate(`/admin/interview-bank/questions/${result.question.id}`)
      }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Request failed') } finally { if (!signal.aborted) setBusy(false) }
  }
  const select = (key: keyof BankDraft, label: string, values: string[]) => <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span><select className={control} value={String(draft[key])} onChange={e => change(key, e.target.value)}>{values.map(v => <option key={v}>{v}</option>)}</select></label>
  if (loading) return <p role="status">Loading question…</p>
  if (id && !data) return <div><Link to="/admin/interview-bank">Back to bank</Link><p role="alert" className="text-destructive mt-4">{error}</p></div>
  return <div className="max-w-4xl space-y-6">
    <Link className="text-sm underline" to="/admin/interview-bank">Back to question bank</Link>
    <div><h1 className="text-2xl font-semibold">{data ? data.question.externalQid : 'Write an interview question'}</h1><p className="text-muted-foreground mt-2">{data ? bankStatus(data.question) : 'New draft'} · One editable question. Content changes clear approval and deactivate it. Review-note-only edits preserve its status.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <fieldset disabled={busy} className="space-y-6">
      {!id && <div className="grid sm:grid-cols-2 gap-4"><TextField label="Namespace" value={identity.namespace} onChange={namespace => setIdentity(i => ({ ...i, namespace }))} /><TextField label="QID" value={identity.externalQid} onChange={externalQid => setIdentity(i => ({ ...i, externalQid }))} /></div>}
      <section className="rounded-xl border p-5 space-y-4"><h2 className="text-lg font-semibold">Question</h2><TextField label="Question" multiline value={draft.questionText} onChange={v => change('questionText', v)} />
        <div className="grid sm:grid-cols-2 gap-4"><TextField label="Track" value={draft.track} onChange={v => change('track', v)} /><TextField label="Topic" value={draft.topic} onChange={v => change('topic', v)} />{select('difficulty','Difficulty',['Simple','Medium','Complex','Very Complex'])}{select('experienceBand','Experience band',['0-2','2-5','5-8','8+'])}</div>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={draft.verbalSuitable} onChange={e => change('verbalSuitable', e.target.checked)} />Suitable for spoken practice</label>
      </section>
      <section className="rounded-xl border p-5 space-y-4"><h2 className="text-lg font-semibold">Answer and learning content</h2>
        <TextField label="What a good answer should cover" multiline value={draft.goodAnswerPoints} onChange={v => change('goodAnswerPoints', v)} />
        <TextField label="Example answer" multiline value={draft.exampleAnswer} onChange={v => change('exampleAnswer', v)} />
        <TextField label="Explanation" multiline value={draft.explanation} onChange={v => change('explanation', v)} />
        <TextField label="Follow-up guidance" multiline value={draft.followUpGuidance} onChange={v => change('followUpGuidance', v)} />
      </section>
      <details className="rounded-xl border p-5"><summary className="font-medium cursor-pointer">More details</summary><div className="space-y-4 mt-4">
        <div className="grid sm:grid-cols-2 gap-4"><TextField label="Category" value={draft.category} onChange={v => change('category', v)} /><TextField label="Question type" value={draft.questionType} onChange={v => change('questionType', v)} /><TextField label="Role archetype" value={draft.roleArchetype} onChange={v => change('roleArchetype', v)} />{select('frequency','Frequency',['Foundational','Core','Occasional','Niche'])}</div>
        <TextField label="Expected answer depth" multiline value={draft.expectedDepth} onChange={v => change('expectedDepth', v)} />
        <TextField label="Tags (one per line)" multiline value={draft.tags.join('\n')} onChange={v => change('tags', lines(v))} />
        <TextField label="Reference sources (one per line)" multiline value={draft.referenceSources.join('\n')} onChange={v => change('referenceSources', lines(v))} />
        <TextField label="Review notes" multiline value={draft.reviewNotes} onChange={v => change('reviewNotes', v)} />
        <TextField label="Generation or provenance notes" multiline value={draft.generationNotes} onChange={v => change('generationNotes', v)} />
        <TextField label="Trend note" multiline value={draft.trendNote} onChange={v => change('trendNote', v)} />
      </div></details>
    </fieldset>
    {data?.question.sourceAnswer && <details className="border rounded-xl p-4"><summary className="cursor-pointer font-medium">Imported reference answer · Admin only</summary><p className="mt-3 whitespace-pre-wrap text-sm">{data.question.sourceAnswer}</p></details>}
    {data && (data.question.provenanceConfirmedAt ? <div className="rounded-xl border p-4 space-y-2"><p className="font-medium">Learning content provenance confirmed</p><p className="text-sm whitespace-pre-wrap">{data.question.provenanceNote}</p><p className="text-xs text-muted-foreground">Content changes require confirmation again.</p></div> : <BankProvenanceConfirmation key={`${id}:${data.question.revision}`} count={1} disabled={busy || dirty} onConfirm={confirmProvenance} />)}
    {data && !data.canActivate && <p className="text-sm text-muted-foreground">Super Admin access is required to activate this question.</p>}
    {data && data.blockers.length > 0 && <p className="text-sm text-muted-foreground">Before activating{dirty ? ' (last saved content)' : ''}: {data.blockers.join(' · ')}</p>}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy || !dirty} onClick={() => void act('save')}>Save question</Button>
      {data && <><Button variant="outline" disabled={busy || dirty} onClick={() => void act('preview')}>Learner preview</Button>
        <Button variant="outline" disabled={busy || dirty} onClick={() => navigate(`/admin/interview-bank/questions/${id}/test`)}>Test answer</Button>
        {!data.question.approved && <Button variant="outline" disabled={busy || dirty} onClick={() => void act('approve')}>Approve</Button>}
        {!data.question.active && <Button disabled={busy || dirty || !!data.blockers.length || !data.canActivate} onClick={() => void act(data.question.approved ? 'activate' : 'approve_activate')}>{data.question.approved ? 'Activate' : 'Approve and activate'}</Button>}
        {data.question.active && <Button variant="outline" disabled={busy || dirty} onClick={() => void act('deactivate')}>Deactivate</Button>}
        <Button variant="destructive" disabled={busy} onClick={() => setDeleting(true)}>Delete question</Button></>}
    </div>
    {deleting && <div role="alertdialog" aria-label="Delete question confirmation" className="rounded-xl border p-5 space-y-3"><p>Delete {data?.question.externalQid}? This permanently removes its current content.</p><div className="flex gap-3"><Button variant="destructive" disabled={busy} onClick={() => void act('delete')}>Confirm delete</Button><Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>Cancel</Button></div></div>}
    {preview && <QuestionBankPreview data={preview} />}
  </div>
}
