import { useEffect, useState } from 'react'
import { useTenantDemo } from '@/contexts/TenantDemoContext'
import { TenantDemoAnalytics } from '@/components/admin/TenantDemoAnalytics'
import { useSearchParams } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AnalyticsFilters } from '@/components/admin/AnalyticsFilters'
import { AnalyticsStatus } from '@/components/admin/AnalyticsStatus'
import { MetricCard } from '@/components/admin/MetricCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { apiClient } from '@/lib/api-client'
import {
  analyticsQueryFromSearch,
  analyticsQueryToSearch,
  formatDuration,
  viewState,
  type AnalyticsQuery,
} from '@/lib/adminAnalytics'
import { clarityDashboardUrl, clarityProjectId } from '@/lib/clarity'

type PageViewReport = {
  coverage: { firstParty: string; clarity: string }
  summary: {
    views: number | null
    users: number | null
    routes: number | null
    viewsPerUser: number | null
    suppressed: boolean
  }
  routes: Array<{
    path: string
    views: number
    users: number
    exits: number
    medianActiveMs: number | null
    p75ActiveMs: number | null
  }>
  trends: Array<{ day: string; views: number; users: number }>
  privacyThreshold: number
}

export function UxAnalytics() {
  // The Tenant Admin demo never loads platform analytics: it shows labelled sample organization data.
  const { enabled } = useTenantDemo()
  return enabled ? <TenantDemoAnalytics view="ux" /> : <PlatformUxAnalytics />
}

function PlatformUxAnalytics() {
  const [params, setParams] = useSearchParams()
  const query = analyticsQueryFromSearch(params)
  const [report, setReport] = useState<PageViewReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const clarityUrl = clarityDashboardUrl()
  const clarityConfigured = Boolean(clarityProjectId())

  useEffect(() => {
    setLoading(true)
    setError(null)
    apiClient<PageViewReport>(`/api/admin/analytics/page-views?${analyticsQueryToSearch(analyticsQueryFromSearch(params))}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message || 'Failed'))
      .finally(() => setLoading(false))
  }, [params, reload])

  const update = (next: AnalyticsQuery) => setParams(analyticsQueryToSearch(next))
  const state = viewState(loading, error, !report || report.summary.views === 0)
  const routes = (report?.routes ?? []).slice(0, 12)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">UX Analytics</h1>
          <p className="text-muted-foreground">First-party page views inside SpashtAI, with Clarity for recordings and heatmaps.</p>
        </div>
        {clarityUrl && (
          <Button asChild variant="outline">
            <a href={clarityUrl} target="_blank" rel="noreferrer">
              Open Microsoft Clarity
              <ExternalLink className="ml-2 h-4 w-4" />
            </a>
          </Button>
        )}
      </div>

      <AnalyticsFilters query={query} onChange={update} />

      <Card className={clarityConfigured ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}>
        <CardContent className="py-4 text-sm">
          <p className="font-medium">{clarityConfigured ? 'Microsoft Clarity tracking is configured' : 'Microsoft Clarity tracking is not configured in this build'}</p>
          <p className="mt-1 text-muted-foreground">
            Clarity runs only after learner consent and never records admin pages. Microsoft does not support embedding its general dashboard here, so recordings and heatmaps open in Clarity.
          </p>
        </CardContent>
      </Card>

      {report && <p className="text-xs text-muted-foreground">{report.coverage.firstParty}</p>}
      <AnalyticsStatus state={state === 'ready' ? 'ready' : state} onRetry={() => setReload((value) => value + 1)} />

      {report && state !== 'loading' && state !== 'error' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Page views" value={report.summary.suppressed ? 'Hidden' : report.summary.views ?? 0} sublabel="Authenticated learner views" />
            <MetricCard label="Unique learners" value={report.summary.suppressed ? 'Hidden' : report.summary.users ?? 0} sublabel={report.summary.suppressed ? `Fewer than ${report.privacyThreshold} learners` : 'Admin traffic excluded'} />
            <MetricCard label="Routes viewed" value={report.summary.suppressed ? '—' : report.summary.routes ?? 0} />
            <MetricCard label="Views per learner" value={report.summary.suppressed ? '—' : report.summary.viewsPerUser ?? '—'} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Page-view trend</CardTitle>
              <p className="text-xs text-muted-foreground">Daily views and distinct learners.</p>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={report.trends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" />
                  <YAxis yAxisId="views" allowDecimals={false} />
                  <YAxis yAxisId="users" orientation="right" allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="views" dataKey="views" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="users" dataKey="users" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Most-viewed routes</CardTitle>
                <p className="text-xs text-muted-foreground">Top routes by first-party page views.</p>
              </CardHeader>
              <CardContent className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={routes} layout="vertical" margin={{ left: 24, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis type="category" dataKey="path" width={132} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="views" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="users" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Active time by route</CardTitle>
                <p className="text-xs text-muted-foreground">Visible, non-idle foreground time. Routes without page-exit samples remain blank.</p>
              </CardHeader>
              <CardContent className="h-96">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={routes.map((row) => ({
                      ...row,
                      medianActiveSeconds: row.medianActiveMs == null ? null : Math.round(row.medianActiveMs / 1000),
                    }))}
                    layout="vertical"
                    margin={{ left: 24, right: 16 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                    <XAxis type="number" unit="s" />
                    <YAxis type="category" dataKey="path" width={132} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [formatDuration(Number(value) * 1000), 'Median active time']} />
                    <Bar dataKey="medianActiveSeconds" name="Median active time" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
