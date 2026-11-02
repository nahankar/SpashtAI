import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspaceData, workspaceCall } from '../shell/context'
import { filterQuery, rangeLabel, type AnalyticsFilters } from '../shell/model'
import { EmptyState, ErrorAlert, FilterBar, Loading, MemberSelect, PageHeader } from './parts'
import {
  DailyActivityView, FeatureUsageView, LearnerActivityView, OverviewView, ProgressPulseView,
  type DailyActivity, type FeatureUsage, type LearnerActivity, type Overview, type Person, type PulseReport,
} from './reports'

const BASE = '/api/workspaces/current/admin'
const initial: AnalyticsFilters = { days: 30 }

export function WorkspaceDashboard() {
  const [filters, setFilters] = useState(initial)
  const q = filterQuery(filters)
  const overview = useWorkspaceData<Overview>(`${BASE}/overview?${q}`)
  const daily = useWorkspaceData<DailyActivity>(`${BASE}/activity/daily?${q}`)
  const learners = useWorkspaceData<LearnerActivity>(`${BASE}/activity/learners?${q}`)
  return <div className="space-y-5">
    <PageHeader title="Dashboard" description={rangeLabel(overview.data?.range) || 'Practice and capacity for this workspace'} />
    <FilterBar filters={filters} onChange={setFilters} />
    <ErrorAlert error={overview.error || daily.error || learners.error} />
    {overview.loading && !overview.data ? <Loading /> : overview.data && <OverviewView data={overview.data} />}
    {daily.data && <DailyActivityView data={daily.data} />}
    {learners.data && <LearnerActivityView data={learners.data} />}
  </div>
}

export function WorkspaceFeatureUsage() {
  const [filters, setFilters] = useState(initial)
  const usage = useWorkspaceData<FeatureUsage>(`${BASE}/feature-usage?${filterQuery(filters)}`)
  return <div className="space-y-5">
    <PageHeader title="Feature usage" description={rangeLabel(usage.data?.range) || 'How members use each product in this workspace'} />
    <FilterBar filters={filters} onChange={setFilters} />
    <ErrorAlert error={usage.error} />
    {usage.loading && !usage.data ? <Loading /> : usage.data && <FeatureUsageView data={usage.data} />}
  </div>
}

const PULSE_PRODUCTS = [{ id: 'elevate', label: 'Elevate' }, { id: 'replay', label: 'Replay' }] as const

export function WorkspaceProgressPulse() {
  const [filters, setFilters] = useState(initial)
  const pulse = useWorkspaceData<PulseReport>(`${BASE}/progress-pulse?${filterQuery(filters)}`)
  return <div className="space-y-5">
    <PageHeader title="Progress Pulse" description={rangeLabel(pulse.data?.range) || 'Communication skill scores across the workspace'} />
    <FilterBar filters={filters} onChange={setFilters} skill products={PULSE_PRODUCTS} />
    <ErrorAlert error={pulse.error} />
    {pulse.loading && !pulse.data ? <Loading /> : pulse.data && <ProgressPulseView data={pulse.data} />}
  </div>
}

interface FeedbackItem { id: string; feedbackNumber: string; type: string; subject: string; body: string; status: string; sessionModule: string | null; createdAt: string; learner: Person }
interface FeedbackPage { items: FeedbackItem[]; nextCursor: string | null; counts: Record<string, number> }
const STATUSES = ['OPEN', 'ACKNOWLEDGED', 'CONSIDERED', 'IMPLEMENTED', 'PARKED']
const TYPES = [{ id: 'FEEDBACK', label: 'Feedback' }, { id: 'ISSUE', label: 'Issue' }, { id: 'FEATURE_REQUEST', label: 'Feature request' }]
const ALL = 'all'
const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')

export function WorkspaceFeedback() {
  const [status, setStatus] = useState<string>()
  const [type, setType] = useState<string>()
  const [learner, setLearner] = useState<string>()
  const [pages, setPages] = useState<FeedbackPage[]>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<FeedbackItem | null>(null)
  const query = (after?: string) => new URLSearchParams(Object.entries({ status, type, learner, after }).filter(([, v]) => v) as Array<[string, string]>).toString()
  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    workspaceCall<FeedbackPage>(`${BASE}/feedback?${query()}`).then(page => { if (alive) setPages([page]) })
      .catch(e => { if (alive) { setPages([]); setError(e.message) } }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, type, learner])
  async function more() {
    const cursor = pages.at(-1)?.nextCursor
    if (!cursor) return
    setLoading(true)
    try { const page = await workspaceCall<FeedbackPage>(`${BASE}/feedback?${query(cursor)}`); setPages(p => [...p, page]) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load') } finally { setLoading(false) }
  }
  const items = pages.flatMap(p => p.items)
  const counts = pages[0]?.counts ?? {}
  return <div className="space-y-5">
    <PageHeader title="Feedback" description="Feedback learners submitted inside this workspace. Attachments and session links stay with SpashtAI support." />
    <div className="flex flex-wrap gap-2">{STATUSES.map(s => <Badge key={s} variant={status === s ? 'default' : 'secondary'}>{words(s)} · {counts[s] ?? 0}</Badge>)}</div>
    <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
      <div className="space-y-1.5"><Label>Status</Label><Select value={status ?? ALL} onValueChange={v => setStatus(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label="Status" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s}>{words(s)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Type</Label><Select value={type ?? ALL} onValueChange={v => setType(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label="Type" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All types</SelectItem>{TYPES.map(t => <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>)}</SelectContent></Select></div>
      <MemberSelect value={learner} onChange={setLearner} />
    </div>
    <ErrorAlert error={error} />
    <Card><CardContent className="pt-6">
      {loading && !items.length ? <Loading /> : items.length === 0 ? <EmptyState>No feedback matches these filters.</EmptyState> : <Table>
        <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Subject</TableHead><TableHead>Learner</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Submitted</TableHead></TableRow></TableHeader>
        <TableBody>{items.map(item => <TableRow key={item.id} className="cursor-pointer" onClick={() => setOpen(item)}>
          <TableCell className="font-mono text-xs">{item.feedbackNumber}</TableCell>
          <TableCell className="max-w-xs"><Button variant="link" className="h-auto p-0 text-left whitespace-normal" onClick={() => setOpen(item)}>{item.subject}</Button></TableCell>
          <TableCell>{item.learner.name}</TableCell><TableCell>{words(item.type)}</TableCell>
          <TableCell><Badge variant="outline">{words(item.status)}</Badge></TableCell>
          <TableCell>{new Date(item.createdAt).toLocaleDateString()}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {pages.at(-1)?.nextCursor && <div className="pt-4"><Button variant="outline" disabled={loading} onClick={more}>Load more</Button></div>}
    </CardContent></Card>
    <Dialog open={Boolean(open)} onOpenChange={value => { if (!value) setOpen(null) }}>
      <DialogContent>{open && <><DialogHeader><DialogTitle>{open.subject}</DialogTitle>
        <DialogDescription>{open.feedbackNumber} · {words(open.type)} · {open.learner.name} · {new Date(open.createdAt).toLocaleString()}</DialogDescription></DialogHeader>
        <p className="whitespace-pre-wrap break-words text-sm">{open.body}</p>
        {open.sessionModule && <p className="text-xs text-muted-foreground">Submitted from {open.sessionModule}</p>}</>}
      </DialogContent>
    </Dialog>
  </div>
}
