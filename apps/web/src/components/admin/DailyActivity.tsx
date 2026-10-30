import { Fragment, useEffect, useState } from 'react'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiClient } from '@/lib/api-client'
import { ACTIVITY_FEATURES, activityFeatureLabel, analyticsQueryToSearch, formatDuration, type AnalyticsQuery } from '@/lib/adminAnalytics'
import { AnalyticsStatus } from '@/components/admin/AnalyticsStatus'
import { rangeLabel, type ReportRange } from '@/components/admin/LearnerProgress'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

type Measures = { pageViews: number | null; actions: number | null; starts: number | null; completions: number | null; activeMs: number | null }
type FeatureDay = Measures & { feature: string; activeLearners: number }
export type ActivityDay = Measures & {
  day: string
  activeLearners: number
  notRecorded: Record<keyof Measures, string[]>
  pulseEntries: number
  pulseSessions: number
  features: FeatureDay[]
}
export type DailyActivityReport = {
  mode: 'aggregate' | 'individual'
  scope: {
    timeZone: string
    activity: { features: string[]; note: string }
    pulse: { sources: string[]; skills: string[]; note: string }
    learners: string
    excludes: string
  }
  threshold: number
  recordedSince: Record<string, Record<keyof Measures, string | null>>
  definitions: {
    measures: Record<string, string>
    features: Record<string, { actions: string[]; start: string | null; completion: string | null }>
  }
} & ({ suppressed: true; days: null; totals: null } | {
  suppressed: false
  days: ActivityDay[]
  totals: Measures & { activeLearners: number; byFeature: Array<{ feature: string; activeLearners: number }>; pulseEntries: number; pulseSessions: number; pulseLearners: number }
})
type Response = { range: ReportRange; activity: DailyActivityReport | null; match?: { matches: boolean } }

const PAGE = 10
const NOT_RECORDED = 'Not recorded'

function count(value: number | null) {
  return value === null ? NOT_RECORDED : value.toLocaleString('en-IN')
}

function time(value: number | null) {
  return value === null ? NOT_RECORDED : value === 0 ? '0' : formatDuration(value)
}

/** Effective scope of each section, so a feature filter is never read as narrowing Pulse evidence (or vice versa). */
export function activityScopeLabel(report: DailyActivityReport) {
  const features = report.scope.activity.features.length === ACTIVITY_FEATURES.length
    ? 'all features'
    : report.scope.activity.features.map(activityFeatureLabel).join(', ')
  const sources = report.scope.pulse.sources.length ? report.scope.pulse.sources.map(activityFeatureLabel).join(' and ') : 'no source'
  const skills = report.scope.pulse.skills.length ? report.scope.pulse.skills.join(', ') : 'all skills'
  return { activity: `Activity: ${features} · ${report.scope.learners}`, pulse: `Pulse entries: ${sources}, ${skills}` }
}

