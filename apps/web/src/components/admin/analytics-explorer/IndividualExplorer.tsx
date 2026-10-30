import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { activityFeatureLabel } from '@/lib/adminAnalytics'
import { LearnerSelector, learnerDetail, type LearnerSummary } from '@/components/admin/LearnerSelector'
import { LearnerProgress, rangeLabel, skillLabel } from '@/components/admin/LearnerProgress'
import { DailyActivityTable, activityScopeLabel } from '@/components/admin/DailyActivity'
import { formatTimestamp } from './format'
import type { IndividualAnalyticsPlan, IndividualResult } from './types'

const REPORT_LABEL = { learner_progress: 'Learner progress', daily_activity: 'Day-wise activity' } as const

export function individualChips(plan: IndividualAnalyticsPlan) {
  return [
    REPORT_LABEL[plan.report],
    plan.learnerId ? 'One learner' : 'All learners',
    `Last ${plan.days} days (IST)`,
    plan.sources.length ? `Pulse: ${plan.sources.map(activityFeatureLabel).join(', ')}` : null,
    plan.skills.length ? `Skills: ${plan.skills.map(skillLabel).join(', ')}` : null,
    plan.feature ? `Activity: ${activityFeatureLabel(plan.feature)}` : null,
  ].filter((chip): chip is string => Boolean(chip))
}

export function IndividualSummary({ plan, learner }: { plan: IndividualAnalyticsPlan; learner?: LearnerSummary | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What I understood</CardTitle>
        <CardDescription>{plan.explanation}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {learner && <p className="text-sm"><span className="font-medium">{learner.name || 'Unnamed learner'}</span> <span className="text-muted-foreground">· {learnerDetail(learner)}</span></p>}
        <div className="flex flex-wrap gap-2">
          {individualChips(plan).map((chip) => <Badge key={chip} variant="secondary">{chip}</Badge>)}
        </div>
      </CardContent>
    </Card>
  )
}

export function IndividualPlanDraft({
  plan,
  learner,
  running,
  error,
  onChange,
  onRun,
}: {
  plan: IndividualAnalyticsPlan
  learner?: LearnerSummary | null
  running: boolean
  error: string | null
  onChange: (plan: IndividualAnalyticsPlan) => void
  onRun: () => void
}) {
  return (
    <div className="space-y-4">
      <IndividualSummary plan={plan} learner={learner} />
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
            <span className="text-sm text-muted-foreground">Period</span>
            {[7, 30, 90].map((days) => (
              <Button key={days} type="button" size="sm" variant={plan.days === days ? 'default' : 'outline'} onClick={() => onChange({ ...plan, days })}>
                {days} days
              </Button>
            ))}
          </div>
          {plan.learnerId && (
            <p className="text-xs text-muted-foreground">Individual reports are shown to authorized admins only, and each run is audited.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={onRun} disabled={running}>{running ? 'Running…' : 'Run'}</Button>
        </CardContent>
      </Card>
    </div>
  )
}

export function LearnerChoice({
  reason,
  candidates,
  onChoose,
}: {
  reason: string
  candidates: LearnerSummary[]
  onChoose: (learnerId: string) => void
}) {
  return (
    <Card className="border-amber-500/40 bg-amber-500/5">
      <CardContent className="space-y-3 py-6">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Which learner?</p>
        <p className="text-sm">{reason}</p>
        {candidates.length > 0 && (
          <ul className="divide-y rounded-md border bg-background" aria-label="Learners with this name">
            {candidates.map((learner) => (
              <li key={learner.id}>
                <button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => onChoose(learner.id)}>
                  <span className="block text-sm font-medium">{learner.name || 'Unnamed learner'}</span>
                  <span className="block text-xs text-muted-foreground">{learnerDetail(learner)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <LearnerSelector selectedId="" selected={null} onSelect={(id) => { if (id) onChoose(id) }} />
      </CardContent>
    </Card>
  )
}

export function IndividualResults({ title, result, refreshing }: { title: string; result: IndividualResult; refreshing: boolean }) {
  const learner = result.learner
  const pulseHref = learner
    ? `/admin/progress-pulse?days=${result.range.days}&learner=${encodeURIComponent(learner.id)}#score-history`
    : `/admin/progress-pulse?days=${result.range.days}#pulse-summary`
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">Updated {formatTimestamp(result.executedAt)} · {rangeLabel(result.range)}</p>
        </div>
        {refreshing && <p className="text-xs text-muted-foreground">Refreshing saved plan...</p>}
      </div>
      {result.status === 'no_match' ? (
        <Card><CardContent className="py-6 text-sm">{result.missingData[0] ?? 'No learner account matches this plan.'}</CardContent></Card>
      ) : (
        <>
          {learner && (
            <p className="text-sm"><span className="font-medium">{learner.name || 'Unnamed learner'}</span> <span className="text-muted-foreground">· {learnerDetail(learner)}</span></p>
          )}
          {result.sampleSize && (
            <p className="text-xs text-muted-foreground">
              Sample: {Object.entries(result.sampleSize).map(([key, value]) => `${value ?? 'not recorded'} ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`).join(' · ')}
            </p>
          )}
          {result.missingData.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground" aria-label="Missing data">
              {result.missingData.map((line) => <li key={line}>{line}</li>)}
            </ul>
          )}
          {result.progress && learner && (
            <LearnerProgress data={{ mode: 'individual', learner, range: result.range, match: { matches: true, excludedBy: [] }, report: result.progress }} />
          )}
          {result.activity && (result.activity.suppressed ? (
            <p className="text-sm text-muted-foreground">Hidden: fewer than {result.activity.threshold} learners match.</p>
          ) : (
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">Day-wise activity</CardTitle>
                <p className="text-xs text-muted-foreground">{activityScopeLabel(result.activity).activity} · {activityScopeLabel(result.activity).pulse}</p>
              </CardHeader>
              <CardContent><DailyActivityTable report={result.activity} pulseHref={pulseHref} /></CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
