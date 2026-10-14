import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiClient } from '@/lib/api-client'
import { analyticsQueryFromSearch, analyticsQueryToSearch, viewState, type AnalyticsQuery } from '@/lib/adminAnalytics'
import { AnalyticsFilters } from '@/components/admin/AnalyticsFilters'
import { AnalyticsStatus } from '@/components/admin/AnalyticsStatus'
import { MetricCard } from '@/components/admin/MetricCard'
import { LanguageAnalytics, type LanguageSnapshot } from '@/components/admin/LanguageAnalytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

type Cohort = { bucket?: string; users: number | null; suppressed: boolean; averageScore?: number | null }
type Report = {
  coverage: { canonical: string; engagement: string }
  summary: { users: number | null; suppressed: boolean; entries?: number; sessions?: number }
  skills: Array<{ skill: string; entries: number; users: number | null; suppressed: boolean; average?: number | null; median?: number | null }>
  movement: Array<{ skill?: string; users: number | null; suppressed: boolean; improving?: number; stable?: number; declining?: number; averageDelta?: number | null }>
  distribution: Array<{ skill?: string; users: number | null; suppressed: boolean; bands?: Array<{ label: string; count: number }> }>
  decisions: Array<{ source: string; tracked: number; skipped: number; undecided: number; users: number }>
  profileCompleteness: { learners: number; gender: number; dateOfBirth: number; pincode: number }
  language: LanguageSnapshot[]
  cohorts: { gender: Cohort[]; ageBand: Cohort[]; state: Cohort[] }
  trends: Array<{ day: string; skill: string; average: number | null }>
}

function CohortList({ title, rows }: { title: string; rows: Cohort[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">No grouped scores in this range.</p>}
        {rows.map((row) => (
          <div key={`${title}-${row.bucket}`} className="flex items-center justify-between gap-3 border-b py-2 last:border-0">
            <span>{row.bucket}</span>
            {row.suppressed ? <span className="text-muted-foreground">Hidden, fewer than 5 learners</span> : <span>{row.averageScore ?? '—'} avg · {row.users} learners</span>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

export function ProgressPulseAnalytics() {
  const [params, setParams] = useSearchParams()
  const query = analyticsQueryFromSearch(params)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const search = analyticsQueryToSearch(analyticsQueryFromSearch(params))
    setLoading(true)
    setError(null)
    apiClient<Report>(`/api/admin/analytics/progress-pulse?${search}`)
      .then(setReport)
      .catch((err: Error) => setError(err.message || 'Failed'))
      .finally(() => setLoading(false))
  }, [params, reload])

  const update = (next: AnalyticsQuery) => setParams(analyticsQueryToSearch(next))
  const state = viewState(loading, error, !report || ((report.summary.entries ?? 0) === 0 && report.decisions.every((row) => row.tracked + row.skipped + row.undecided === 0)))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Progress Pulse</h1>
        <p className="text-muted-foreground">Joint learner progress, with small demographic groups hidden.</p>
      </div>
      <AnalyticsFilters query={query} onChange={update} showPulse />
      {report && <p className="text-xs text-muted-foreground">{report.coverage.canonical}</p>}
      <AnalyticsStatus state={state === 'ready' ? 'ready' : state} onRetry={() => setReload((value) => value + 1)} />
      {report && state !== 'loading' && state !== 'error' && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Learners with scores" value={report.summary.suppressed ? 'Hidden' : report.summary.users ?? 0} sublabel={report.summary.suppressed ? 'Filter matches fewer than 5 learners' : 'Eligible Pulse rows'} />
            <MetricCard label="Score entries" value={report.summary.suppressed ? '—' : report.summary.entries ?? 0} />
            <MetricCard label="Sessions represented" value={report.summary.suppressed ? '—' : report.summary.sessions ?? 0} />
            <MetricCard label="Profiles with gender" value={`${report.profileCompleteness.gender}/${report.profileCompleteness.learners}`} sublabel={`${report.profileCompleteness.dateOfBirth} with date of birth`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {report.decisions.map((row) => (
              <Card key={row.source}>
                <CardHeader><CardTitle className="text-base capitalize">{row.source} decisions</CardTitle></CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {row.tracked} tracked · {row.skipped} skipped · {row.undecided} not chosen · {row.users} learners
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">Skill level</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {report.skills.map((skill) => (
                <div key={skill.skill} className="grid gap-1 border-b pb-3 text-sm last:border-0 sm:grid-cols-4">
                  <span className="font-medium capitalize">{skill.skill.replaceAll('_', ' ')}</span>
                  <span>{skill.suppressed ? 'Hidden' : `Avg ${skill.average ?? '—'}`}</span>
                  <span>{skill.suppressed ? '' : `Median ${skill.median ?? '—'}`}</span>
                  <span className="text-muted-foreground">{skill.entries} entries</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Movement from first to latest score</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {report.movement.length === 0 && <p className="text-muted-foreground">Movement needs two scores for the same learner and skill.</p>}
              {report.movement.map((row) => (
                <div key={row.skill} className="flex justify-between gap-3 border-b py-2 last:border-0">
                  <span className="capitalize">{row.skill?.replaceAll('_', ' ')}</span>
                  {row.suppressed ? <span>Hidden</span> : <span>{row.improving} improving · {row.stable} stable · {row.declining} declining · delta {row.averageDelta ?? '—'}</span>}
                </div>
              ))}
            </CardContent>
          </Card>
          {report.trends.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Daily average for {report.trends[0]?.skill.replaceAll('_', ' ')}, groups of 5 or more</CardTitle></CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={report.trends.filter((row) => row.skill === report.trends[0]?.skill)}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" className="text-xs" />
                    <YAxis domain={[0, 10]} className="text-xs" />
                    <Tooltip />
                    <Line dataKey="average" name={report.trends[0]?.skill || 'score'} stroke="hsl(var(--primary))" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          <LanguageAnalytics rows={report.language ?? []} />
          <div className="grid gap-4 lg:grid-cols-3">
            <CohortList title="Gender" rows={report.cohorts.gender} />
            <CohortList title="Age" rows={report.cohorts.ageBand} />
            <CohortList title="State" rows={report.cohorts.state} />
          </div>
          <Accordion type="single" collapsible>
            <AccordionItem value="distribution">
              <AccordionTrigger>Score distribution</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {report.distribution.map((row) => (
                  <div key={row.skill}>
                    <p className="mb-1 text-sm font-medium capitalize">{row.skill?.replaceAll('_', ' ')}</p>
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {row.suppressed ? 'Hidden' : row.bands?.map((band) => <span key={band.label}>{band.label}: {band.count}</span>)}
                    </div>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </div>
  )
}
