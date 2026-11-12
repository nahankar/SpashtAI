import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PULSE_SKILL_BLOCKS } from '@/lib/pulse-skills'
import { featureLabel, PRODUCTS } from '../shell/model'
import { EmptyState, StatCard } from './parts'

export interface Range { from: string; to: string; timeZone: string; learner: string | null; product: string | null; skill: string | null }
export interface Person { memberId: string | null; name: string; email: string | null; role: string | null }
export interface Overview {
  range: Range
  members: { active: number; invited: number; suspended: number; seats: number }
  activeLearners: number
  activity: Record<string, number>
  evaluations: { day: string; used: number; limit: number }
  voice: { inUse: number; limit: number }
}
export interface DailyActivity { range: Range; days: Array<{ day: string; activeLearners: number; elevate: number; replay: number; interviews: number; practiceMinutes: number }> }
export interface LearnerActivity { range: Range; learners: Array<Person & { lastActiveDay: string | null; elevate: number; replay: number; interviews: number }> }
export interface FeatureUsage {
  range: Range
  features: Array<{ feature: string; practices: number; learners: number }>
  days: Array<Record<string, string | number>>
  learners: Array<Person & { practices: number; lastActiveDay: string }>
}
export interface PulseReport {
  range: Range
  skills: Array<{ skill: string; average: number; samples: number; learners: number }>
  days: Array<{ day: string; average: number | null; samples: number }>
  learners: Array<Person & { average: number; samples: number; lastActiveDay: string }>
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))', 'hsl(var(--primary))']
const skillLabel = (id: string) => PULSE_SKILL_BLOCKS.find(s => s.id === id)?.label ?? featureLabel(id)
const shortDay = (day: string) => day.slice(5)

function Who({ person }: { person: Person }) {
  return <div className="min-w-0"><p className="truncate font-medium">{person.name}</p>{person.email && <p className="truncate text-xs text-muted-foreground">{person.email}</p>}</div>
}

export function OverviewView({ data }: { data: Overview }) {
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard label="Active members" value={`${data.members.active} / ${data.members.seats}`} hint={`${data.members.invited} invited · ${data.members.suspended} suspended`} />
      <StatCard label="Active learners" value={data.activeLearners} hint="Practised at least once in this period" />
      <StatCard label="Evaluations today" value={`${data.evaluations.used} / ${data.evaluations.limit}`} hint={`Organization day ${data.evaluations.day}`} />
      <StatCard label="Voice sessions now" value={`${data.voice.inUse} / ${data.voice.limit}`} hint="Concurrent voice capacity" />
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      {PRODUCTS.map(p => <StatCard key={p.id} label={`${p.label} practices`} value={data.activity[p.id] ?? 0} />)}
    </div>
  </div>
}

export function DailyActivityView({ data }: { data: DailyActivity }) {
  const total = data.days.reduce((sum, d) => sum + d.elevate + d.replay + d.interviews, 0)
  return <Card><CardHeader><CardTitle className="text-base">Practice by day</CardTitle><CardDescription>Counted on the organization calendar day</CardDescription></CardHeader>
    <CardContent>{total === 0 ? <EmptyState>No practice in this period.</EmptyState> : <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.days}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} fontSize={12} /><YAxis allowDecimals={false} fontSize={12} />
          <Tooltip /><Legend />
          {PRODUCTS.map((p, i) => <Bar key={p.id} dataKey={p.id} name={p.label} stackId="practice" fill={COLORS[i]} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>}</CardContent></Card>
}

export function LearnerActivityView({ data }: { data: LearnerActivity }) {
  return <Card><CardHeader><CardTitle className="text-base">Learner activity</CardTitle></CardHeader><CardContent>
    {data.learners.length === 0 ? <EmptyState>No learner practised in this period.</EmptyState> : <Table>
      <TableHeader><TableRow><TableHead>Learner</TableHead>{PRODUCTS.map(p => <TableHead key={p.id} className="text-right">{p.label}</TableHead>)}<TableHead>Last active</TableHead></TableRow></TableHeader>
      <TableBody>{data.learners.map((row, i) => <TableRow key={row.memberId ?? `former-${i}`}><TableCell><Who person={row} /></TableCell>
        {PRODUCTS.map(p => <TableCell key={p.id} className="text-right tabular-nums">{row[p.id]}</TableCell>)}<TableCell>{row.lastActiveDay ?? '—'}</TableCell></TableRow>)}</TableBody>
    </Table>}
  </CardContent></Card>
}

