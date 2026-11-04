import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Eye, Loader2, Play, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { workspaceApiUrl } from '../client'
import { useWorkspaceData, useWorkspaceShell, workspaceCall } from '../shell/context'
import { EmptyState, ErrorAlert, Loading, MemberSelect, PageHeader } from './parts'
import {
  REVIEW_PRODUCTS, REVIEW_STATUSES, classificationLabel, feedbackLines, feedbackStatusLabel, filterSearch, filtersFromSearch, findingLabel,
  formatClock, formatDuration, formatWhen, productLabel, reviewDetailPath, reviewListPath, reviewPagePath, reviewTicketPath, scoredSkills,
  speakerLabel, statusLabel, type CoachingInsights, type InterviewAttemptReview, type ReviewDetail, type ReviewFilters, type ReviewItem,
  type ReviewPage, type ReviewProduct, type ReviewRecording, type ReviewStatus, type ReviewTurn, type SkillScores,
} from './sessionReview'

const ALL = 'all'
const AUDIT_NOTE = 'Read-only. Each review and playback is recorded in this workspace\u2019s audit log.'

export function WorkspaceSessions() {
  const { slug, snapshot } = useWorkspaceShell()
  const [params, setParams] = useSearchParams()
  const filters = filtersFromSearch(params)
  const key = filterSearch(filters)
  const [pages, setPages] = useState<ReviewPage[]>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const load = useCallback(async (after?: string) => {
    setLoading(true); setError('')
    try {
      const page = await workspaceCall<ReviewPage>(reviewListPath(filtersFromSearch(new URLSearchParams(key)), after))
      setPages(current => after ? [...current, page] : [page])
    } catch (e) { if (!after) setPages([]); setError(e instanceof Error ? e.message : 'Unable to load sessions') } finally { setLoading(false) }
  }, [key])
  useEffect(() => { void load() }, [load])
  const change = (next: ReviewFilters) => setParams(new URLSearchParams(filterSearch(next)), { replace: true })
  const items = pages.flatMap(page => page.items)
  return <div className="space-y-5">
    <PageHeader title="Sessions" description={`Elevate, Replay and Interviews sessions learners created in ${snapshot.workspace.name}. Personal activity is never shown.`} />
    <ReviewFilterBar filters={filters} onChange={change} timeZone={snapshot.workspace.timeZone} />
    <ErrorAlert error={error} />
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{AUDIT_NOTE}</p>
    <Card><CardContent className="pt-6">
      {loading && !items.length ? <Loading /> : <SessionReviewTable items={items} base={`/w/${encodeURIComponent(slug)}`} timeZone={pages[0]?.timeZone ?? snapshot.workspace.timeZone} />}
      {pages.at(-1)?.nextCursor && <div className="pt-4"><Button variant="outline" disabled={loading} onClick={() => load(pages.at(-1)!.nextCursor!)}>Load more</Button></div>}
    </CardContent></Card>
  </div>
}

