import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { BANK_API, type BankDetail } from '@/lib/interview-bank'
import { EVALUATOR_API, isTestPending, labels, type Assessment, type EvaluatorConfig, type TestList } from '@/lib/interview-evaluator'
import { Button } from '@/components/ui/button'
import { InterviewEvaluationFeedback } from '@/components/admin/InterviewEvaluationFeedback'
const control = 'w-full rounded-md border bg-background px-3 py-2 text-sm'
export function InterviewEvaluator() {
  const { id } = useParams()
  const [bank, setBank] = useState<BankDetail | null>(null); const [config, setConfig] = useState<EvaluatorConfig | null>(null)
  const [answer, setAnswer] = useState(''); const [model, setModel] = useState('nova2_lite'); const [assistance, setAssistance] = useState('NONE')
  const [testId, setTestId] = useState<string | null>(null); const [test, setTest] = useState<Assessment | null>(null)
  const [history, setHistory] = useState<TestList['tests']>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false); const [reload, setReload] = useState(0)
  const lifetime = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setBank(null); setConfig(null); setTestId(null); setTest(null); setHistory([]); setError(''); setBusy(false); setDeleting(false); setAnswer('')
    void Promise.all([
      apiClient<BankDetail>(`${BANK_API}/questions/${id}`, { signal: controller.signal }),
      apiClient<EvaluatorConfig>(`${EVALUATOR_API}/config`, { signal: controller.signal }),
    ]).then(([b, c]) => { if (!controller.signal.aborted) { setBank(b); setConfig(c) } }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [id])
  useEffect(() => {
    const controller = new AbortController()
    void apiClient<TestList>(`${EVALUATOR_API}/tests?questionId=${encodeURIComponent(id ?? '')}`, { signal: controller.signal })
      .then(v => { if (!controller.signal.aborted) setHistory(v.tests) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [id, reload])
  useEffect(() => {
    if (!testId) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    setTest(null); setDeleting(false)
    const poll = async () => {
      try {
        const value = await apiClient<Assessment>(`${EVALUATOR_API}/tests/${testId}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setTest(value)
        setHistory(items => items.map(item => item.id === value.id ? { ...item, status: value.status } : item))
        if (isTestPending(value.status)) timer = setTimeout(() => void poll(), 2000)
        else {
          const refreshed = await apiClient<EvaluatorConfig>(`${EVALUATOR_API}/config`, { signal: controller.signal })
          if (!controller.signal.aborted) setConfig(refreshed)
        }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load test') }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [testId, reload])
  async function action(kind: 'submit' | 'retry' | 'delete') {
    const signal = lifetime.current!.signal; setError(''); setBusy(true)
    try {
      if (kind === 'delete') {
        await apiClient(`${EVALUATOR_API}/tests/${testId}`, { method: 'DELETE', signal })
        if (!signal.aborted) { setTestId(null); setTest(null); setDeleting(false) }
      } else {
        const saved = await apiClient<{ id: string }>(kind === 'submit' ? `${EVALUATOR_API}/tests` : `${EVALUATOR_API}/tests/${testId}/retry`, {
          method: 'POST', signal, body: JSON.stringify(kind === 'submit' ? { questionId: id, revision: bank!.question.revision, answer, model, assistance, source: 'ADMIN_TEST' } : {}),
        })
        if (!signal.aborted) setTestId(saved.id)
      }
      if (!signal.aborted) {
        setReload(v => v + 1)
        const nextConfig = await apiClient<EvaluatorConfig>(`${EVALUATOR_API}/config`, { signal })
        if (!signal.aborted) setConfig(nextConfig)
      }
    } catch (e) { if (!signal.aborted) setError(e instanceof Error ? e.message : 'Test request failed') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <div className="max-w-4xl space-y-6">
    <Link className="text-sm underline" to={`/admin/interview-bank/questions/${id}`}>Back to question</Link>
    <div><h1 className="text-2xl font-semibold">Test an interview answer</h1><p className="text-muted-foreground mt-2">Admin pilot · Sample answers only. Results are experimental and remain outside Progress Pulse.</p></div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!bank && !error && <p role="status">Loading question…</p>}
    {config && !config.accessible && <div className="rounded-xl border p-5 space-y-2"><p>Interview evaluator pilot access is off for your account.</p><p className="text-sm text-muted-foreground">In Feature Flags, show and enable “Interview evaluator · Admin pilot”, then add your account under Selected users.</p><Link className="underline" to="/admin/features">Open Feature Flags</Link><Button className="ml-3" variant="outline" onClick={() => { const signal = lifetime.current!.signal; void apiClient<EvaluatorConfig>(`${EVALUATOR_API}/config`, { signal }).then(v => { if (!signal.aborted) setConfig(v) }).catch(e => { if (!signal.aborted) setError(e.message) }) }}>Check access again</Button></div>}
    {bank && <section className="rounded-xl border p-5 space-y-3"><p className="text-sm text-muted-foreground">{bank.question.externalQid} · {bank.draft.track} · {bank.draft.difficulty}</p><h2 className="text-lg font-medium">{bank.draft.questionText}</h2>
      <fieldset disabled={busy || !config?.accessible} className="space-y-4">
        <label className="block space-y-1 text-sm"><span className="font-medium">Sample answer</span><textarea className={control} rows={6} maxLength={8000} value={answer} onChange={e => setAnswer(e.target.value)} placeholder="Enter a synthetic answer to check the evaluator…" /></label>
        <div className="grid sm:grid-cols-2 gap-4"><label className="block space-y-1 text-sm">Evaluator model<select className={control} value={model} onChange={e => setModel(e.target.value)}>{config?.models.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
          <label className="block space-y-1 text-sm">Help received before answering<select className={control} value={assistance} onChange={e => setAssistance(e.target.value)}><option value="NONE">None</option><option value="HINT">Hint</option><option value="EXAMPLE">Saw the example answer</option></select></label></div>
        <Button disabled={!answer.trim() || !config?.accessible || busy} onClick={() => void action('submit')}>{busy ? 'Saving…' : 'Evaluate answer'}</Button>
      </fieldset>
      {config && <p className="text-xs text-muted-foreground">{config.usedToday}/{config.limits.dailyPerAdmin} daily pilot reservations used (UTC). Saved inputs reuse their result. Reported input tokens: {config.usage._sum.inputTokens ?? 0} · Output tokens: {config.usage._sum.outputTokens ?? 0}.{config.unreportedUsage > 0 ? ` Usage was not reported for ${config.unreportedUsage} invocation(s).` : ''} Dollar cost is not configured.</p>}
    </section>}
    {test && <section aria-label="Evaluation result" className="rounded-xl border p-5 space-y-4">
      <div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">{labels[test.status] ?? test.status}{test.result ? ` · ${labels[test.result.classification]}` : ''}</h2><Button size="sm" variant="outline" disabled={busy} onClick={() => setDeleting(true)}>Delete test</Button></div>
      {isTestPending(test.status) && <p role="status">Your test is saved. Evaluation continues in the background; you can return to it later.</p>}
      {test.errorCode && <p role="alert">{test.errorCode.startsWith('INVALID_OUTPUT') ? `The model returned feedback that could not be validated (${test.errorCode}). Your answer has been saved.` : test.errorCode === 'TIMEOUT' ? 'The model timed out.' : `Evaluation needs attention: ${test.errorCode}.`} No grade was invented.</p>}
      {['FAILED','CANCELLED'].includes(test.status) && <>
        {test.configCurrent && test.attempts < (config?.limits.attempts ?? 3) && <Button variant="outline" disabled={busy || !config?.accessible} onClick={() => void action('retry')}>Retry evaluation</Button>}
        {!test.configCurrent && <p className="text-sm text-muted-foreground">The evaluator has been updated. Create a new test with your saved answer; this original test will be preserved.</p>}
        <Button variant="outline" disabled={busy || !config?.accessible} onClick={() => { setAnswer(test.snapshot.answerText); setAssistance(test.snapshot.assistance); setModel(config!.models.find(m => m.modelId === test.config.modelId)?.key ?? 'nova2_lite') }}>Use saved answer in a new test</Button>
      </>}
      {test.bankChanged && <p className="text-sm text-muted-foreground">The bank question has changed or was deleted. This result uses its saved question and guidance.</p>}
      {test.afterExample && <p className="font-medium text-sm">After example · This answer does not demonstrate independent recall.</p>}
      {test.snapshot.assistance === 'HINT' && <p className="text-sm">Answered with a hint.</p>}
      <details><summary className="text-sm cursor-pointer">Exact question and answer evaluated</summary><p className="mt-2 font-medium">{test.snapshot.questionSnapshot.questionText}</p><p className="whitespace-pre-wrap text-sm mt-2">{test.snapshot.answerText}</p></details>
      {test.result && <InterviewEvaluationFeedback result={test.result} />}
      <p className="text-xs text-muted-foreground">{test.config.label} · {test.usage.map(u => `${(u.latencyMs / 1000).toFixed(1)}s · ${u.inputTokens ?? 'unknown'} input / ${u.outputTokens ?? 'unknown'} output tokens · ${u.outcome}`).join(' | ')}</p>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Evaluation configuration</summary><p className="mt-2">{test.config.modelId} · {test.config.region} · {test.config.prompt} · {test.config.schema} · {test.config.rubric} · {test.config.policy}</p></details>
      {deleting && <div role="alertdialog" aria-label="Delete evaluation confirmation" className="border rounded-lg p-4 space-y-3"><p>Delete this test and its saved answer? Content-free invocation totals will remain.</p><Button variant="destructive" disabled={busy} onClick={() => void action('delete')}>Confirm delete</Button><Button variant="outline" className="ml-2" onClick={() => setDeleting(false)}>Cancel</Button></div>}
    </section>}
    {history.length > 0 && <section className="space-y-3"><h2 className="font-semibold">Your recent tests for this question</h2><div className="flex flex-wrap gap-2">{history.map(h => <Button key={h.id} variant="outline" onClick={() => { setError(''); setTestId(h.id) }}>{new Date(h.createdAt).toLocaleString()} · {labels[h.status] ?? h.status}</Button>)}</div></section>}
  </div>
}