export function FeatureUsageView({ data }: { data: FeatureUsage }) {
  const features = [...new Set(data.days.flatMap(d => Object.keys(d).filter(k => k !== 'day')))]
  return <div className="space-y-4">
    <Card><CardHeader><CardTitle className="text-base">Learner practices by day</CardTitle><CardDescription>Each existing learner practice counts once, on the day it started. Deleted practices, page views, and owner/admin activity are excluded.</CardDescription></CardHeader><CardContent>
      {data.features.length === 0 ? <EmptyState>No learner practices in this period.</EmptyState> : <div className="h-72"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDay} fontSize={12} /><YAxis allowDecimals={false} fontSize={12} /><Tooltip /><Legend />
          {features.map((f, i) => <Line key={f} dataKey={f} name={featureLabel(f)} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} />)}
        </LineChart></ResponsiveContainer></div>}
    </CardContent></Card>
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Practices by product</CardTitle></CardHeader><CardContent>{data.features.length === 0 ? <EmptyState>No learner practices.</EmptyState> : <Table>
        <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">Practices</TableHead><TableHead className="text-right">Learners</TableHead></TableRow></TableHeader>
        <TableBody>{data.features.map(row => <TableRow key={row.feature}><TableCell><Badge variant="secondary">{featureLabel(row.feature)}</Badge></TableCell><TableCell className="text-right tabular-nums">{row.practices}</TableCell><TableCell className="text-right tabular-nums">{row.learners}</TableCell></TableRow>)}</TableBody>
      </Table>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base">Most active learners</CardTitle></CardHeader><CardContent>{data.learners.length === 0 ? <EmptyState>No learners practised in this period.</EmptyState> : <Table>
        <TableHeader><TableRow><TableHead>Learner</TableHead><TableHead className="text-right">Practices</TableHead><TableHead>Last active</TableHead></TableRow></TableHeader>
        <TableBody>{data.learners.map((row, i) => <TableRow key={row.memberId ?? `former-${i}`}><TableCell><Who person={row} /></TableCell><TableCell className="text-right tabular-nums">{row.practices}</TableCell><TableCell>{row.lastActiveDay}</TableCell></TableRow>)}</TableBody>
      </Table>}</CardContent></Card>
    </div>
  </div>
}

export function ProgressPulseView({ data }: { data: PulseReport }) {
  const scored = data.days.filter(d => d.average !== null).length
  return <div className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{data.skills.length === 0 ? <div className="sm:col-span-2 lg:col-span-4"><EmptyState>No Progress Pulse scores in this period.</EmptyState></div>
      : data.skills.map(s => <StatCard key={s.skill} label={skillLabel(s.skill)} value={s.average} hint={`${s.samples} scores · ${s.learners} learners`} />)}</div>
    <Card><CardHeader><CardTitle className="text-base">Average score by day</CardTitle><CardDescription>Communication practice from Elevate and Replay. Interview grading is reported separately.</CardDescription></CardHeader><CardContent>
      {scored === 0 ? <EmptyState>No scored days in this period.</EmptyState> : <div className="h-64"><ResponsiveContainer width="100%" height="100%">
        <LineChart data={data.days}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tickFormatter={shortDay} fontSize={12} /><YAxis domain={[0, 100]} fontSize={12} /><Tooltip />
          <Line dataKey="average" name="Average" stroke={COLORS[0]} strokeWidth={2} connectNulls={false} />
        </LineChart></ResponsiveContainer></div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Learners</CardTitle></CardHeader><CardContent>{data.learners.length === 0 ? <EmptyState>No learners were scored.</EmptyState> : <Table>
      <TableHeader><TableRow><TableHead>Learner</TableHead><TableHead className="text-right">Average</TableHead><TableHead className="text-right">Scores</TableHead><TableHead>Last scored</TableHead></TableRow></TableHeader>
      <TableBody>{data.learners.map((row, i) => <TableRow key={row.memberId ?? `former-${i}`}><TableCell><Who person={row} /></TableCell><TableCell className="text-right tabular-nums">{row.average}</TableCell><TableCell className="text-right tabular-nums">{row.samples}</TableCell><TableCell>{row.lastActiveDay}</TableCell></TableRow>)}</TableBody>
    </Table>}</CardContent></Card>
  </div>
}
