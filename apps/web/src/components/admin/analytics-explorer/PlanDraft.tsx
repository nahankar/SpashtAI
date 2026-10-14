import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { understandingChips } from './format'
import type { AnalyticsPlan, AnalyticsPredicate } from './types'

const GENDERS = [
  ['MALE', 'Male'],
  ['FEMALE', 'Female'],
  ['OTHER', 'Other'],
  ['PREFER_NOT_TO_SAY', 'Prefer not to say'],
] as const

const AGE_OPERATORS = [
  ['gt', 'Over'],
  ['gte', 'At least'],
  ['lt', 'Under'],
  ['lte', 'At most'],
  ['between', 'Between'],
] as const

const BREAKDOWNS = [
  ['none', 'No split'],
  ['gender', 'Gender'],
  ['age_band', 'Age band'],
  ['state', 'State'],
] as const

function planValidation(plan: AnalyticsPlan, needsDays: boolean) {
  if (plan.metrics.length === 0 || plan.cohorts.length === 0) return 'Add at least one cohort and one metric.'
  if (needsDays && plan.days == null) return 'A filter limited to this period needs a number of days.'
  for (const cohort of plan.cohorts) {
    for (const predicate of cohort.predicates) {
      if (predicate.type === 'age' && predicate.operator === 'between' && (predicate.min == null || predicate.max == null || predicate.min > predicate.max)) {
        return 'Age between needs a minimum that is not above the maximum.'
      }
      if ((predicate.type === 'city' || predicate.type === 'state') && predicate.value.trim().length < 2) {
        return `${predicate.type === 'city' ? 'City' : 'State'} needs at least 2 characters.`
      }
    }
  }
  return null
}

function Choice({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <Button type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={onClick}>
      {children}
    </Button>
  )
}

