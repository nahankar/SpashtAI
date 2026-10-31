import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/admin/MetricCard'
import {
  SAMPLE_AI_ANSWERS,
  SAMPLE_FEATURE_USAGE,
  SAMPLE_ORG,
  SAMPLE_PULSE_SKILLS,
  SAMPLE_PULSE_TREND,
  SAMPLE_UX_FUNNEL,
  SAMPLE_UX_PAGES,
  SAMPLE_WEEKLY_SESSIONS,
} from '@/lib/tenantDemoSample'

export type DemoAnalyticsView = 'features' | 'pulse' | 'ai' | 'ux'

const TITLES: Record<DemoAnalyticsView, string> = {
  features: 'Feature Usage',
  pulse: 'Progress Pulse',
  ai: 'AI Analytics',
  ux: 'UX Analytics',
}
const SERIES_COLORS = ['hsl(var(--primary))', 'hsl(262.1, 83.3%, 57.8%)', 'hsl(142.1, 76.2%, 36.3%)', 'hsl(32, 95%, 44%)']
const tooltipStyle = { backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '6px' }
const pct = (n: number) => `${Math.round(n * 100)}%`

/**
 * Analytics pages in the Tenant Admin demo. Every figure is fictional sample organization data from
 * lib/tenantDemoSample; no platform analytics, saved queries or individual learners are loaded.
 */
export function TenantDemoAnalytics({ view }: { view: DemoAnalyticsView }) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{TITLES[view]}</h1>
          <p className="text-muted-foreground">{SAMPLE_ORG} · last 8 weeks · aggregate only</p>
        </div>
        <Badge variant="outline">Sample data</Badge>
      </div>
      {view === 'features' && <FeatureUsage />}
      {view === 'pulse' && <Pulse />}
      {view === 'ai' && <AiAnalytics />}
      {view === 'ux' && <Ux />}
    </div>
  )
}

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function FeatureUsage() {
  const features = ['Elevate', 'Replay', 'Prepare', 'Interviews'] as const
  return (
    <>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {SAMPLE_FEATURE_USAGE.map((f) => (
          <MetricCard key={f.feature} label={f.feature} value={f.sessions} sublabel={`${f.activeLearners} active learners · ${f.avgActiveMinutes} min avg`} />
        ))}
      </div>
      <ChartCard title="Weekly sessions by feature" description="Sample organization, sessions started per week.">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={SAMPLE_WEEKLY_SESSIONS}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-xs" />
            <YAxis className="text-xs" allowDecimals={false} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {features.map((f, i) => <Bar key={f} dataKey={f} stackId="s" fill={SERIES_COLORS[i]} />)}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Completion">
        <SimpleTable
          head={['Feature', 'Active learners', 'Sessions', 'Completed']}
          rows={SAMPLE_FEATURE_USAGE.map((f) => [f.feature, f.activeLearners, f.sessions, pct(f.completionRate)])}
        />
      </ChartCard>
    </>
  )
}

function Pulse() {
  return (
    <>
      <ChartCard title="Average score over time" description="Sample cohort average across all skills (1–10).">
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={SAMPLE_PULSE_TREND}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="name" className="text-xs" />
            <YAxis className="text-xs" domain={[4, 8]} />
            <Tooltip contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="average" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Skills: first vs latest session" description="Learners with eligible scores only. Individual learner views are not part of the demo.">
        <SimpleTable
          head={['Skill', 'First', 'Latest', 'Change', 'Learners']}
          rows={SAMPLE_PULSE_SKILLS.map((s) => [s.skill, s.first.toFixed(1), s.latest.toFixed(1), `+${(s.latest - s.first).toFixed(1)}`, s.learners])}
        />
      </ChartCard>
    </>
  )
}

function AiAnalytics() {
  return (
    <>
      <p className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        <Sparkles className="h-4 w-4 shrink-0" />
        Example questions with sample answers. Asking new questions, saved queries and individual learner results are not available in the demo.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {SAMPLE_AI_ANSWERS.map((a) => (
          <Card key={a.question}>
            <CardHeader className="pb-2"><CardTitle className="text-base">{a.question}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{a.answer}</p>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                {a.figures.map((f) => (
                  <div key={f.label} className="rounded border p-2"><dt className="text-xs text-muted-foreground">{f.label}</dt><dd className="font-semibold">{f.value}</dd></div>
                ))}
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}

function Ux() {
  return (
    <>
      <ChartCard title="Page views" description="Sample organization, last 8 weeks.">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={SAMPLE_UX_PAGES} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" className="text-xs" />
            <YAxis type="category" dataKey="page" className="text-xs" width={110} />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="views" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Practice funnel">
          <SimpleTable head={['Step', 'Learners']} rows={SAMPLE_UX_FUNNEL.map((f) => [f.step, f.learners])} />
        </ChartCard>
        <ChartCard title="Median time on page">
          <SimpleTable head={['Page', 'Median']} rows={SAMPLE_UX_PAGES.map((p) => [p.page, p.medianSeconds >= 60 ? `${Math.round(p.medianSeconds / 60)} min` : `${p.medianSeconds} s`])} />
        </ChartCard>
      </div>
    </>
  )
}

function SimpleTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/50">{head.map((h) => <th key={h} className="px-4 py-2 text-left font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={String(row[0])} className="border-b last:border-0">
              {row.map((cell, i) => <td key={i} className={i === 0 ? 'px-4 py-2 font-medium' : 'px-4 py-2 text-muted-foreground'}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
