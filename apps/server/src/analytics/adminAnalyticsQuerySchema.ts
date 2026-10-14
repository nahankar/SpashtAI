import { z } from 'zod'
import { PULSE_SKILLS } from './adminAnalyticsFilters'

export const ANALYTICS_FEATURES = [
  'replay',
  'elevate',
  'interviews',
  'progress_pulse',
  'prepare',
  'feedback',
] as const

export const LANGUAGE_METRICS = [
  'wpm',
  'filler_rate',
  'hedging_rate',
  'sentence_length',
  'vocabulary_diversity',
  'readability',
  'coherence',
] as const

const genderPredicate = z.object({
  type: z.literal('gender'),
  value: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']),
}).strict()

const agePredicate = z.object({
  type: z.literal('age'),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'between']),
  value: z.number().int().min(0).max(120).optional(),
  min: z.number().int().min(0).max(120).optional(),
  max: z.number().int().min(0).max(120).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.operator === 'between') {
    if (value.min == null || value.max == null || value.min > value.max) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'between age requires min <= max' })
    }
  } else if (value.value == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'age comparison requires value' })
  }
})

const locationPredicate = z.object({
  type: z.enum(['city', 'state']),
  value: z.string().trim().min(2).max(64),
}).strict()

const featurePredicate = z.object({
  type: z.literal('feature'),
  feature: z.enum(ANALYTICS_FEATURES),
  used: z.boolean(),
  timeframe: z.enum(['lifetime', 'range']).default('lifetime'),
}).strict()

export const analyticsPredicateSchema = z.union([
  genderPredicate,
  agePredicate,
  locationPredicate,
  featurePredicate,
])

export const analyticsCohortSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  label: z.string().trim().min(1).max(80),
  predicates: z.array(analyticsPredicateSchema).max(8),
}).strict()

const learnerCountMetric = z.object({
  type: z.literal('learner_count'),
  label: z.string().trim().min(1).max(80).optional(),
}).strict()

const usagePercentageMetric = z.object({
  type: z.literal('usage_percentage'),
  feature: z.enum(ANALYTICS_FEATURES),
  label: z.string().trim().min(1).max(80).optional(),
}).strict()

const languageMetric = z.object({
  type: z.literal('language_median'),
  source: z.enum(['elevate', 'replay']),
  metric: z.enum(LANGUAGE_METRICS),
  label: z.string().trim().min(1).max(80).optional(),
}).strict()

const pulseMetric = z.object({
  type: z.literal('pulse_average'),
  skill: z.enum(PULSE_SKILLS).optional(),
  label: z.string().trim().min(1).max(80).optional(),
}).strict()

export const analyticsMetricSchema = z.discriminatedUnion('type', [
  learnerCountMetric,
  usagePercentageMetric,
  languageMetric,
  pulseMetric,
])

export const adminAnalyticsPlanSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(100),
  answerKind: z.enum(['aggregate', 'comparison', 'users']),
  days: z.number().int().min(1).max(90).nullable().default(null),
  cohorts: z.array(analyticsCohortSchema).min(1).max(2),
  metrics: z.array(analyticsMetricSchema).min(1).max(4),
  breakdown: z.enum(['none', 'gender', 'age_band', 'state']).default('none'),
  explanation: z.string().trim().min(1).max(400),
}).strict().superRefine((plan, ctx) => {
  if (plan.answerKind === 'comparison' && plan.cohorts.length !== 2) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'comparison requires two cohorts' })
  }
  if (plan.answerKind === 'users' && plan.cohorts.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'user lists require one cohort' })
  }
  if (plan.answerKind === 'users' && plan.breakdown !== 'none') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'user lists cannot be broken down' })
  }
  const usesRange = plan.cohorts.some((cohort) =>
    cohort.predicates.some((predicate) => predicate.type === 'feature' && predicate.timeframe === 'range'),
  )
  if (usesRange && plan.days == null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'range predicates require days' })
  }
})

export const analyticsInterpretationSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    plan: adminAnalyticsPlanSchema,
  }).strict(),
  z.object({
    status: z.literal('clarification'),
    question: z.string().trim().min(1).max(300),
  }).strict(),
  z.object({
    status: z.literal('unsupported'),
    reason: z.string().trim().min(1).max(300),
  }).strict(),
])

export type AdminAnalyticsPlan = z.infer<typeof adminAnalyticsPlanSchema>
export type AnalyticsPredicate = z.infer<typeof analyticsPredicateSchema>
export type AnalyticsMetric = z.infer<typeof analyticsMetricSchema>
export type AnalyticsInterpretation = z.infer<typeof analyticsInterpretationSchema>

export function parseAnalyticsInterpretation(value: unknown): AnalyticsInterpretation {
  return analyticsInterpretationSchema.parse(value)
}