export function ReviewFilterBar({ filters, onChange, timeZone }: { filters: ReviewFilters; onChange: (next: ReviewFilters) => void; timeZone: string }) {
  return <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label="Session filters">
    <MemberSelect value={filters.learner} onChange={learner => onChange({ ...filters, learner })} />
    <div className="space-y-1.5"><Label>Product</Label>
      <Select value={filters.product ?? ALL} onValueChange={v => onChange({ ...filters, product: v === ALL ? undefined : v as ReviewProduct })}>
        <SelectTrigger aria-label="Product" className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All products</SelectItem>{REVIEW_PRODUCTS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
      </Select></div>
    <div className="space-y-1.5"><Label>Status</Label>
      <Select value={filters.status ?? ALL} onValueChange={v => onChange({ ...filters, status: v === ALL ? undefined : v as ReviewStatus })}>
        <SelectTrigger aria-label="Status" className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{REVIEW_STATUSES.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
      </Select></div>
    <div className="space-y-1.5"><Label htmlFor="review-from">From</Label>
      <Input id="review-from" type="date" value={filters.from ?? ''} max={filters.to} onChange={e => onChange({ ...filters, from: e.target.value || undefined })} className="w-40" /></div>
    <div className="space-y-1.5"><Label htmlFor="review-to">To</Label>
      <Input id="review-to" type="date" value={filters.to ?? ''} min={filters.from} onChange={e => onChange({ ...filters, to: e.target.value || undefined })} className="w-40" /></div>
    <p className="w-full text-xs text-muted-foreground">{`Dates are days in ${timeZone}.`}</p>
  </div>
}

export function SessionReviewTable({ items, base, timeZone }: { items: ReviewItem[]; base: string; timeZone: string }) {
  if (!items.length) return <EmptyState>No sessions match these filters.</EmptyState>
  return <Table>
    <TableHeader><TableRow><TableHead>Learner</TableHead><TableHead>Product</TableHead><TableHead>Session</TableHead><TableHead>Started</TableHead>
      <TableHead>Duration</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Review</span></TableHead></TableRow></TableHeader>
    <TableBody>{items.map(item => <TableRow key={`${item.product}:${item.id}`}>
      <TableCell><p className="font-medium">{item.learner.name}</p>{item.learner.email && <p className="text-xs text-muted-foreground">{item.learner.email}</p>}</TableCell>
      <TableCell>{productLabel(item.product)}</TableCell>
      <TableCell className="max-w-[16rem] truncate">{item.name || 'Untitled session'}</TableCell>
      <TableCell className="whitespace-nowrap">{formatWhen(item.startedAt, timeZone)}</TableCell>
      <TableCell>{formatDuration(item.durationSeconds)}</TableCell>
      <TableCell><StatusBadge status={item.status} /></TableCell>
      <TableCell><Button asChild variant="outline" size="sm"><Link to={reviewPagePath(base, item)}><Eye className="mr-1.5 h-4 w-4" />Review</Link></Button></TableCell>
    </TableRow>)}</TableBody>
  </Table>
}

function StatusBadge({ status }: { status: string }) {
  return <Badge variant={status === 'completed' ? 'success' : status === 'failed' ? 'destructive' : 'secondary'}>{statusLabel(status)}</Badge>
}

export function WorkspaceSessionReview() {
  const { slug, snapshot } = useWorkspaceShell()
  const { product, sessionId } = useParams()
  const valid = REVIEW_PRODUCTS.some(p => p.id === product) && !!sessionId
  const { data, error, loading } = useWorkspaceData<ReviewDetail>(valid ? reviewDetailPath(product as ReviewProduct, sessionId!) : null)
  const base = `/w/${encodeURIComponent(slug)}`
  return <div className="space-y-5">
    <Button asChild variant="ghost" size="sm"><Link to={`${base}/admin/sessions`}><ArrowLeft className="mr-1.5 h-4 w-4" />All sessions</Link></Button>
    {!valid ? <ErrorAlert error="This session address is not valid." /> : <ErrorAlert error={error} />}
    {loading && !data ? <Loading /> : data && <SessionReviewView data={data} timeZone={snapshot.workspace.timeZone} />}
  </div>
}

export function SessionReviewView({ data, timeZone }: { data: ReviewDetail; timeZone: string }) {
  const { session } = data
  const title = session.name || `${productLabel(data.product)} session`
  return <div className="space-y-5">
    <PageHeader title={title} description={[session.learner.name, session.learner.email, productLabel(data.product), formatWhen(session.startedAt, timeZone),
      session.durationSeconds != null ? formatDuration(session.durationSeconds) : null].filter(Boolean).join(' · ')}
      actions={<div className="flex items-center gap-2"><StatusBadge status={session.status} /><Badge variant="outline">Read-only review</Badge></div>} />
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />{AUDIT_NOTE}</p>
    <Section title="Recordings">
      {data.recordings.length === 0 ? <p className="text-sm text-muted-foreground">No recording is available for this session.</p>
        : <div className="space-y-3">{data.recordings.map((recording, index) =>
          <RecordingPlayer key={recording.id} product={data.product} sessionId={session.id} recording={recording} label={recordingLabel(recording, index, data.recordings.length)} />)}</div>}
    </Section>
    {data.interview && <InterviewSection interview={data.interview} />}
    {data.replay && <ReplaySection replay={data.replay} />}
    {data.transcript && <Section title="Transcript">{data.transcript.length === 0 ? <p className="text-sm text-muted-foreground">No transcript was saved.</p>
      : <Transcript turns={data.transcript} product={data.product} />}</Section>}
    {data.results && <Section title="Results"><Results metrics={data.results.metrics} skills={data.results.skillScores} coaching={data.results.coachingInsights} /></Section>}
  </div>
}

function recordingLabel(recording: ReviewRecording, index: number, count: number) {
  const kind = recording.kind === 'video' ? 'Video' : recording.kind === 'agent' ? 'Coach audio' : 'Audio'
  const part = recording.segmentIndex != null && count > 1 ? ` · part ${recording.segmentIndex + 1}` : count > 1 ? ` ${index + 1}` : ''
  return `${kind}${part}${recording.durationSeconds ? ` · ${formatDuration(recording.durationSeconds)}` : ''}`
}

/** Loads a short-lived, audited playback ticket on demand; the browser then streams with byte ranges (seeking). */
function RecordingPlayer({ product, sessionId, recording, label }: { product: ReviewProduct; sessionId: string; recording: ReviewRecording; label: string }) {
  const [src, setSrc] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  async function open() {
    setBusy(true); setError('')
    try {
      const { url } = await workspaceCall<{ url: string }>(reviewTicketPath(product, sessionId, recording.id), 'POST')
      setSrc(workspaceApiUrl(url))
    } catch (e) { setError(e instanceof Error ? e.message : 'Recording is not available') } finally { setBusy(false) }
  }
  if (!recording.available) return <p className="text-sm text-muted-foreground">{`${label}: not included in your organization's plan.`}</p>
  return <div className="space-y-1.5">
    <p className="text-sm font-medium">{label}</p>
    {src ? (recording.kind === 'video'
      ? <video controls preload="metadata" src={src} className="w-full max-w-2xl rounded border" onError={() => setError('Playback stopped. Load the recording again.')} />
      : <audio controls preload="metadata" src={src} className="w-full max-w-2xl" onError={() => setError('Playback stopped. Load the recording again.')} />)
      : <Button variant="outline" size="sm" disabled={busy} onClick={open}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}Load recording</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}{src && <Button variant="link" size="sm" onClick={open}>Reload</Button>}</p>}
  </div>
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <Card><CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
    <CardContent>{children}</CardContent></Card>
}

