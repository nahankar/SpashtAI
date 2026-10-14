export type RefreshIntervalSec = 30 | 60 | 300

export type AnalyticsPredicate =
  | { type: 'gender'; value: string }
  | {
      type: 'age'
      operator: 'gt' | 'gte' | 'lt' | 'lte' | 'between'
      value?: number
      min?: number
      max?: number
    }
  | { type: 'city'; value: string }
  | { type: 'state'; value: string }
  | { type: 'feature'; feature: string; used: boolean; timeframe?: 'lifetime' | 'range' }

export type AnalyticsMetricPlan =
  | { type: 'learner_count'; label?: string }
  | { type: 'usage_percentage'; feature: string; label?: string }
  | { type: 'language_median'; source: 'elevate' | 'replay'; metric: string; label?: string }
  | { type: 'pulse_average'; skill?: string; label?: string }

export type AnalyticsPlan = {
  version: 1
  title: string
  answerKind: 'aggregate' | 'comparison' | 'users'
  days: number | null
  cohorts: Array<{ id: string; label: string; predicates: AnalyticsPredicate[] }>
  metrics: AnalyticsMetricPlan[]
  breakdown: 'none' | 'gender' | 'age_band' | 'state'
  explanation: string
}

export type AnalyticsInterpretation =
  | { status: 'ready'; plan: AnalyticsPlan }
  | { status: 'clarification'; question: string }
  | { status: 'unsupported'; reason: string }

export type MetricResult = {
  key: string
  label: string
  value: number | null
  unit: 'learners' | 'percent' | 'score' | 'wpm' | 'words' | 'number'
}

export type CohortResult = {
  id: string
  label: string
  users: number | null
  suppressed: boolean
  metrics: MetricResult[]
}

export type AnalyticsResult = {
  planHash: string
  executedAt: string
  privacyThreshold: number
  cohorts: CohortResult[]
}

export type SavedQuery = {
  id: string
  question: string
  title: string
  plan: AnalyticsPlan
  planHash: string
  pinned: boolean
  refreshIntervalSec: RefreshIntervalSec
  lastRunAt: string
  createdAt: string
}

export type SavedQueryLists = {
  pinned: SavedQuery[]
  recent: SavedQuery[]
}

export type InterpretResponse = {
  interpretation: AnalyticsInterpretation
  result?: AnalyticsResult
  savedQuery?: SavedQuery
}

export type IdentityUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  gender: string | null
  dateOfBirth: string | null
  city: string | null
  state: string | null
  createdAt: string
}

export type IdentityPage = {
  page: number
  pageSize: number
  total: number
  users: IdentityUser[]
}

export type IdentityState =
  | { status: 'idle' }
  | { status: 'loading'; page: number }
  | { status: 'error'; page: number; message: string }
  | { status: 'ready'; data: IdentityPage; refreshing: boolean }

export type SavedAnalyticsQuery = SavedQuery
export type SavedQueryList = SavedQueryLists
export type UserPage = IdentityPage
