import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/admin/MetricCard'
import type { AnalyticsPlan, AnalyticsPredicate, AnalyticsResult, UserPage } from './types'

function predicateLabel(predicate: AnalyticsPredicate) {
  if (predicate.type === 'feature') return `${predicate.used ? 'Used' : 'Never used'} ${predicate.feature.replaceAll('_', ' ')} · ${predicate.timeframe}`
  if (predicate.type === 'age') return predicate.operator === 'between'
    ? `Age ${predicate.min}–${predicate.max}`
    : `Age ${predicate.operator} ${predicate.value}`
  return `${predicate.type}: ${predicate.value}`
}

function valueLabel(value: number | null, unit: string) {
  if (value == null) return 'Hidden'
  if (unit === 'percent') return `${value}%`
  if (unit === 'wpm') return `${value} WPM`
  if (unit === 'words') return `${value} words`
  return String(value)
}

export function QueryResults({
  plan,
  result,
  users,
  usersLoading,
  onUsersPage,
}: {
  plan: AnalyticsPlan
  result: AnalyticsResult
  users: UserPage | null
  usersLoading: boolean
  onUsersPage: (page: number) => void
}) {
  const chartData = result.cohorts.map((cohort) => ({
    cohort: cohort.label,
    ...Object.fromEntries(cohort.metrics.map((metric) => [metric.label, metric.value])),
  }))
  const metricLabels = [...new Set(result.cohorts.flatMap((cohort) => cohort.metrics.map((metric) => metric.label)))]

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background">
        <CardHeader>
          <CardTitle className="text-lg">What I understood</CardTitle>
          <p className="text-sm text-muted-foreground">{plan.explanation}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge>{plan.answerKind}</Badge>
            <Badge variant="outline">{plan.days == null ? 'Lifetime' : `Last ${plan.days} days`}</Badge>
            {plan.cohorts.flatMap((cohort) => cohort.predicates.map((predicate, index) => (
              <Badge key={`${cohort.id}-${index}`} variant="secondary">{cohort.label}: {predicateLabel(predicate)}</Badge>
            )))}
          </div>
          <Accordion type="single" collapsible>
            <AccordionItem value="logic">
              <AccordionTrigger>Show query logic</AccordionTrigger>
              <AccordionContent>
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(plan, null, 2)}</pre>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {result.cohorts.flatMap((cohort) => cohort.metrics.map((metric) => (
          <MetricCard
            key={`${cohort.id}-${metric.key}`}
            label={result.cohorts.length > 1 ? `${cohort.label} · ${metric.label}` : metric.label}
            value={valueLabel(metric.value, metric.unit)}
            sublabel={cohort.suppressed ? `Hidden because this demographic cohort has fewer than ${result.privacyThreshold} learners` : `${cohort.users ?? 0} learners in cohort`}
          />
        )))}
      </div>

      {result.cohorts.length > 1 && metricLabels.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cohort comparison</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="cohort" />
                <YAxis />
                <Tooltip />
                <Legend />
                {metricLabels.map((label, index) => (
                  <Bar key={label} dataKey={label} fill={`hsl(var(--chart-${(index % 5) + 1}))`} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {plan.answerKind === 'users' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Matching learners</CardTitle>
            <p className="text-xs text-muted-foreground">Admin-only identity list. This access is audited, and identities are never sent to the AI model.</p>
          </CardHeader>
          <CardContent>
            {usersLoading && <p className="text-sm text-muted-foreground">Loading learners…</p>}
            {!usersLoading && users && (
              <>
                <div className="divide-y rounded-md border">
                  {users.users.length === 0 && <p className="p-4 text-sm text-muted-foreground">No matching learners.</p>}
                  {users.users.map((user) => (
                    <div key={user.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_1.4fr_auto]">
                      <span className="font-medium">{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Unnamed learner'}</span>
                      <span className="text-muted-foreground">{user.email}</span>
                      <span className="text-xs text-muted-foreground">Joined {new Date(user.createdAt).toLocaleDateString()}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{users.total} matching learners</span>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" disabled={users.page <= 1} onClick={() => onUsersPage(users.page - 1)}>Previous</Button>
                    <Button variant="outline" size="sm" disabled={users.page * users.pageSize >= users.total} onClick={() => onUsersPage(users.page + 1)}>Next</Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
      <p className="text-xs text-muted-foreground">Updated {new Date(result.executedAt).toLocaleString()} · Live first-party data</p>
    </div>
  )
}
