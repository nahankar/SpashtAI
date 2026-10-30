import { useState } from 'react'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/admin/MetricCard'
import type { LearnerSummary } from '@/components/admin/LearnerSelector'

export type ReportRange = { days: number; timeZone: string; firstDay: string; lastDay: string; since: string; until: string }
type SkillPoint = { score: number; at: string; day: string; source: string }
export type LearnerProgressReport = {
  sources: string[]
  summary: { scoreEntries: number; sessionsRepresented: number; entriesWithoutSession: number; daysWithScores: number; skillsMeasured: number }
  skills: Array<{ skill: string; samples: number; observations: number; first: SkillPoint; latest: SkillPoint; change: number | null; direction: 'improving' | 'stable' | 'declining' | null }>
  daily: Array<{ day: string; skill: string; average: number; samples: number }>
  history: Array<{ id: string; day: string; at: string; source: string; skill: string; score: number; sessionId: string | null }>
  decisions: {
    counts: Array<{ source: string; sessions: number; tracked: number; skipped: number; undecided: number; open: number }>
    sessions: Array<{ source: string; sessionId: string; day: string; at: string; decision: 'tracked' | 'skipped' | 'not_chosen' | 'in_progress' }>
  }
}
export type IndividualPulseResponse = {
  mode: 'individual'
  learner: LearnerSummary
  range: ReportRange
  match: { matches: boolean; excludedBy: string[] }
  report: LearnerProgressReport | null
}

const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))']
const PAGE = 20
const DECISION_LABEL = { tracked: 'Tracked', skipped: 'Skipped', not_chosen: 'Not chosen', in_progress: 'In progress' } as const

export function skillLabel(value: string | undefined) {
  return value?.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? ''
}

export function rangeDays(range: Pick<ReportRange, 'firstDay' | 'lastDay'>) {
  const days: string[] = []
  for (let t = Date.parse(`${range.firstDay}T12:00:00Z`); t <= Date.parse(`${range.lastDay}T12:00:00Z`); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10))
  return days
}

export function rangeLabel(range: ReportRange) {
  return `${range.firstDay} to ${range.lastDay} · days in ${range.timeZone === 'Asia/Kolkata' ? 'IST (Asia/Kolkata)' : range.timeZone}`
}

function changeLabel(row: LearnerProgressReport['skills'][number]) {
  if (row.change === null) return row.observations < 2 ? 'Needs a second session' : '—'
  return `${row.change > 0 ? '+' : ''}${row.change} (${row.direction})`
}

export function NoLearnerMatch({ excludedBy, onClearFilters }: { excludedBy: string[]; onClearFilters: () => void }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-6">
        <p className="font-medium">This learner does not match the selected filters.</p>
        <p className="text-sm text-muted-foreground">
          {excludedBy.length ? `Excluded by the ${excludedBy.join(', ')} filter${excludedBy.length > 1 ? 's' : ''}.` : 'The other filters exclude this learner.'}
          {' '}Nothing is shown rather than an empty report.
        </p>
        <Button type="button" size="sm" variant="outline" onClick={onClearFilters}>Remove demographic filters</Button>
      </CardContent>
    </Card>
  )
}

