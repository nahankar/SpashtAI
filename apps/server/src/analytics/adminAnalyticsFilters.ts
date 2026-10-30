import { MIN_COHORT } from './productEvents'

export const AGE_BANDS = ['under_18', '18_24', '25_34', '35_44', '45_54', '55_plus', 'unknown'] as const
export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'] as const
export const PULSE_SOURCES = ['elevate', 'replay'] as const
export const PULSE_SKILLS = [
  'clarity',
  'conciseness',
  'confidence',
  'structure',
  'engagement',
  'pacing',
  'delivery',
  'emotional_control',
  'filler_words',
  'action_items',
] as const

export type AgeBand = (typeof AGE_BANDS)[number]

export type AnalyticsFilters = {
  since: Date
  until: Date
  days: number
  pincodes: string[]
  cities: string[]
  states: string[]
  genders: string[]
  ageBands: AgeBand[]
  sources: string[]
  skills: string[]
  feature: string | null
  page: number
  /** Explicit individual-report target (a stable user id; never a name or email). */
  learner: string | null
}

export function ageBandFromDob(dob: Date | null, now = new Date()): AgeBand {
  if (!dob || Number.isNaN(dob.getTime())) return 'unknown'
  let age = now.getFullYear() - dob.getFullYear()
  const month = now.getMonth() - dob.getMonth()
  if (month < 0 || (month === 0 && now.getDate() < dob.getDate())) age -= 1
  if (age < 18) return 'under_18'
  if (age < 25) return '18_24'
  if (age < 35) return '25_34'
  if (age < 45) return '35_44'
  if (age < 55) return '45_54'
  return '55_plus'
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(list)
  if (typeof value !== 'string') return []
  return value.split(',').map((part) => part.trim()).filter(Boolean)
}

function unique(values: string[], max: number) {
  return [...new Set(values)].slice(0, max)
}

export function parseAnalyticsFilters(query: Record<string, unknown>, now = new Date()): { filters: AnalyticsFilters } | { error: string } {
  const days = Math.min(90, Math.max(1, Number.parseInt(String(query.days ?? '30'), 10) || 30))
  const until = now
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const place = (value: unknown) => unique(list(value).filter((item) => /^[\p{L}0-9 .'-]{2,64}$/u.test(item)), 8)
  const cities = place(query.city)
  const states = place(query.state)
  if ((list(query.city).length && cities.length !== unique(list(query.city), 8).length) || (list(query.state).length && states.length !== unique(list(query.state), 8).length)) {
    return { error: 'Invalid location filter' }
  }
  const genders = unique(list(query.gender), 4)
  if (genders.some((gender) => !(GENDERS as readonly string[]).includes(gender))) return { error: 'Invalid gender filter' }
  const ageBands = unique(list(query.ageBand), AGE_BANDS.length)
  if (ageBands.some((band) => !(AGE_BANDS as readonly string[]).includes(band))) return { error: 'Invalid age band filter' }
  const sources = unique(list(query.source), PULSE_SOURCES.length)
  if (sources.some((source) => !(PULSE_SOURCES as readonly string[]).includes(source))) return { error: 'Invalid source filter' }
  const skills = unique(list(query.skill), PULSE_SKILLS.length)
  if (skills.some((skill) => !(PULSE_SKILLS as readonly string[]).includes(skill))) return { error: 'Invalid skill filter' }
  const feature = typeof query.feature === 'string' && query.feature ? query.feature : null
  const page = Math.min(50, Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1))
  const learnerParam = typeof query.learner === 'string' ? query.learner.trim() : ''
  if (learnerParam && !/^[A-Za-z0-9_-]{8,64}$/.test(learnerParam)) return { error: 'Invalid learner' }
  return {
    filters: {
      since,
      until,
      days,
      pincodes: [],
      cities,
      states,
      genders,
      ageBands: ageBands as AgeBand[],
      sources,
      skills,
      feature,
      page,
      learner: learnerParam || null,
    },
  }
}

export function presentCohort<T extends Record<string, unknown>>(users: number, metrics: T) {
  if (users < MIN_COHORT) return { users: null, suppressed: true as const, threshold: MIN_COHORT }
  return { users, suppressed: false as const, threshold: MIN_COHORT, ...metrics }
}

export function numberOrNull(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function round1(value: number | null) {
  if (value == null) return null
  return Math.round(value * 10) / 10
}