export function PlanDraft({
  plan,
  running,
  error,
  onChange,
  onRun,
}: {
  plan: AnalyticsPlan
  running: boolean
  error: string | null
  onChange: (plan: AnalyticsPlan) => void
  onRun: () => void
}) {
  const chips = understandingChips(plan)
  const needsDays = plan.cohorts.some((cohort) =>
    cohort.predicates.some((predicate) => predicate.type === 'feature' && predicate.timeframe === 'range'),
  )
  const validation = planValidation(plan, needsDays)
  const canRun = validation == null && !running

  function updatePredicate(cohortIndex: number, predicateIndex: number, predicate: AnalyticsPredicate) {
    onChange({
      ...plan,
      cohorts: plan.cohorts.map((cohort, index) => index === cohortIndex
        ? {
            ...cohort,
            predicates: cohort.predicates.map((current, currentIndex) => currentIndex === predicateIndex ? predicate : current),
          }
        : cohort),
    })
  }

  function removePredicate(cohortIndex: number, predicateIndex: number) {
    onChange({
      ...plan,
      cohorts: plan.cohorts.map((cohort, index) => index === cohortIndex
        ? { ...cohort, predicates: cohort.predicates.filter((_, currentIndex) => currentIndex !== predicateIndex) }
        : cohort),
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What I understood</CardTitle>
        <CardDescription>
          Adjust the reading, then run it. Nothing is saved until you run the plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          {chips.map((chip, index) => (
            <Badge key={`${chip.label}-${index}`} variant={chip.tone}>{chip.label}</Badge>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{plan.explanation}</p>
        <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-center">
          <label className="text-sm font-medium" htmlFor="analytics-days">Period</label>
          <Input
            id="analytics-days"
            type="number"
            min={1}
            max={90}
            inputMode="numeric"
            placeholder="Lifetime"
            value={plan.days ?? ''}
            onChange={(event) => {
              const raw = event.target.value
              if (!raw) {
                onChange({ ...plan, days: null })
                return
              }
              const days = Math.min(90, Math.max(1, Math.trunc(Number(raw))))
              onChange({ ...plan, days: Number.isFinite(days) ? days : null })
            }}
          />
        </div>
        {plan.answerKind !== 'users' && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Split</p>
            <div className="flex flex-wrap gap-2">
              {BREAKDOWNS.map(([value, label]) => (
                <Choice
                  key={value}
                  active={plan.breakdown === value}
                  onClick={() => onChange({ ...plan, breakdown: value })}
                >
                  {label}
                </Choice>
              ))}
            </div>
          </div>
        )}
        {plan.cohorts.map((cohort, cohortIndex) => (
          <div key={cohort.id} className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{cohort.label}</p>
            {cohort.predicates.length === 0 && (
              <p className="text-sm text-muted-foreground">All learners in this cohort.</p>
            )}
            {cohort.predicates.map((predicate, predicateIndex) => (
              <div key={`${cohort.id}-${predicateIndex}`} className="space-y-2">
                {predicate.type === 'feature' && (
                  <div className="flex flex-wrap gap-2">
                    <Choice
                      active={predicate.used}
                      onClick={() => updatePredicate(cohortIndex, predicateIndex, { ...predicate, used: true })}
                    >
                      Used
                    </Choice>
                    <Choice
                      active={!predicate.used}
                      onClick={() => updatePredicate(cohortIndex, predicateIndex, { ...predicate, used: false })}
                    >
                      Has not used
                    </Choice>
                    <Badge variant="outline">{predicate.feature.replaceAll('_', ' ')}</Badge>
                  </div>
                )}
                {predicate.type === 'gender' && (
                  <div className="flex flex-wrap gap-2">
                    {GENDERS.map(([value, label]) => (
                      <Choice
                        key={value}
                        active={predicate.value === value}
                        onClick={() => updatePredicate(cohortIndex, predicateIndex, { type: 'gender', value })}
                      >
                        {label}
                      </Choice>
                    ))}
                  </div>
                )}
                {predicate.type === 'age' && (
                  <div className="flex flex-wrap items-center gap-2">
                    {AGE_OPERATORS.map(([operator, label]) => (
                      <Choice
                        key={operator}
                        active={predicate.operator === operator}
                        onClick={() => updatePredicate(cohortIndex, predicateIndex, {
                          ...predicate,
                          operator,
                          value: operator === 'between' ? undefined : predicate.value ?? predicate.min ?? 18,
                          min: operator === 'between' ? predicate.min ?? predicate.value ?? 18 : undefined,
                          max: operator === 'between' ? predicate.max ?? 40 : undefined,
                        })}
                      >
                        {label}
                      </Choice>
                    ))}
                    {predicate.operator === 'between' ? (
                      <>
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          max={120}
                          aria-label="Minimum age"
                          value={predicate.min ?? ''}
                          onChange={(event) => updatePredicate(cohortIndex, predicateIndex, {
                            ...predicate,
                            min: Math.min(120, Math.max(0, Math.trunc(Number(event.target.value) || 0))),
                          })}
                        />
                        <Input
                          className="w-20"
                          type="number"
                          min={0}
                          max={120}
                          aria-label="Maximum age"
                          value={predicate.max ?? ''}
                          onChange={(event) => updatePredicate(cohortIndex, predicateIndex, {
                            ...predicate,
                            max: Math.min(120, Math.max(0, Math.trunc(Number(event.target.value) || 0))),
                          })}
                        />
                      </>
                    ) : (
                      <Input
                        className="w-20"
                        type="number"
                        min={0}
                        max={120}
                        aria-label="Age"
                        value={predicate.value ?? ''}
                        onChange={(event) => updatePredicate(cohortIndex, predicateIndex, {
                          ...predicate,
                          value: Math.min(120, Math.max(0, Math.trunc(Number(event.target.value) || 0))),
                        })}
                      />
                    )}
                  </div>
                )}
                {(predicate.type === 'city' || predicate.type === 'state') && (
                  <Input
                    aria-label={predicate.type}
                    value={predicate.value}
                    onChange={(event) => updatePredicate(cohortIndex, predicateIndex, {
                      ...predicate,
                      value: event.target.value,
                    })}
                  />
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => removePredicate(cohortIndex, predicateIndex)}>
                  Remove filter
                </Button>
              </div>
            ))}
          </div>
        ))}
        {(validation || error) && <p className="text-sm text-destructive">{validation ?? error}</p>}
        <Button type="button" disabled={!canRun} onClick={onRun}>
          {running ? 'Running...' : 'Run this plan'}
        </Button>
      </CardContent>
    </Card>
  )
}
