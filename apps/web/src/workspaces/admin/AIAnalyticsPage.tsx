import { useState, type FormEvent } from 'react'
import { Loader2, Pin, PinOff, Play, Sparkles, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useWorkspaceData, workspaceCall } from '../shell/context'
import { planSummary, type Plan } from '../shell/model'
import { EmptyState, ErrorAlert, MemberSelect, PageHeader } from './parts'
import {
  DailyActivityView, FeatureUsageView, LearnerActivityView, OverviewView, ProgressPulseView,
  type DailyActivity, type FeatureUsage, type LearnerActivity, type Overview, type PulseReport,
} from './reports'

const BASE = '/api/workspaces/current/admin/analytics'
type Interpretation =
  | { status: 'ready'; plan: Plan; learner?: { id: string; name: string } }
  | { status: 'clarification'; question: string }
  | { status: 'unsupported' | 'choose_learner'; reason: string }
interface Saved { id: string; question: string; title: string; plan: Plan; pinned: boolean; lastRunAt: string }
interface RunResult { result: { report: Plan['report']; data: unknown }; savedQuery: Saved }


export function ReportResult({ report, data }: { report: Plan['report']; data: unknown }) {
  switch (report) {
    case 'overview': return <OverviewView data={data as Overview} />
    case 'daily_activity': return <DailyActivityView data={data as DailyActivity} />
    case 'learner_activity': return <LearnerActivityView data={data as LearnerActivity} />
    case 'feature_usage': return <FeatureUsageView data={data as FeatureUsage} />
    case 'progress_pulse': return <ProgressPulseView data={data as PulseReport} />
  }
}

export function WorkspaceAIAnalytics() {
  const [question, setQuestion] = useState(''), [learner, setLearner] = useState<string>()
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState<'interpret' | 'run' | null>(null)
  const saved = useWorkspaceData<{ items: Saved[] }>(`${BASE}/saved`)

  async function interpret(event: FormEvent) {
    event.preventDefault()
    setBusy('interpret'); setError(''); setInterpretation(null); setResult(null)
    try { setInterpretation(await workspaceCall<Interpretation>(`${BASE}/interpret`, 'POST', { question, ...(learner ? { learner } : {}) })) }
    catch (e) { setError(e instanceof Error ? e.message : 'AI Analytics is unavailable') } finally { setBusy(null) }
  }
  async function run(path: string, body?: unknown) {
    setBusy('run'); setError('')
    try { setResult(await workspaceCall<RunResult>(path, 'POST', body)); saved.refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'The report could not run') } finally { setBusy(null) }
  }
  async function update(id: string, body: unknown, method = 'PATCH') {
    setError('')
    try { await workspaceCall(`${BASE}/saved/${id}`, method, body); saved.refresh() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') }
  }

  return <div className="space-y-5">
    <PageHeader title="AI Analytics" description="Ask a question about practice in this workspace. Answers come from predefined workspace reports only; transcripts, recordings and answers are never used." />
    <Card><CardContent className="pt-6"><form onSubmit={interpret} className="space-y-4">
      <Textarea aria-label="Analytics question" placeholder="For example: Which learners practised Elevate most in the last two weeks?" value={question} maxLength={1000} rows={3} onChange={e => setQuestion(e.target.value)} />
      <div className="flex flex-wrap items-end gap-4">
        <MemberSelect value={learner} onChange={setLearner} label="About one learner (optional)" allLabel="Whole workspace" />
        <Button type="submit" disabled={!question.trim() || busy !== null}>{busy === 'interpret' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Interpret question</Button>
      </div>
    </form></CardContent></Card>
    <ErrorAlert error={error} />
    {interpretation && interpretation.status !== 'ready' && <Card><CardContent className="pt-6 text-sm">
      {interpretation.status === 'clarification' ? interpretation.question : interpretation.reason}
    </CardContent></Card>}
    {interpretation?.status === 'ready' && <Card><CardHeader><CardTitle className="text-base">{interpretation.plan.title}</CardTitle>
      <CardDescription>{planSummary(interpretation.plan, interpretation.learner?.name)}</CardDescription></CardHeader>
      <CardContent className="space-y-3"><p className="text-sm">{interpretation.plan.explanation}</p>
        <Button disabled={busy !== null} onClick={() => run(`${BASE}/run`, { question, plan: interpretation.plan })}>{busy === 'run' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}Run report</Button>
      </CardContent></Card>}
    {result && <section className="space-y-3"><h2 className="text-lg font-semibold">{result.savedQuery.title}</h2><ReportResult report={result.result.report} data={result.result.data} /></section>}
    <Card><CardHeader><CardTitle className="text-base">Saved reports</CardTitle><CardDescription>Shared with the Owners and Admins of this workspace</CardDescription></CardHeader><CardContent>
      {!saved.data?.items.length ? <EmptyState>Reports you run are saved here.</EmptyState> : <ul className="divide-y">{saved.data.items.map(item => <SavedRow key={item.id} item={item} busy={busy !== null}
        onRun={() => run(`${BASE}/saved/${item.id}/run`)} onPin={() => update(item.id, { pinned: !item.pinned })}
        onRename={title => update(item.id, { title })} onDelete={() => update(item.id, undefined, 'DELETE')} />)}</ul>}
    </CardContent></Card>
  </div>
}

function SavedRow({ item, busy, onRun, onPin, onRename, onDelete }: { item: Saved; busy: boolean; onRun: () => void; onPin: () => void; onRename: (title: string) => void; onDelete: () => void }) {
  const [title, setTitle] = useState(item.title)
  return <li className="flex flex-wrap items-center gap-3 py-3">
    <div className="min-w-0 flex-1 space-y-1">
      <Input aria-label="Report title" value={title} maxLength={100} onChange={e => setTitle(e.target.value)} onBlur={() => { if (title.trim() && title !== item.title) onRename(title.trim()) }} className="h-8" />
      <p className="truncate text-xs text-muted-foreground">{planSummary(item.plan)} · last run {new Date(item.lastRunAt).toLocaleString()}</p>
    </div>
    {item.pinned && <Badge variant="secondary">Pinned</Badge>}
    <Button size="sm" variant="outline" disabled={busy} onClick={onRun}><Play className="mr-1 h-3 w-3" />Run</Button>
    <Button size="sm" variant="ghost" aria-label={item.pinned ? 'Unpin report' : 'Pin report'} onClick={onPin}>{item.pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}</Button>
    <Button size="sm" variant="ghost" aria-label="Delete report" onClick={onDelete}><Trash2 className="h-4 w-4" /></Button>
  </li>
}
