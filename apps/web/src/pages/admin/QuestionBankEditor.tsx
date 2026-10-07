import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API, bankWrite, emptyDraft, type BankDraft, type BankDetail, type BankPreview } from '@/lib/interview-bank'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { QuestionBankPreview } from '@/components/admin/QuestionBankPreview'
const control = 'w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60'
const list = (text: string) => text.split('\n')
function TextField({ label, value, onChange, multiline = false, disabled = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; disabled?: boolean }) {
  return <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span>{multiline ? <textarea rows={4} className={control} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} /> : <input className={control} value={value} disabled={disabled} onChange={e => onChange(e.target.value)} />}</label>
}
export function QuestionBankEditor() {
  const { id } = useParams(); const navigate = useNavigate(); const { user } = useAuth()
  const [data, setData] = useState<BankDetail | null>(null); const [draft, setDraft] = useState<BankDraft>(emptyDraft)
  const [identity, setIdentity] = useState({ namespace: 'automation-pilot', externalQid: '' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(Boolean(id))
  const [preview, setPreview] = useState<BankPreview | null>(null)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller; setBusy(false); setData(null); setPreview(null); setError(''); setLoading(Boolean(id)); setDraft(emptyDraft())
    if (id) void apiClient<BankDetail>(`${BANK_API}/versions/${id}`, { signal: controller.signal }).then(v => { setData(v); setDraft(v.draft) }).catch(e => { if (!controller.signal.aborted) setError(e.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [id])
  const editable = !data || ['DRAFT','REVIEWED'].includes(data.version.status)
  const dirty = !data || JSON.stringify(draft) !== JSON.stringify(data.draft)
  function change<K extends keyof BankDraft>(key: K, value: BankDraft[K]) { setDraft(d => ({ ...d, [key]: value })); setPreview(null) }
  async function act(action: 'save' | 'fork' | 'review' | 'publish' | 'retire' | 'preview') {
    const signal = lifetime.current!.signal
    setBusy(true); setError('')
    try {
      if (action === 'preview' && id) {
        const result = await apiClient<BankPreview>(`${BANK_API}/versions/${id}/learner-preview`, { signal })
        if (!signal.aborted) setPreview(result)
      }
      else {
        const clean = (values: string[]) => values.map(v => v.trim()).filter(Boolean)
        const savedDraft = { ...draft, tags: clean(draft.tags), referenceSources: clean(draft.referenceSources), rubric: draft.rubric && { ...draft.rubric, criteria: draft.rubric.criteria.map(c => ({ ...c, points: clean(c.points), alternatives: clean(c.alternatives), misconceptions: clean(c.misconceptions) })) } }
        const result = action === 'save' ? await bankWrite<BankDetail>(id ? `/versions/${id}` : '/questions', id ? { revision: data!.version.revision, draft: savedDraft } : { identity, draft: savedDraft }, id ? 'PUT' : 'POST', signal)
          : await bankWrite<BankDetail>(`/versions/${id}/${action}`, action === 'fork' ? {} : { revision: data!.version.revision }, 'POST', signal)
        if (signal.aborted) return
        setData(result); setDraft(result.draft); setPreview(null)
        if (result.version.id !== id) navigate(`/admin/interview-bank/versions/${result.version.id}`)
      }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Request failed') } finally { if (!signal.aborted) setBusy(false) }
  }
  const select = (key: keyof BankDraft, label: string, values: string[]) => <label className="block space-y-1 text-sm"><span className="font-medium">{label}</span><select disabled={!editable || busy} className={control} value={String(draft[key] ?? '')} onChange={e => change(key, e.target.value || null)}>{key !== 'rightsBasis' && <option value="">Needs review</option>}{values.map(v => <option key={v}>{v}</option>)}</select></label>
  function addCriterion() {
    let number = 1
    while (draft.publicCriteria.some(c => c.id === `criterion_${number}`)) number++
    const criterionId = `criterion_${number}`
    change('publicCriteria', [...draft.publicCriteria, { id: criterionId, label: '' }])
    change('rubric', { notes: draft.rubric?.notes ?? '', criteria: [...(draft.rubric?.criteria ?? []), { id: criterionId, essential: false, points: [], alternatives: [], misconceptions: [], anchors: ['', '', '', ''] }] })
  }
  if (loading) return <p role="status">Loading question…</p>
  if (id && !data) return <div><Link to="/admin/interview-bank">Back to bank</Link><p role="alert" className="text-destructive mt-4">{error}</p></div>
  return <div className="max-w-4xl space-y-6">
    <Link className="text-sm underline" to="/admin/interview-bank">Back to question bank</Link>
    <div><h1 className="text-2xl font-semibold">{data ? `${data.version.question.externalQid} · Version ${data.version.version}` : 'Write an interview question'}</h1><p className="text-muted-foreground mt-2">{data?.version.status ?? 'New draft'} · Changes to a reviewed draft require review again. Published content is preserved as a version.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <fieldset disabled={!editable || busy} className="space-y-6">
      {!id && <div className="grid sm:grid-cols-2 gap-4"><TextField label="Namespace" value={identity.namespace} onChange={namespace => setIdentity(i => ({ ...i, namespace }))} /><TextField label="QID" value={identity.externalQid} onChange={externalQid => setIdentity(i => ({ ...i, externalQid }))} /></div>}
      <section className="rounded-xl border p-5 space-y-4"><h2 className="text-lg font-semibold">Question and learning content</h2><TextField label="Question" multiline value={draft.questionText} onChange={v => change('questionText', v)} />
        <div className="grid sm:grid-cols-2 gap-4">{(['track','category','topic','questionType','roleArchetype'] as const).map(key => <TextField key={key} label={{ track: 'Track', category: 'Category', topic: 'Topic', questionType: 'Question type', roleArchetype: 'Role archetype' }[key]} value={draft[key] ?? ''} onChange={v => change(key, v || null)} />)}{select('difficulty','Difficulty',['Simple','Medium','Complex','Very Complex'])}{select('experienceBand','Experience band',['0-2','2-5','5-8','8+'])}{select('frequency','Frequency',['Foundational','Core','Occasional','Niche'])}{select('evaluationMode','Evaluation mode',['TECHNICAL','SCENARIO','BEHAVIORAL'])}</div>
        <label className="flex gap-2 items-center"><input type="checkbox" checked={draft.verbalSuitable} onChange={e => change('verbalSuitable', e.target.checked)} />Suitable for answering aloud</label>
        <TextField label="Expected answer depth" multiline value={draft.expectedDepth} onChange={v => change('expectedDepth', v)} />
        <TextField label="Learner explanation" multiline value={draft.explanation} onChange={v => change('explanation', v)} /><TextField label="Learner example answer" multiline value={draft.exampleAnswer} onChange={v => change('exampleAnswer', v)} />
        <TextField label="Tags (one per line)" multiline value={draft.tags.join('\n')} onChange={v => change('tags', list(v))} /><TextField label="Trend note" multiline value={draft.trendNote ?? ''} onChange={v => change('trendNote', v || null)} />
      </section>
      <section className="rounded-xl border p-5 space-y-4"><h2 className="text-lg font-semibold">Criteria and private evaluator rubric</h2><p className="text-sm text-muted-foreground">Learners see criterion labels. Answer points, alternatives, misconceptions and scoring anchors stay private. Write these independently; source answers are reference material.</p>
        {draft.publicCriteria.map((publicCriterion, index) => {
          const criterion = draft.rubric?.criteria.find(c => c.id === publicCriterion.id)
          return <div key={publicCriterion.id} className="rounded-lg bg-muted/30 border p-4 space-y-3">
            <TextField label={`Criterion ${index + 1}: learner label`} value={publicCriterion.label} onChange={v => change('publicCriteria', draft.publicCriteria.map(c => c.id === publicCriterion.id ? { ...c, label: v } : c))} />
            {criterion && <><label className="flex gap-2"><input type="checkbox" checked={criterion.essential} onChange={e => change('rubric', { ...draft.rubric!, criteria: draft.rubric!.criteria.map(c => c.id === criterion.id ? { ...c, essential: e.target.checked } : c) })} />Essential criterion</label>
              {(['points','alternatives','misconceptions'] as const).map(key => <TextField key={key} label={{ points: 'Required answer points (one per line)', alternatives: 'Accepted alternatives (one per line)', misconceptions: 'Misconceptions (one per line)' }[key]} multiline value={criterion[key].join('\n')} onChange={v => change('rubric', { ...draft.rubric!, criteria: draft.rubric!.criteria.map(c => c.id === criterion.id ? { ...c, [key]: list(v) } : c) })} />)}
              {['Not demonstrated','Partial','Meets expectations','Strong'].map((label, anchorIndex) => <TextField key={label} label={`Private anchor: ${label}`} value={criterion.anchors[anchorIndex]} onChange={v => change('rubric', { ...draft.rubric!, criteria: draft.rubric!.criteria.map(c => c.id === criterion.id ? { ...c, anchors: c.anchors.map((a, i) => i === anchorIndex ? v : a) } : c) })} />)}</>}
            <Button variant="outline" type="button" onClick={() => { change('publicCriteria', draft.publicCriteria.filter(c => c.id !== publicCriterion.id)); change('rubric', { ...draft.rubric!, criteria: draft.rubric!.criteria.filter(c => c.id !== publicCriterion.id) }) }}>Remove criterion</Button>
          </div>
        })}
        <Button variant="outline" type="button" disabled={draft.publicCriteria.length >= 20} onClick={addCriterion}>Add criterion</Button>
        {draft.rubric && <TextField label="Private scoring notes" multiline value={draft.rubric.notes} onChange={v => change('rubric', { ...draft.rubric!, notes: v })} />}
      </section>
      <section className="rounded-xl border p-5 space-y-4"><h2 className="text-lg font-semibold">Sources and content rights</h2><TextField label="References reviewed for accuracy (one per line)" multiline value={draft.referenceSources.join('\n')} onChange={v => change('referenceSources', list(v))} />
        {select('rightsBasis','Rights basis',['UNRECORDED','OWNED','LICENSED','REWRITTEN'])}<TextField label="Rights evidence or rewriting provenance" multiline value={draft.rightsNotes} onChange={v => change('rightsNotes', v)} />
        {draft.rightsBasis === 'REWRITTEN' && <><label className="flex gap-2"><input type="checkbox" checked={draft.learnerContentRewritten} onChange={e => change('learnerContentRewritten', e.target.checked)} />Question, explanation and example independently rewritten</label><label className="flex gap-2"><input type="checkbox" checked={draft.rubricIndependentlyAuthored} onChange={e => change('rubricIndependentlyAuthored', e.target.checked)} />Rubric independently authored without copying source text</label></>}
      </section>
    </fieldset>
    {data?.version.sourceAnswer && <details className="border rounded-xl p-4"><summary className="cursor-pointer font-medium">Imported reference material · Admin only</summary><p className="mt-3 whitespace-pre-wrap text-sm">{data.version.sourceQuestionText}</p><p className="mt-3 whitespace-pre-wrap text-sm">{data.version.sourceAnswer}</p></details>}
    {data && <div className="rounded-xl border p-5"><h2 className="font-semibold">Publication readiness {dirty && '(last saved version)'}</h2>{data.blockers.length ? <ul className="list-disc pl-5 mt-3 text-sm space-y-1">{data.blockers.map(b => <li key={b}>{b}</li>)}</ul> : <p className="text-sm mt-2">Content checks complete. Review accuracy and rights before publishing.</p>}</div>}
    <div className="flex flex-wrap gap-3">
      {editable && <Button disabled={busy || !dirty} onClick={() => void act('save')}>Save draft</Button>}
      {data && <><Button variant="outline" disabled={busy || dirty} onClick={() => void act('preview')}>Learner preview</Button>
        <Button variant="outline" disabled={busy || dirty} onClick={() => void act('fork')}>Create new version</Button>
        {data.version.status === 'DRAFT' && <Button variant="outline" disabled={busy || dirty || !!data.blockers.length} onClick={() => void act('review')}>Mark reviewed</Button>}
        {user?.role === 'SUPER_ADMIN' && data.version.status === 'REVIEWED' && <Button disabled={busy || dirty || !!data.blockers.length} onClick={() => void act('publish')}>Publish reviewed version</Button>}
        {user?.role === 'SUPER_ADMIN' && data.version.status === 'PUBLISHED' && <Button variant="outline" disabled={busy} onClick={() => void act('retire')}>Retire version</Button>}
        {user?.role !== 'SUPER_ADMIN' && <p className="text-sm text-muted-foreground self-center">Publishing and retirement require a Super Admin.</p>}</>}
    </div>
    {preview && <QuestionBankPreview data={preview} />}
  </div>
}
