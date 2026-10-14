import type {
  AnalyticsMetricPlan,
  AnalyticsPlan,
  AnalyticsPredicate,
  AnalyticsResult,
  CohortResult,
  MetricResult,
  SavedQuery,
  SavedQueryLists,
} from './types'

export const RECENT_QUERY_LIMIT = 15
export const DEFAULT_REFRESH_SEC = 60

const FEATURE_LABELS: Record<string, string> = {
  replay: 'Replay',
  elevate: 'Elevate',
  interviews: 'Interviews',
  progress_pulse: 'Progress Pulse',
  prepare: 'Prepare',
  feedback: 'Feedback',
}

const GENDER_LABELS: Record<string, string> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
  PREFER_NOT_TO_SAY: 'Prefer not to say',
}

const LANGUAGE_LABELS: Record<string, string> = {
  wpm: 'speaking pace',
  filler_rate: 'filler rate',
  hedging_rate: 'hedging rate',
  sentence_length: 'sentence length',
  vocabulary_diversity: 'vocabulary diversity',
  readability: 'readability',
  coherence: 'coherence',
}

const SKILL_LABELS: Record<string, string> = {
  clarity: 'clarity',
  conciseness: 'conciseness',
  confidence: 'confidence',
  structure: 'structure',
  engagement: 'engagement',
  pacing: 'pacing',
  delivery: 'delivery',
  emotional_control: 'emotional control',
  filler_words: 'filler words',
  action_items: 'action items',
}

const UNIT_TITLES: Record<MetricResult['unit'], string> = {
  learners: 'Learners',
  percent: 'Percent',
  score: 'Score',
  wpm: 'Words per minute',
  words: 'Words',
  number: 'Value',
}

export type UnderstandingChip = {
  label: string
  tone: 'default' | 'secondary' | 'outline'
}

export type MetricChart = {
  unit: MetricResult['unit']
  title: string
  rows: Array<Record<string, string | number | null>>
}

export function featureLabel(feature: string) {
  return FEATURE_LABELS[feature] ?? feature.replaceAll('_', ' ')
}

export function genderLabel(value: string | null | undefined) {
  if (!value) return '—'
  return GENDER_LABELS[value] ?? value
}

export function normalizeRefreshInterval(value: number | null | undefined): 30 | 60 | 300 {
  if (value === 30 || value === 60 || value === 300) return value
  return DEFAULT_REFRESH_SEC
}

export function refreshDelayMs(value: number | null | undefined) {
  return normalizeRefreshInterval(value) * 1000
}

export function parseRefreshInterval(value: string): 30 | 60 | 300 | null {
  if (value === '30') return 30
  if (value === '60') return 60
  if (value === '300') return 300
  return null
}

export function refreshIntervalLabel(value: number | null | undefined) {
  const seconds = normalizeRefreshInterval(value)
  if (seconds === 30) return '30 seconds'
  if (seconds === 300) return '5 minutes'
  return '1 minute'
}

export function predicateLabel(predicate: AnalyticsPredicate) {
  if (predicate.type === 'gender') return genderLabel(predicate.value)
  if (predicate.type === 'age') {
    if (predicate.operator === 'between') return `Age ${predicate.min ?? '?'}–${predicate.max ?? '?'}`
    const relation = { gt: 'over', gte: 'at least', lt: 'under', lte: 'at most' } as const
    return `Age ${relation[predicate.operator]} ${predicate.value ?? '?'}`
  }
  if (predicate.type === 'city') return `City: ${predicate.value}`
  if (predicate.type === 'state') return `State: ${predicate.value}`
  const feature = featureLabel(predicate.feature)
  const action = predicate.used ? `Used ${feature}` : `Has not used ${feature}`
  return predicate.timeframe === 'range' ? `${action} in this period` : action
}

export function metricPlanLabel(metric: AnalyticsMetricPlan) {
  if (metric.label) return metric.label
  if (metric.type === 'learner_count') return 'Learners'
  if (metric.type === 'usage_percentage') return `${featureLabel(metric.feature)} usage`
  if (metric.type === 'language_median') {
    const source = metric.source === 'elevate' ? 'Elevate' : 'Replay'
    return `${source} median ${LANGUAGE_LABELS[metric.metric] ?? metric.metric}`
  }
  const skill = metric.skill ? SKILL_LABELS[metric.skill] ?? metric.skill : 'overall'
  return `Progress Pulse ${skill}`
}

