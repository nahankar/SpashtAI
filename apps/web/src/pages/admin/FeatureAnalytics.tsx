import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiClient } from '@/lib/api-client'
import { analyticsQueryFromSearch, analyticsQueryToSearch, formatDuration, viewState, type AnalyticsQuery } from '@/lib/adminAnalytics'
import { AnalyticsFilters } from '@/components/admin/AnalyticsFilters'
import { AnalyticsStatus } from '@/components/admin/AnalyticsStatus'
import { MetricCard } from '@/components/admin/MetricCard'
import { LanguageAnalytics, type LanguageSnapshot } from '@/components/admin/LanguageAnalytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const FEATURES = [
  { id: 'replay', label: 'Replay' },
  { id: 'elevate', label: 'Elevate' },
  { id: 'interviews', label: 'Interviews' },
  { id: 'progress_pulse', label: 'Progress Pulse' },
  { id: 'prepare', label: 'Prepare' },
  { id: 'feedback', label: 'Feedback' },
] as const

type Summary = {
  events: number
  uniqueUsers: number
  firstTime: number
  returning: number
  averageDailyUsers: number | null
  stickiness: number | null
  medianActiveMs: number | null
  p75ActiveMs: number | null
  activeTimeStatus: string
}
type FunnelStep = { action: string; label: string; users: number | null; events: number | null; status: string }
type Report = {
  coverage: { canonical: string; engagement: string; historical: string }
  enabledFeatures: string[]
  summary: Record<string, Summary>
  funnels: Record<string, FunnelStep[]>
  trends: Array<{ day: string; feature: string; users: number; events: number }>
  retention: Array<{ feature: string; status: string; cohort: number | null; returned: number | null }>
  canonical: Record<string, Record<string, number | string | null>>
  language: LanguageSnapshot[]
}

function readable(value: string) {
  return value.replaceAll('_', ' ')
}

function CanonicalList({ data }: { data: Record<string, number | string | null> | undefined }) {
  const entries = Object.entries(data ?? {})
  if (!entries.length) return <p className="text-sm text-muted-foreground">No retained records in this range.</p>
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="flex justify-between gap-3 border-b py-2 text-sm">
          <span className="text-muted-foreground">{readable(key)}</span>
          <span>{value == null ? 'Not recorded yet' : String(value)}</span>
        </div>
      ))}
    </div>
  )
}

export function FeatureAnalytics() {
  const [params, setParams] = useSearchParams()
  const query = analyticsQueryFromSearch(params)
  const feature = FEATURES.some((item) => item.id === query.feature) ? query.feature : 'replay'
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiClient<Report>(`/api/admin/analytics/features/report?${analyticsQueryToSearch(analyticsQueryFromSearch(params))}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message || 'Failed'))
      .finally(() => setLoading(false))
  }, [params, reload])

  const update = (next: AnalyticsQuery) => setParams(analyticsQueryToSearch(next))
  const summary = report?.summary[feature]
  const canonical = feature === 'progress_pulse' ? undefined : report?.canonical[feature]
  const hasCanonical = Boolean(canonical && Object.values(canonical).some((value) => Number(value) > 0))
  const state = viewState(loading, error, !summary || (summary.events === 0 && !hasCanonical))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Feature usage</h1>
        <p className="text-muted-foreground">What learners finished, how long they stayed active, and where a step has no sample yet.</p>
      </div>
      <AnalyticsFilters query={{ ...query, feature }} onChange={update} />
      <Tabs value={feature} onValueChange={(value) => update({ ...query, feature: value })}>
        <TabsList className="flex h-auto flex-wrap">
          {FEATURES.map((item) => <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>)}
        </TabsList>
        {FEATURES.map((item) => <TabsContent key={item.id} value={item.id} />)}
      </Tabs>
      {report && (
        <p className="text-xs text-muted-foreground">{report.coverage.engagement} {report.coverage.historical}</p>
      )}
      <AnalyticsStatus state={state === 'ready' ? 'ready' : state} onRetry={() => setReload((value) => value + 1)} />
      {report && summary && state !== 'loading' && state !== 'error' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Unique learners" value={summary.uniqueUsers} sublabel={`${summary.firstTime} first time · ${summary.returning} returning`} />
            <MetricCard label="Events" value={summary.events} sublabel={report.enabledFeatures.includes(feature) || feature === 'feedback' || feature === 'progress_pulse' ? 'Stored product events' : 'Feature flag is off; retained rows still show below'} />
            <MetricCard label="Median active time" value={summary.activeTimeStatus === 'recorded' ? formatDuration(summary.medianActiveMs) : 'Not recorded yet'} sublabel={summary.p75ActiveMs != null ? `75th percentile ${formatDuration(summary.p75ActiveMs)}` : 'Page-exit timing starts with this release'} />
            <MetricCard label="Daily users / stickiness" value={summary.averageDailyUsers ?? '—'} sublabel={summary.stickiness == null ? 'Needs activity in the range' : `${Math.round(summary.stickiness * 100)}% of period users on an average day`} />
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Milestone reach</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {(report.funnels[feature] ?? []).map((step) => (
                <div key={step.action} className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-0">
                  <span>{step.label}</span>
                  <span className="text-muted-foreground">{step.status === 'not_yet_recorded' ? 'Not recorded yet' : `${step.users} learners · ${step.events} events`}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Retained product detail</CardTitle></CardHeader>
            <CardContent>
              <CanonicalList data={feature === 'progress_pulse' ? undefined : report.canonical[feature]} />
              {feature === 'progress_pulse' && <p className="mt-3 text-sm text-muted-foreground">Score movement stays on the Progress Pulse dashboard. This tab measures who opened, tracked, or skipped it.</p>}
            </CardContent>
          </Card>
          {(feature === 'elevate' || feature === 'replay' || feature === 'progress_pulse') && (
            <LanguageAnalytics rows={(report.language ?? []).filter((row) => feature === 'progress_pulse' || row.source === feature)} />
          )}
          <Card>
            <CardHeader><CardTitle className="text-base">Daily events</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report.trends.filter((row) => row.feature === feature)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis className="text-xs" />
                  <Tooltip />
                  <Bar dataKey="events" fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Week-one return</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {(() => {
                const row = report.retention.find((item) => item.feature === feature)
                if (!row || row.status === 'insufficient_range') return 'Choose 90 days to compare the first week with the following week.'
                if (row.status === 'suppressed') return 'Hidden because the first-week cohort is smaller than 5 learners.'
                return `${row.returned} of ${row.cohort} first-week learners came back during the next week.`
              })()}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