export function LearnerProgress({ data }: { data: IndividualPulseResponse & { report: LearnerProgressReport } }) {
  const { report, range } = data
  const [shown, setShown] = useState(PAGE)
  const skills = [...new Set(report.daily.map((row) => row.skill))]
  // Every day in range is on the axis; days without a score stay empty (a gap), never zero.
  const chart = rangeDays(range).map((day) => ({
    day,
    ...Object.fromEntries(report.daily.filter((row) => row.day === day).map((row) => [row.skill, row.average])),
  }))
  const history = [...report.history].reverse()

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {rangeLabel(range)} · Pulse evidence from {report.sources.filter((s) => s !== '__none__').join(' and ') || 'no source'}
        {' '}(validated Replay assessments only; Interviews never contribute to Progress Pulse).
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Score entries" value={report.summary.scoreEntries} sublabel="One per skill per session" />
        <MetricCard label="Sessions represented" value={report.summary.sessionsRepresented}
          sublabel={report.summary.entriesWithoutSession ? `${report.summary.entriesWithoutSession} entries without a session` : 'Distinct scored sessions'} />
        <MetricCard label="Days with scores" value={report.summary.daysWithScores} sublabel={`of ${range.days} days`} />
        <MetricCard label="Skills measured" value={report.summary.skillsMeasured} />
      </div>

      {report.summary.scoreEntries === 0 ? (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No eligible Progress Pulse scores in this range. Activity, if any, is reported separately.</CardContent></Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Skills: first to latest</CardTitle>
              <p className="text-xs text-muted-foreground">Change needs scores from at least two different sessions; ±0.2 counts as stable.</p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr><th className="py-2 pr-3">Skill</th><th className="pr-3">First</th><th className="pr-3">Latest</th><th className="pr-3">Change</th><th>Samples</th></tr>
                </thead>
                <tbody className="divide-y">
                  {report.skills.map((row) => (
                    <tr key={row.skill}>
                      <td className="py-2 pr-3 font-medium">{skillLabel(row.skill)}</td>
                      <td className="pr-3">{row.first.score} <span className="text-xs text-muted-foreground">{row.first.day}</span></td>
                      <td className="pr-3">{row.latest.score} <span className="text-xs text-muted-foreground">{row.latest.day}</span></td>
                      <td className="pr-3">{changeLabel(row)}</td>
                      <td>{row.samples} in {row.observations} session{row.observations === 1 ? '' : 's'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Daily skill scores</CardTitle>
              <p className="text-xs text-muted-foreground">Daily average per skill. Days without scores are left as gaps.</p>
            </CardHeader>
            <CardContent className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" className="text-xs" />
                  <YAxis domain={[0, 10]} className="text-xs" />
                  <Tooltip />
                  <Legend />
                  {skills.map((skill, index) => (
                    <Line key={skill} dataKey={skill} name={skillLabel(skill)} stroke={COLORS[index % COLORS.length]} strokeWidth={2} connectNulls={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracking decisions</CardTitle>
          <p className="text-xs text-muted-foreground">What the learner chose after each Elevate and Replay session in range.</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {report.decisions.counts.map((row) => (
              <p key={row.source} className="text-sm">
                <span className="font-medium capitalize">{row.source}</span>: {row.sessions} session{row.sessions === 1 ? '' : 's'} · {row.tracked} tracked · {row.skipped} skipped · {row.undecided} not chosen{row.open ? ` · ${row.open} in progress` : ''}
              </p>
            ))}
          </div>
          {report.decisions.sessions.length > 0 && (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-3">Day</th><th className="pr-3">Source</th><th>Decision</th></tr></thead>
              <tbody className="divide-y">
                {[...report.decisions.sessions].reverse().map((row) => (
                  <tr key={`${row.source}:${row.sessionId}`}><td className="py-1 pr-3">{row.day}</td><td className="pr-3 capitalize">{row.source}</td><td>{DECISION_LABEL[row.decision]}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {history.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Score history</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground"><tr><th className="py-1 pr-3">Day</th><th className="pr-3">Skill</th><th className="pr-3">Score</th><th>Source</th></tr></thead>
              <tbody className="divide-y">
                {history.slice(0, shown).map((row) => (
                  <tr key={row.id}><td className="py-1 pr-3">{row.day}</td><td className="pr-3">{skillLabel(row.skill)}</td><td className="pr-3">{row.score}</td><td className="capitalize">{row.source}</td></tr>
                ))}
              </tbody>
            </table>
            {history.length > shown && (
              <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setShown((value) => value + PAGE)}>
                Show {Math.min(PAGE, history.length - shown)} more of {history.length - shown}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