export function answerKindLabel(kind: AnalyticsPlan['answerKind']) {
  if (kind === 'comparison') return 'Comparison'
  if (kind === 'users') return 'Learner list'
  return 'Aggregate'
}

export function periodLabel(days: number | null) {
  if (days == null) return 'Lifetime'
  if (days === 1) return 'Last 1 day'
  return `Last ${days} days`
}

export function breakdownLabel(breakdown: AnalyticsPlan['breakdown']) {
  if (breakdown === 'gender') return 'By gender'
  if (breakdown === 'age_band') return 'By age band'
  if (breakdown === 'state') return 'By state'
  return null
}

export function understandingChips(plan: AnalyticsPlan): UnderstandingChip[] {
  const chips: UnderstandingChip[] = [
    { label: answerKindLabel(plan.answerKind), tone: 'default' },
    { label: periodLabel(plan.days), tone: 'secondary' },
  ]
  const breakdown = breakdownLabel(plan.breakdown)
  if (breakdown) chips.push({ label: breakdown, tone: 'secondary' })
  for (const cohort of plan.cohorts) {
    chips.push({ label: cohort.label, tone: 'outline' })
    for (const predicate of cohort.predicates) {
      chips.push({ label: predicateLabel(predicate), tone: 'outline' })
    }
  }
  for (const metric of plan.metrics) {
    chips.push({ label: metricPlanLabel(metric), tone: 'secondary' })
  }
  return chips
}

function trimNumber(value: number) {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function formatMetricValue(value: number | null, unit: MetricResult['unit']) {
  if (value == null) return '—'
  if (unit === 'learners') return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
  if (unit === 'percent') return `${trimNumber(value)}%`
  if (unit === 'wpm') return `${trimNumber(value)} wpm`
  if (unit === 'words') return `${trimNumber(value)} words`
  return trimNumber(value)
}

export function formatTimestamp(iso: string | null | undefined) {
  if (!iso) return 'Not run yet'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'Not run yet'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function learnerName(user: { firstName: string | null; lastName: string | null; email: string }) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  return name || user.email
}

export function learnerPlace(user: { city: string | null; state: string | null }) {
  const place = [user.city, user.state].filter(Boolean).join(', ')
  return place || '—'
}

export function cohortSizeLabel(cohort: CohortResult, threshold: number) {
  if (cohort.suppressed) return `Fewer than ${threshold} learners`
  if (cohort.users == null) return cohort.label
  return `${cohort.label} · ${formatMetricValue(cohort.users, 'learners')} learners`
}

export function chartsForResult(result: AnalyticsResult): MetricChart[] {
  const units: MetricResult['unit'][] = []
  for (const cohort of result.cohorts) {
    for (const metric of cohort.metrics) {
      if (!units.includes(metric.unit)) units.push(metric.unit)
    }
  }
  const charts: MetricChart[] = []
  for (const unit of units) {
    const rows: MetricChart['rows'] = []
    const count = Math.max(...result.cohorts.map((cohort) => cohort.metrics.length), 0)
    for (let index = 0; index < count; index += 1) {
      const sample = result.cohorts.find((cohort) => cohort.metrics[index]?.unit === unit)?.metrics[index]
      if (!sample) continue
      const row: Record<string, string | number | null> = { metric: sample.label }
      let hasValue = false
      for (const cohort of result.cohorts) {
        const metric = cohort.metrics[index]
        const value = metric?.unit === unit ? metric.value : null
        row[cohort.id] = value
        if (value != null) hasValue = true
      }
      if (hasValue) rows.push(row)
    }
    if (rows.length) {
      charts.push({
        unit,
        title: result.cohorts.length > 1 ? `${UNIT_TITLES[unit]} comparison` : UNIT_TITLES[unit],
        rows,
      })
    }
  }
  return charts
}

function byLastRun(left: SavedQuery, right: SavedQuery) {
  return right.lastRunAt.localeCompare(left.lastRunAt)
}

export function replaceSavedQuery(lists: SavedQueryLists, saved: SavedQuery): SavedQueryLists {
  const pinned = lists.pinned.filter((item) => item.id !== saved.id)
  const recent = lists.recent.filter((item) => item.id !== saved.id)
  if (saved.pinned) {
    return { pinned: [saved, ...pinned].sort(byLastRun), recent }
  }
  return {
    pinned: pinned.sort(byLastRun),
    recent: [saved, ...recent].sort(byLastRun).slice(0, RECENT_QUERY_LIMIT),
  }
}
