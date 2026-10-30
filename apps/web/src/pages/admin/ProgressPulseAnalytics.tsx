import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ApiError, apiClient } from '@/lib/api-client'
import { analyticsQueryFromSearch, analyticsQueryToSearch, viewState, type AnalyticsQuery } from '@/lib/adminAnalytics'
import { AnalyticsFilters } from '@/components/admin/AnalyticsFilters'
import { LearnerSelector } from '@/components/admin/LearnerSelector'
import { LearnerProgress, NoLearnerMatch, rangeLabel, skillLabel, type IndividualPulseResponse, type ReportRange } from '@/components/admin/LearnerProgress'
import { Button } from '@/components/ui/button'
import { DailyActivity } from '@/components/admin/DailyActivity'
import { AnalyticsStatus } from '@/components/admin/AnalyticsStatus'
import { MetricCard } from '@/components/admin/MetricCard'
import { LanguageAnalytics, type LanguageSnapshot } from '@/components/admin/LanguageAnalytics'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'

type Cohort = { bucket?: string; users: number | null; suppressed: boolean; averageScore?: number | null }
type Report = {
  range: ReportRange
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

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
]

function CohortChart({ title, rows }: { title: string; rows: Cohort[] }) {
  const visible = rows.filter((row) => !row.suppressed)
  const hidden = rows.length - visible.length
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">No publishable grouped scores in this range.</p>
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visible} layout="vertical" margin={{ left: 16, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                <XAxis type="number" domain={[0, 10]} />
                <YAxis type="category" dataKey="bucket" width={92} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, _name, item) => [`${value} avg · ${item.payload.users} learners`, 'Score']} />
                <Bar dataKey="averageScore" fill="hsl(var(--chart-2))" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {hidden > 0 && <p className="mt-2 text-xs text-muted-foreground">{hidden} group{hidden === 1 ? '' : 's'} hidden below 5 learners.</p>}
      </CardContent>
    </Card>
  )
}

