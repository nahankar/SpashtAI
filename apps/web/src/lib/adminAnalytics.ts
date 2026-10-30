export const AGE_BANDS = [
  { id: '18_24', label: '18–24' },
  { id: '25_34', label: '25–34' },
  { id: '35_44', label: '35–44' },
  { id: '45_54', label: '45–54' },
  { id: '55_plus', label: '55+' },
  { id: 'under_18', label: 'Under 18' },
  { id: 'unknown', label: 'Unknown' },
] as const

export const GENDERS = [
  { id: 'FEMALE', label: 'Female' },
  { id: 'MALE', label: 'Male' },
  { id: 'OTHER', label: 'Other' },
  { id: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
] as const

export type AnalyticsQuery = {
  days: number
  city: string[]
  state: string[]
  gender: string[]
  ageBand: string[]
  source: string[]
  skill: string[]
  feature: string
  /** Selected learner's stable id ('' = all learners). Never an email or name. */
  learner: string
}

export const DEFAULT_ANALYTICS_QUERY: AnalyticsQuery = {
  days: 30,
  city: [],
  state: [],
  gender: [],
  ageBand: [],
  source: [],
  skill: [],
  feature: 'replay',
  learner: '',
}

const LEARNER_ID = /^[A-Za-z0-9_-]{8,64}$/

function readList(params: URLSearchParams, key: string) {
  return (params.get(key) ?? '').split(',').map((item) => item.trim()).filter(Boolean)
}

export function analyticsQueryFromSearch(params: URLSearchParams): AnalyticsQuery {
  const days = Number(params.get('days') || 30)
  return {
    ...DEFAULT_ANALYTICS_QUERY,
    days: [7, 30, 90].includes(days) ? days : 30,
    city: readList(params, 'city'),
    state: readList(params, 'state'),
    gender: readList(params, 'gender'),
    ageBand: readList(params, 'ageBand'),
    source: readList(params, 'source'),
    skill: readList(params, 'skill'),
    feature: params.get('feature') || 'replay',
    learner: LEARNER_ID.test(params.get('learner') ?? '') ? params.get('learner')! : '',
  }
}

export function analyticsQueryToSearch(query: AnalyticsQuery) {
  const params = new URLSearchParams()
  params.set('days', String(query.days))
  for (const key of ['city', 'state', 'gender', 'ageBand', 'source', 'skill'] as const) {
    if (query[key].length) params.set(key, query[key].join(','))
  }
  if (query.feature) params.set('feature', query.feature)
  if (query.learner) params.set('learner', query.learner)
  return params.toString()
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null) return 'Not recorded yet'
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function viewState(loading: boolean, error: string | null, empty: boolean) {
  if (loading) return 'loading' as const
  if (error) return 'error' as const
  if (empty) return 'empty' as const
  return 'ready' as const
}
