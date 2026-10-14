import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MetricCard } from '@/components/admin/MetricCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { chartsForResult, cohortSizeLabel, formatMetricValue, formatTimestamp } from './format'
import type { AnalyticsResult, CohortResult } from './types'

const SERIES_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

function CohortCards({ cohorts, threshold }: { cohorts: CohortResult[]; threshold: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cohorts.flatMap((cohort) => cohort.metrics.map((metric) => (
        <MetricCard
          key={`${cohort.id}-${metric.key}`}
          label={metric.label}
          value={metric.value == null ? (cohort.suppressed ? 'Hidden' : '—') : formatMetricValue(metric.value, metric.unit)}
          sublabel={cohortSizeLabel(cohort, threshold)}
        />
      )))}
    </div>
  )
}

export function ExplorerResults({
  title,
  result,
  refreshing,
}: {
  title: string
  result: AnalyticsResult
  refreshing: boolean
}) {
  const charts = chartsForResult(result)
  const suppressed = result.cohorts.filter((cohort) => cohort.suppressed)
  const threshold = result.privacyThreshold

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">Updated {formatTimestamp(result.executedAt)}</p>
        </div>
        {refreshing && <p className="text-xs text-muted-foreground">Refreshing saved plan...</p>}
      </div>
      <p className="text-xs text-muted-foreground">
        Demographic groups smaller than {threshold} learners are hidden.
      </p>
      {result.cohorts.length > 1 ? (
        <Tabs defaultValue="all">
          <TabsList className="flex h-auto flex-wrap">
            <TabsTrigger value="all">All cohorts</TabsTrigger>
            {result.cohorts.map((cohort) => (
              <TabsTrigger key={cohort.id} value={cohort.id}>{cohort.label}</TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="all">
            <CohortCards cohorts={result.cohorts} threshold={threshold} />
          </TabsContent>
          {result.cohorts.map((cohort) => (
            <TabsContent key={cohort.id} value={cohort.id}>
              <CohortCards cohorts={[cohort]} threshold={threshold} />
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <CohortCards cohorts={result.cohorts} threshold={threshold} />
      )}
      {charts.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            {suppressed.length
              ? 'Nothing to chart because every matching group is below the privacy threshold.'
              : 'No measured values for this question yet.'}
          </CardContent>
        </Card>
      ) : charts.map((chart) => (
        <Card key={chart.unit}>
          <CardHeader>
            <CardTitle className="text-base">{chart.title}</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart.rows} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="metric" className="text-xs" interval={0} tick={{ fontSize: 12 }} />
                <YAxis className="text-xs" width={48} allowDecimals={chart.unit !== 'learners'} />
                <Tooltip />
                {result.cohorts.length > 1 && <Legend />}
                {result.cohorts.map((cohort, index) => (
                  <Bar
                    key={cohort.id}
                    dataKey={cohort.id}
                    name={cohort.label}
                    fill={SERIES_COLORS[index % SERIES_COLORS.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
          {suppressed.length > 0 && (
            <CardContent className="pt-0 text-xs text-muted-foreground">
              {suppressed.map((cohort) => cohort.label).join(', ')} hidden because the group is smaller than {threshold} learners.
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