export function ProgressPulseAnalytics() {
  const [params, setParams] = useSearchParams()
  const query = analyticsQueryFromSearch(params)
  const [report, setReport] = useState<Report | null>(null)
  const [individual, setIndividual] = useState<IndividualPulseResponse | null>(null)
  const [missingLearner, setMissingLearner] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const current = analyticsQueryFromSearch(params)
    const search = analyticsQueryToSearch(current)
    let active = true
    setLoading(true)
    setError(null)
    setMissingLearner(false)
    const request = current.learner
      ? apiClient<IndividualPulseResponse>(`/api/admin/analytics/progress-pulse?${search}`).then((body) => { if (active) { setIndividual(body); setReport(null) } })
      : apiClient<Report>(`/api/admin/analytics/progress-pulse?${search}`).then((body) => { if (active) { setReport(body); setIndividual(null) } })
    request
      .catch((err: Error) => {
        if (!active) return
        if (err instanceof ApiError && err.status === 404 && err.code === 'learner_not_found') setMissingLearner(true)
        else setError(err.message || 'Failed')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [params, reload])

  const update = (next: AnalyticsQuery) => setParams(analyticsQueryToSearch(next))
  const selectLearner = (learner: string) => update({ ...query, learner })
  const state = viewState(loading, error, !report || ((report.summary.entries ?? 0) === 0 && report.decisions.every((row) => row.tracked + row.skipped + row.undecided === 0)))
  const trendSkills = [...new Set((report?.trends ?? []).map((row) => row.skill))]
  const trendData = [...new Set((report?.trends ?? []).map((row) => row.day))].map((day) => ({
    day,
    ...Object.fromEntries((report?.trends ?? []).filter((row) => row.day === day).map((row) => [row.skill, row.average])),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Progress Pulse</h1>
        <p className="text-muted-foreground">
          {query.learner ? 'One learner\'s progress, shown to authorized admins. Access is audited.' : 'Joint learner progress, with small demographic groups hidden.'}
        </p>
      </div>
      <LearnerSelector selectedId={query.learner} selected={individual?.learner ?? null} onSelect={selectLearner} />
      <AnalyticsFilters query={query} onChange={update} showPulse />
      {query.learner ? (
        loading ? <AnalyticsStatus state="loading" /> : error ? <AnalyticsStatus state="error" onRetry={() => setReload((value) => value + 1)} /> : missingLearner ? (
          <div className="space-y-3 rounded-lg border p-6">
            <p className="font-medium">No learner account matches this selection.</p>
            <p className="text-sm text-muted-foreground">It may have been removed, or it is not a learner account.</p>
            <Button type="button" size="sm" variant="outline" onClick={() => selectLearner('')}>Clear selection</Button>
          </div>
        ) : individual && (individual.report
          ? <LearnerProgress key={individual.learner.id} data={{ ...individual, report: individual.report }} />
          : <NoLearnerMatch excludedBy={individual.match.excludedBy} onClearFilters={() => update({ ...query, city: [], state: [], gender: [], ageBand: [] })} />)
      ) : (
      <>
      {report && <p className="text-xs text-muted-foreground">{rangeLabel(report.range)} · {report.coverage.canonical}</p>}
      <AnalyticsStatus state={state === 'ready' ? 'ready' : state} onRetry={() => setReload((value) => value + 1)} />
      {report && state !== 'loading' && state !== 'error' && (
        <>
          <div id="pulse-summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Learners with scores" value={report.summary.suppressed ? 'Hidden' : report.summary.users ?? 0} sublabel={report.summary.suppressed ? 'Filter matches fewer than 5 learners' : 'Eligible Pulse rows'} />
            <MetricCard label="Score entries" value={report.summary.suppressed ? '—' : report.summary.entries ?? 0} />
            <MetricCard label="Sessions represented" value={report.summary.suppressed ? '—' : report.summary.sessions ?? 0} />
            <MetricCard label="Profiles with gender" value={`${report.profileCompleteness.gender}/${report.profileCompleteness.learners}`} sublabel={`${report.profileCompleteness.dateOfBirth} with date of birth`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Tracking decisions</CardTitle>
                <p className="text-xs text-muted-foreground">What happened after eligible Elevate and Replay sessions.</p>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.decisions}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-muted" />
                    <XAxis dataKey="source" className="capitalize" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="tracked" stackId="decision" fill="hsl(var(--chart-2))" />
                    <Bar dataKey="skipped" stackId="decision" fill="hsl(var(--chart-3))" />
                    <Bar dataKey="undecided" name="Not chosen" stackId="decision" fill="hsl(var(--chart-5))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Skill level</CardTitle>
                <p className="text-xs text-muted-foreground">Average and median scores on a 0–10 scale.</p>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={report.skills.map((skill) => ({ ...skill, label: skillLabel(skill.skill) }))} layout="vertical" margin={{ left: 24, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                    <XAxis type="number" domain={[0, 10]} />
                    <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="average" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="median" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Movement from first to latest score</CardTitle>
              <p className="text-xs text-muted-foreground">Learners with at least two scores for the same skill.</p>
            </CardHeader>
            <CardContent>
              {report.movement.length === 0 ? (
                <p className="text-sm text-muted-foreground">Movement needs two scores for the same learner and skill.</p>
              ) : (
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={report.movement.map((row) => ({ ...row, label: skillLabel(row.skill) }))} layout="vertical" margin={{ left: 28, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="label" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="improving" stackId="movement" fill="hsl(var(--chart-2))" />
                      <Bar dataKey="stable" stackId="movement" fill="hsl(var(--chart-5))" />
                      <Bar dataKey="declining" stackId="movement" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
          {report.trends.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Daily skill trend</CardTitle>
                <p className="text-xs text-muted-foreground">Days in {report.range.timeZone === 'Asia/Kolkata' ? 'IST (Asia/Kolkata)' : report.range.timeZone}. Only daily skill groups with at least 5 learners are plotted.</p>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="day" className="text-xs" />
                    <YAxis domain={[0, 10]} className="text-xs" />
                    <Tooltip />
                    <Legend />
                    {trendSkills.map((skill, index) => (
                      <Line
                        key={skill}
                        dataKey={skill}
                        name={skillLabel(skill)}
                        stroke={CHART_COLORS[index % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={false}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          <LanguageAnalytics rows={report.language ?? []} />
          <div className="grid gap-4 lg:grid-cols-3">
            <CohortChart title="Gender" rows={report.cohorts.gender} />
            <CohortChart title="Age" rows={report.cohorts.ageBand} />
            <CohortChart title="State" rows={report.cohorts.state} />
          </div>
          <Accordion type="single" collapsible>
            <AccordionItem value="distribution">
              <AccordionTrigger>Score distribution</AccordionTrigger>
              <AccordionContent>
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={report.distribution.filter((row) => !row.suppressed).map((row) => ({
                        skill: skillLabel(row.skill),
                        ...Object.fromEntries((row.bands ?? []).map((band) => [band.label, band.count])),
                      }))}
                      layout="vertical"
                      margin={{ left: 28, right: 16 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-muted" />
                      <XAxis type="number" allowDecimals={false} />
                      <YAxis type="category" dataKey="skill" width={100} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {['0–2', '2–4', '4–6', '6–8', '8–10'].map((band, index) => (
                        <Bar
                          key={band}
                          dataKey={band}
                          stackId="distribution"
                          fill={CHART_COLORS[index % CHART_COLORS.length]}
                          radius={index === 4 ? [0, 4, 4, 0] : undefined}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
      </>
      )}
      {!missingLearner && <DailyActivity query={query} onChange={update} pulseHref={query.learner ? '#score-history' : '#pulse-summary'} />}
    </div>
  )
}