export function DailyActivityTable({ report, pulseHref }: { report: DailyActivityReport & { suppressed: false }; pulseHref: string }) {
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const individual = report.mode === 'individual'
  const days = [...report.days].reverse()
  const pages = Math.max(1, Math.ceil(days.length / PAGE))
  const visible = days.slice(page * PAGE, page * PAGE + PAGE)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Date</th>
              <th className="pr-3">{individual ? 'Active' : 'Active learners'}</th>
              <th className="pr-3">Page views</th>
              <th className="pr-3">Actions</th>
              <th className="pr-3">Starts</th>
              <th className="pr-3">Completions</th>
              <th className="pr-3">Active time</th>
              <th>Pulse entries</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {visible.map((row) => (
              <Fragment key={row.day}>
                <tr>
                  <td className="py-2 pr-3">
                    <button type="button" className="font-medium underline-offset-2 hover:underline" aria-expanded={open === row.day}
                      onClick={() => setOpen(open === row.day ? null : row.day)}>
                      {open === row.day ? '▾' : '▸'} {row.day}
                    </button>
                  </td>
                  <td className="pr-3">{individual ? (row.activeLearners ? 'Yes' : '—') : row.activeLearners}</td>
                  <td className="pr-3">{count(row.pageViews)}</td>
                  <td className="pr-3">{count(row.actions)}</td>
                  <td className="pr-3">{count(row.starts)}</td>
                  <td className="pr-3">{count(row.completions)}</td>
                  <td className="pr-3">{time(row.activeMs)}</td>
                  <td>
                    {row.pulseEntries > 0
                      ? <a className="text-primary underline-offset-2 hover:underline" href={pulseHref}>{row.pulseEntries} in {row.pulseSessions} session{row.pulseSessions === 1 ? '' : 's'}</a>
                      : '0'}
                  </td>
                </tr>
                {open === row.day && row.features.map((feature) => (
                  <tr key={`${row.day}:${feature.feature}`} className="bg-muted/40 text-xs">
                    <td className="py-1 pl-6 pr-3">{activityFeatureLabel(feature.feature)}</td>
                    <td className="pr-3">{individual ? (feature.activeLearners ? 'Yes' : '—') : feature.activeLearners}</td>
                    <td className="pr-3">{count(feature.pageViews)}</td>
                    <td className="pr-3">{count(feature.actions)}</td>
                    <td className="pr-3">{report.definitions.features[feature.feature]?.start ? count(feature.starts) : 'n/a'}</td>
                    <td className="pr-3">{report.definitions.features[feature.feature]?.completion ? count(feature.completions) : 'n/a'}</td>
                    <td className="pr-3">{time(feature.activeMs)}</td>
                    <td />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Newer</Button>
          <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Older</Button>
        </div>
      )}
    </div>
  )
}

export function DailyActivity({ query, onChange, pulseHref }: { query: AnalyticsQuery; onChange: (next: AnalyticsQuery) => void; pulseHref: string }) {
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const search = analyticsQueryToSearch(query)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    apiClient<Response>(`/api/admin/analytics/activity/daily?${search}`)
      .then((body) => { if (active) setData(body) })
      .catch((err: Error) => { if (active) setError(err.message || 'Failed') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, reload])

  const report = data?.activity ?? null
  const individual = Boolean(query.learner)
  return (
    <Card id="daily-activity">
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">Day-wise activity</CardTitle>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Activity feature">
          <Button type="button" size="sm" variant={!query.feature ? 'default' : 'outline'} onClick={() => onChange({ ...query, feature: '' })}>All features</Button>
          {ACTIVITY_FEATURES.map((feature) => (
            <Button key={feature.id} type="button" size="sm" variant={query.feature === feature.id ? 'default' : 'outline'}
              onClick={() => onChange({ ...query, feature: feature.id })}>{feature.label}</Button>
          ))}
        </div>
        {data && report && (
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p>{rangeLabel(data.range)}</p>
            <p>{activityScopeLabel(report).activity}. {report.scope.activity.note}</p>
            <p>{activityScopeLabel(report).pulse}. {report.scope.pulse.note}</p>
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? <AnalyticsStatus state="loading" /> : error ? <AnalyticsStatus state="error" onRetry={() => setReload((value) => value + 1)} /> : !report ? (
          <p className="text-sm text-muted-foreground">No activity is shown because the selected filters exclude this learner.</p>
        ) : report.suppressed ? (
          <p className="text-sm text-muted-foreground">Hidden: the demographic filters match fewer than {report.threshold} learners.</p>
        ) : (
          <>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={report.days}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="actions" name="Actions" fill="hsl(var(--chart-1))" />
                  <Bar dataKey="starts" name="Starts" fill="hsl(var(--chart-2))" />
                  <Bar dataKey="completions" name="Completions" fill="hsl(var(--chart-3))" />
                  {!individual && <Line dataKey="activeLearners" name="Active learners" stroke="hsl(var(--chart-5))" strokeWidth={2} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
              {report.totals.activeLearners} {individual ? 'active learner' : 'distinct active learners'} · {count(report.totals.actions)} actions · {count(report.totals.starts)} starts ·
              {' '}{count(report.totals.completions)} completions · {report.totals.pulseEntries} Pulse entries in {report.totals.pulseSessions} sessions.
              {' '}“{NOT_RECORDED}” marks days before a measure existed; it is not zero.
            </p>
            <DailyActivityTable report={report} pulseHref={pulseHref} />
            <Accordion type="single" collapsible>
              <AccordionItem value="definitions">
                <AccordionTrigger>What each measure counts</AccordionTrigger>
                <AccordionContent className="space-y-3 text-xs">
                  <ul className="space-y-1">
                    {Object.entries(report.definitions.measures).map(([key, text]) => <li key={key}><span className="font-medium">{key}</span>: {text}</li>)}
                  </ul>
                  <ul className="space-y-1">
                    {Object.entries(report.definitions.features).map(([feature, def]) => (
                      <li key={feature}>
                        <span className="font-medium">{activityFeatureLabel(feature)}</span>: actions {def.actions.join(', ') || 'none'};
                        {' '}start {def.start ?? 'not applicable'}; completion {def.completion ?? 'not applicable'}.
                      </li>
                    ))}
                  </ul>
                  <p className="text-muted-foreground">{report.scope.excludes}</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </>
        )}
      </CardContent>
    </Card>
  )
}