function Transcript({ turns, product }: { turns: ReviewTurn[]; product: ReviewProduct }) {
  return <ol className="space-y-3">{turns.map(turn => <li key={turn.id} className="rounded-md border p-3">
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{speakerLabel(turn.role, product)}</span>
      {turn.audioStart != null && <span>{formatClock(turn.audioStart)}</span>}
      {turn.score?.stars != null && <span>{`${turn.score.stars} / 5`}</span>}
      {turn.score?.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
    </div>
    <p className="mt-1 whitespace-pre-wrap text-sm">{turn.text}</p>
    {turn.coachNote && <p className="mt-2 text-sm text-muted-foreground">{`Coach note: ${turn.coachNote}`}</p>}
  </li>)}</ol>
}

const METRIC_LABELS: Record<string, string> = {
  wordsPerMinute: 'Words per minute', fillerCount: 'Filler words', fillerRate: 'Filler rate', fillerWordCount: 'Filler words', fillerWordRate: 'Filler rate',
  avgSentenceLength: 'Average sentence length', speakingSeconds: 'Speaking time (s)', vocabularyDiversity: 'Vocabulary diversity', responseTimeAvg: 'Average response time (s)',
  totalTurns: 'Turns', hedgingCount: 'Hedges', wordShare: 'Word share (%)', questionsAsked: 'Questions asked', paceStatus: 'Pace',
  overall: 'Overall', clarity: 'Clarity', confidence: 'Confidence', engagement: 'Engagement',
}
function MetricGrid({ values }: { values: Record<string, number | string | null> }) {
  const shown = Object.entries(values).filter(([, value]) => value !== null && value !== undefined)
  if (!shown.length) return null
  return <dl className="grid gap-3 sm:grid-cols-3">{shown.map(([key, value]) => <div key={key} className="rounded-md border p-2">
    <dt className="text-xs text-muted-foreground">{METRIC_LABELS[key] ?? key}</dt>
    <dd className="text-sm font-semibold tabular-nums">{typeof value === 'number' ? Math.round(value * 10) / 10 : value}</dd></div>)}</dl>
}

function Results({ metrics, skills, coaching }: { metrics?: Record<string, number | string | null>; skills: SkillScores | null; coaching: CoachingInsights | null }) {
  const scored = scoredSkills(skills)
  return <div className="space-y-4">
    {metrics && <MetricGrid values={metrics} />}
    {scored.length > 0 && <div><h3 className="mb-2 text-sm font-semibold">Skill scores</h3>
      <ul className="grid gap-2 sm:grid-cols-4">{scored.map(s => <li key={s.key} className="rounded-md border p-2 text-sm"><span className="text-muted-foreground">{s.label}</span> <span className="font-semibold">{s.value}</span></li>)}</ul></div>}
    {coaching && <div className="space-y-1 text-sm"><h3 className="text-sm font-semibold">Coaching</h3>
      {([['Top strength', coaching.topStrength], ['Primary improvement', coaching.primaryImprovement], ['Advice', coaching.actionableAdvice],
        ['Practice exercise', coaching.practiceExercise], ['Summary', coaching.overallNarrative]] as const).filter(([, v]) => v).map(([k, v]) => <p key={k}><span className="font-medium">{k}:</span> {v}</p>)}
      {coaching.practicePlan.length > 0 && <ul className="list-disc pl-5">{coaching.practicePlan.map((item, i) => <li key={i}>{[item.title, item.description].filter(Boolean).join(': ')}</li>)}</ul>}
    </div>}
  </div>
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return <div><h4 className="text-sm font-semibold">{title}</h4><ul className="list-disc space-y-0.5 pl-5 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
}

function InterviewSection({ interview }: { interview: NonNullable<ReviewDetail['interview']> }) {
  return <Section title="Questions and answers" description={[interview.track, interview.experienceBand, interview.startingDifficulty].filter(Boolean).join(' · ')}>
    {interview.attempts.length === 0 ? <p className="text-sm text-muted-foreground">No questions were asked.</p>
      : <ol className="space-y-4">{interview.attempts.map(attempt => <InterviewAttempt key={attempt.id} attempt={attempt} />)}</ol>}
  </Section>
}

function InterviewAttempt({ attempt }: { attempt: InterviewAttemptReview }) {
  const result = attempt.feedback.result
  const answer = attempt.answer?.text || attempt.capturedText
  return <li className="space-y-2 rounded-md border p-3">
    <p className="text-sm font-semibold">{`Question ${attempt.index}: ${attempt.question.text}`}</p>
    <div><h4 className="text-xs font-semibold uppercase text-muted-foreground">Answer</h4>
      <p className="whitespace-pre-wrap text-sm">{answer || 'No answer was captured.'}</p></div>
    <div className="space-y-2"><h4 className="text-xs font-semibold uppercase text-muted-foreground">Technical feedback</h4>
      {!result ? <p className="text-sm text-muted-foreground">{feedbackStatusLabel(attempt.feedback.status)}</p> : <>
        <Badge variant="secondary">{classificationLabel(result.classification)}</Badge>
        <ul className="space-y-1 text-sm">{result.criteria.map(c => <li key={c.criterion}><span className="font-medium">{`${c.criterion.charAt(0)}${c.criterion.slice(1).toLowerCase()}: ${findingLabel(c.finding)}`}</span>{` — ${c.explanation}`}</li>)}</ul>
        <List title="Strengths" items={result.strengths} /><List title="Gaps" items={result.gaps} /><List title="Misconceptions" items={result.misconceptions} />
        <p className="text-sm"><span className="font-medium">Guidance:</span> {result.guidance}</p>
      </>}
    </div>
  </li>
}

function ReplaySection({ replay }: { replay: NonNullable<ReviewDetail['replay']> }) {
  const lines = (title: string, value: unknown) => <List title={title} items={feedbackLines(value)} />
  return <>
    <Section title="Transcript">{replay.structuredTranscript.length > 0
      ? <ol className="space-y-2">{replay.structuredTranscript.map((segment, i) => <li key={i} className="text-sm"><span className="font-semibold">{segment.speaker}</span>
        {segment.startTime != null && <span className="ml-2 text-xs text-muted-foreground">{formatClock(segment.startTime)}</span>}<p className="whitespace-pre-wrap">{segment.text}</p></li>)}</ol>
      : <p className="whitespace-pre-wrap text-sm">{replay.transcriptText || 'No transcript was saved.'}</p>}</Section>
    <Section title="Results" description={replay.feedback.scope}>
      <div className="space-y-4">
        <MetricGrid values={{ ...replay.scores, ...replay.metrics }} />
        <Results skills={replay.skillScores} coaching={replay.coachingInsights} />
        {lines('Strengths', replay.feedback.strengths)}{lines('Improvements', replay.feedback.improvements)}
        {lines('Recommendations', replay.feedback.recommendations)}{lines('Context-specific feedback', replay.feedback.contextSpecificFeedback)}
        {lines('Key moments', replay.feedback.keyMoments)}
      </div>
    </Section>
  </>
}
