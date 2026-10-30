import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { eligiblePulseSql } from './pulseEligibility'
import { FEATURE_USE_ACTIONS, MIN_COHORT } from './productEvents'
import { isCubeAnalyticsConfigured, loadCubeAnalytics, type CubeQuery } from './cubeAnalyticsClient'
import { logger } from '../lib/logger'
import {
  type AdminAnalyticsPlan,
  type AnyAnalyticsPlan,
  type AnalyticsMetric,
  type AnalyticsPredicate,
} from './adminAnalyticsQuerySchema'

type ScalarRow = { value: number | null }
type UserRow = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  createdAt: Date
}

type BucketRow = { bucket: string; users: number }

export type AnalyticsMetricResult = {
  key: string
  label: string
  value: number | null
  unit: 'learners' | 'percent' | 'score' | 'wpm' | 'words' | 'number'
}

export type AnalyticsCohortResult = {
  id: string
  label: string
  users: number | null
  suppressed: boolean
  metrics: AnalyticsMetricResult[]
}

export type AdminAnalyticsResult = {
  planHash: string
  executedAt: string
  cohorts: AnalyticsCohortResult[]
  privacyThreshold: number
}

const featureTimestamp: Record<string, string> = {
  replay: 'r."createdAt"',
  elevate: 's."startedAt"',
  interviews: 'ir."createdAt"',
  progress_pulse: 'p."recordedAt"',
  prepare: 'pr."createdAt"',
  feedback: 'f."createdAt"',
}

function rangeSql(column: string, predicate: Extract<AnalyticsPredicate, { type: 'feature' }>, since: Date | null) {
  if (predicate.timeframe !== 'range' || !since) return Prisma.empty
  return Prisma.sql`AND ${Prisma.raw(column)} >= ${since}`
}

function canonicalFeatureExists(
  feature: Extract<AnalyticsPredicate, { type: 'feature' }>['feature'],
  predicate: Extract<AnalyticsPredicate, { type: 'feature' }>,
  since: Date | null,
) {
  const range = rangeSql(featureTimestamp[feature], predicate, since)
  const eventRange = predicate.timeframe === 'range' && since
    ? Prisma.sql`AND fu.timestamp >= ${since}`
    : Prisma.empty
  const telemetry = Prisma.sql`EXISTS (
    SELECT 1 FROM "FeatureUsage" fu
    WHERE fu."userId" = u.id AND fu.feature = ${feature}
      AND fu.action IN (${Prisma.join([...FEATURE_USE_ACTIONS[feature]])})
      ${eventRange}
  )`
  const canonical: Record<typeof feature, Prisma.Sql> = {
    replay: Prisma.sql`EXISTS (
      SELECT 1 FROM "ReplaySession" r
      WHERE r."userId" = u.id AND r.purpose = 'COMMUNICATION'
        AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" rr WHERE rr."replaySessionId" = r.id)
        ${range}
    )`,
    elevate: Prisma.sql`EXISTS (
      SELECT 1 FROM "Session" s
      WHERE s."userId" = u.id AND s.purpose = 'COMMUNICATION' AND s.module = 'elevate' AND s."discardedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "InterviewRun" irx WHERE irx."sessionId" = s.id)
        ${range}
    )`,
    interviews: Prisma.sql`EXISTS (
      SELECT 1 FROM "InterviewRun" ir
      JOIN "Session" s ON s.id = ir."sessionId"
      WHERE ir."ownerId" = u.id AND s."discardedAt" IS NULL ${range}
    )`,
    progress_pulse: Prisma.sql`EXISTS (
      SELECT 1 FROM "ProgressPulse" p
      WHERE p."userId" = u.id AND ${eligiblePulseSql} ${range}
    )`,
    prepare: Prisma.sql`EXISTS (
      SELECT 1 FROM "Preparation" pr WHERE pr."userId" = u.id ${range}
    )`,
    feedback: Prisma.sql`EXISTS (
      SELECT 1 FROM "UserFeedback" f WHERE f."userId" = u.id ${range}
    )`,
  }
  return Prisma.sql`(${canonical[feature]} OR ${telemetry})`
}

function ageSql(predicate: Extract<AnalyticsPredicate, { type: 'age' }>) {
  const age = Prisma.sql`EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth"))`
  if (predicate.operator === 'between') return Prisma.sql`${age} BETWEEN ${predicate.min!} AND ${predicate.max!}`
  const operators = { gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
  return Prisma.sql`${age} ${Prisma.raw(operators[predicate.operator])} ${predicate.value!}`
}

export function cohortWhereSql(predicates: AnalyticsPredicate[], days: number | null) {
  const since = days == null ? null : new Date(Date.now() - days * 86_400_000)
  const clauses: Prisma.Sql[] = [Prisma.sql`u.role = 'USER'`]
  for (const predicate of predicates) {
    if (predicate.type === 'gender') clauses.push(Prisma.sql`u.gender::text = ${predicate.value}`)
    if (predicate.type === 'age') clauses.push(Prisma.sql`u."dateOfBirth" IS NOT NULL AND ${ageSql(predicate)}`)
    if (predicate.type === 'city') clauses.push(Prisma.sql`u.city = ${predicate.value}`)
    if (predicate.type === 'state') clauses.push(Prisma.sql`u.state = ${predicate.value}`)
    if (predicate.type === 'feature') {
      const exists = canonicalFeatureExists(predicate.feature, predicate, since)
      clauses.push(predicate.used ? exists : Prisma.sql`NOT ${exists}`)
    }
  }
  return Prisma.join(clauses, ' AND ')
}

function metricDetails(metric: AnalyticsMetric) {
  if (metric.type === 'learner_count') return { key: 'learner_count', label: metric.label ?? 'Learners', unit: 'learners' as const }
  if (metric.type === 'usage_percentage') return { key: `${metric.feature}_usage_percentage`, label: metric.label ?? `${metric.feature.replace('_', ' ')} usage`, unit: 'percent' as const }
  if (metric.type === 'pulse_average') return { key: `pulse_${metric.skill ?? 'all'}_average`, label: metric.label ?? `${metric.skill?.replace('_', ' ') ?? 'Progress Pulse'} average`, unit: 'score' as const }
  const units = { wpm: 'wpm', sentence_length: 'words' } as const
  return {
    key: `${metric.source}_${metric.metric}_median`,
    label: metric.label ?? `${metric.source} median ${metric.metric.replaceAll('_', ' ')}`,
    unit: metric.metric in units ? units[metric.metric as keyof typeof units] : metric.metric.endsWith('rate') || metric.metric === 'vocabulary_diversity' ? 'percent' as const : 'number' as const,
  }
}

async function countCohort(where: Prisma.Sql) {
  const rows = await prisma.$queryRaw<ScalarRow[]>`
    SELECT COUNT(*)::int AS value FROM "User" u WHERE ${where}
  `
  return Number(rows[0]?.value ?? 0)
}

function cubeFilters(predicates: AnalyticsPredicate[], view: string): CubeQuery['filters'] | null {
  const filters: NonNullable<CubeQuery['filters']> = []
  for (const predicate of predicates) {
    if (predicate.type === 'gender' || predicate.type === 'city' || predicate.type === 'state') {
      filters.push({ member: `${view}.${predicate.type}`, operator: 'equals', values: [predicate.value] })
    }
    if (predicate.type === 'age') {
      if (predicate.operator === 'between') {
        filters.push({ member: `${view}.age`, operator: 'gte', values: [String(predicate.min)] })
        filters.push({ member: `${view}.age`, operator: 'lte', values: [String(predicate.max)] })
      } else {
        filters.push({ member: `${view}.age`, operator: predicate.operator, values: [String(predicate.value)] })
      }
    }
    if (predicate.type === 'feature') {
      if (predicate.timeframe === 'range') return null
      filters.push({
        member: `${view}.used_${predicate.feature}`,
        operator: 'equals',
        values: [String(predicate.used)],
      })
    }
  }
  return filters
}

function cubeNumber(payload: Awaited<ReturnType<typeof loadCubeAnalytics>>, member: string) {
  const value = payload.data?.[0]?.[member]
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

async function executeCubeMetric(
  metric: AnalyticsMetric,
  predicates: AnalyticsPredicate[],
  users: number,
  days: number | null,
): Promise<number | null | undefined> {
  if (!isCubeAnalyticsConfigured() || metric.type === 'pulse_average') return undefined
  if (metric.type === 'learner_count') {
    const view = 'learner_explorer'
    const filters = cubeFilters(predicates, view)
    if (!filters) return undefined
    const member = `${view}.count`
    const value = cubeNumber(await loadCubeAnalytics({ measures: [member], filters }), member)
    return value == null ? undefined : value
  }
  if (metric.type === 'usage_percentage') {
    // The percentage is one SQL ratio. A Cube count of the used subset is a
    // different population, and the five-learner floor would turn a real
    // numerator below five into an empty row.
    return undefined
  }
  const view = metric.source === 'elevate' ? 'elevate_nlp' : 'replay_nlp'
  const filters = cubeFilters(predicates, view)
  if (!filters) return undefined
  const suffix = metric.metric === 'vocabulary_diversity' ? 'vocab_diversity' : metric.metric
  const member = `${view}.median_${suffix}`
  const timeDimension = metric.source === 'elevate' ? 'started_at' : 'result_created_at'
  const timeDimensions = days == null ? undefined : [{
    dimension: `${view}.${timeDimension}`,
    dateRange: [
      new Date(Date.now() - days * 86_400_000).toISOString(),
      new Date().toISOString(),
    ] as [string, string],
  }]
  return cubeNumber(await loadCubeAnalytics({ measures: [member], filters, timeDimensions }), member)
}

async function executeMetric(
  metric: AnalyticsMetric,
  predicates: AnalyticsPredicate[],
  where: Prisma.Sql,
  users: number,
  days: number | null,
  allowCube = true,
) {
  if (allowCube && isCubeAnalyticsConfigured()) {
    try {
      const cubeValue = await executeCubeMetric(metric, predicates, users, days)
      if (cubeValue !== undefined) return cubeValue
    } catch (error) {
      logger.warn({
        event: 'admin_analytics.cube_fallback',
        metric: metric.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (metric.type === 'learner_count') return users
  const since = days == null ? null : new Date(Date.now() - days * 86_400_000)
  if (metric.type === 'usage_percentage') {
    const predicate = { type: 'feature', feature: metric.feature, used: true, timeframe: days == null ? 'lifetime' : 'range' } as const
    const used = canonicalFeatureExists(metric.feature, predicate, since)
    const rows = await prisma.$queryRaw<ScalarRow[]>`
      SELECT CASE WHEN COUNT(*) = 0 THEN NULL
        ELSE 100.0 * COUNT(*) FILTER (WHERE ${used}) / COUNT(*) END AS value
      FROM "User" u WHERE ${where}
    `
    return rows[0]?.value == null ? null : Number(rows[0].value)
  }
  if (metric.type === 'pulse_average') {
    const skill = metric.skill ? Prisma.sql`AND p.skill = ${metric.skill}` : Prisma.empty
    const date = since ? Prisma.sql`AND p."recordedAt" >= ${since}` : Prisma.empty
    const rows = await prisma.$queryRaw<ScalarRow[]>`
      SELECT CASE
        WHEN COUNT(DISTINCT u.id) FILTER (WHERE p.score IS NOT NULL) < ${MIN_COHORT} THEN NULL
        ELSE AVG(p.score)
      END AS value
      FROM "ProgressPulse" p JOIN "User" u ON u.id = p."userId"
      WHERE ${where} AND ${eligiblePulseSql} ${skill} ${date}
    `
    return rows[0]?.value == null ? null : Number(rows[0].value)
  }

  const dateColumn = metric.source === 'elevate' ? Prisma.sql`s."startedAt"` : Prisma.sql`r."createdAt"`
  const date = since ? Prisma.sql`AND ${dateColumn} >= ${since}` : Prisma.empty
  const elevateExpressions = {
    wpm: Prisma.sql`NULLIF(m."userWpm", 0)`,
    filler_rate: Prisma.sql`CASE WHEN m."communicationSignals" IS NOT NULL OR m."userFillerCount" > 0 THEN m."userFillerRate" END`,
    hedging_rate: Prisma.sql`CASE WHEN (m."communicationSignals"#>>'{hedging,rate}') ~ '^[0-9]+(\\.[0-9]+)?$' THEN 100 * (m."communicationSignals"#>>'{hedging,rate}')::double precision END`,
    sentence_length: Prisma.sql`NULLIF(m."userAvgSentenceLength", 0)`,
    vocabulary_diversity: Prisma.sql`100 * NULLIF(m."userVocabDiversity", 0)`,
    readability: Prisma.sql`CASE WHEN (m."communicationSignals"#>>'{sentenceComplexity,readability}') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (m."communicationSignals"#>>'{sentenceComplexity,readability}')::double precision END`,
    coherence: Prisma.sql`CASE WHEN (m."communicationSignals"#>>'{topicCoherence,avgSimilarity}') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (m."communicationSignals"#>>'{topicCoherence,avgSimilarity}')::double precision END`,
  }
  const replayExpressions = {
    wpm: Prisma.sql`NULLIF(rr."wordsPerMinute", 0)`,
    filler_rate: Prisma.sql`CASE WHEN rr."communicationSignals" IS NOT NULL OR rr."fillerWordCount" > 0 THEN rr."fillerWordRate" END`,
    hedging_rate: Prisma.sql`CASE WHEN rr."communicationSignals" IS NOT NULL OR rr."hedgingCount" > 0 THEN rr."hedgingRate" END`,
    sentence_length: Prisma.sql`NULLIF(rr."avgSentenceLength", 0)`,
    vocabulary_diversity: Prisma.sql`NULLIF(rr."vocabularyDiversity", 0)`,
    readability: Prisma.sql`CASE WHEN (rr."communicationSignals"#>>'{sentenceComplexity,readability}') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (rr."communicationSignals"#>>'{sentenceComplexity,readability}')::double precision END`,
    coherence: Prisma.sql`CASE WHEN (rr."communicationSignals"#>>'{topicCoherence,avgSimilarity}') ~ '^[0-9]+(\\.[0-9]+)?$' THEN (rr."communicationSignals"#>>'{topicCoherence,avgSimilarity}')::double precision END`,
  }
  if (metric.source === 'elevate') {
    const expression = elevateExpressions[metric.metric]
    const rows = await prisma.$queryRaw<ScalarRow[]>`
      SELECT CASE
        WHEN COUNT(DISTINCT u.id) FILTER (WHERE (${expression}) IS NOT NULL) < ${MIN_COHORT} THEN NULL
        ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${expression})
      END AS value
      FROM "SessionMetrics" m
      JOIN "Session" s ON s.id = m."sessionId"
      JOIN "User" u ON u.id = s."userId"
      WHERE ${where} AND s.purpose = 'COMMUNICATION' AND s.module = 'elevate' AND s."discardedAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "InterviewRun" ix WHERE ix."sessionId" = s.id)
        AND (
          m."communicationSignals" IS NOT NULL
          OR m."userWpm" > 0
          OR m."userFillerCount" > 0
        )
        ${date}
    `
    return rows[0]?.value == null ? null : Number(rows[0].value)
  }
  const expression = replayExpressions[metric.metric]
  const rows = await prisma.$queryRaw<ScalarRow[]>`
    SELECT CASE
      WHEN COUNT(DISTINCT u.id) FILTER (WHERE (${expression}) IS NOT NULL) < ${MIN_COHORT} THEN NULL
      ELSE PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${expression})
    END AS value
    FROM "ReplayResult" rr
    JOIN "ReplaySession" r ON r.id = rr."replaySessionId"
    JOIN "User" u ON u.id = r."userId"
    WHERE ${where} AND r.purpose = 'COMMUNICATION'
      AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)
      ${date}
  `
  return rows[0]?.value == null ? null : Number(rows[0].value)
}

function rounded(value: number | null) {
  return value == null ? null : Math.round(value * 10) / 10
}

function hasDemographicFilter(predicates: AnalyticsPredicate[]) {
  return predicates.some((predicate) => ['gender', 'age', 'city', 'state'].includes(predicate.type))
}

function hidesMetric(metric: AnalyticsMetric, users: number, suppressed: boolean) {
  if (suppressed) return true
  return users < MIN_COHORT && (metric.type === 'language_median' || metric.type === 'pulse_average')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function analyticsPlanHash(plan: AnyAnalyticsPlan) {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex')
}

function ageBandSql() {
  const age = Prisma.sql`EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth"))`
  return Prisma.sql`CASE
    WHEN u."dateOfBirth" IS NULL THEN 'unknown'
    WHEN ${age} < 18 THEN 'under_18'
    WHEN ${age} < 25 THEN '18_24'
    WHEN ${age} < 35 THEN '25_34'
    WHEN ${age} < 45 THEN '35_44'
    WHEN ${age} < 55 THEN '45_54'
    ELSE '55_plus'
  END`
}

function breakdownSql(breakdown: Exclude<AdminAnalyticsPlan['breakdown'], 'none'>) {
  if (breakdown === 'gender') return Prisma.sql`COALESCE(u.gender::text, 'unknown')`
  if (breakdown === 'state') return Prisma.sql`COALESCE(NULLIF(BTRIM(u.state), ''), 'unknown')`
  return ageBandSql()
}

function bucketLabel(breakdown: Exclude<AdminAnalyticsPlan['breakdown'], 'none'>, bucket: string) {
  const genders: Record<string, string> = {
    MALE: 'Male',
    FEMALE: 'Female',
    OTHER: 'Other',
    PREFER_NOT_TO_SAY: 'Prefer not to say',
    unknown: 'Unknown gender',
  }
  const ages: Record<string, string> = {
    under_18: 'Under 18',
    '18_24': '18–24',
    '25_34': '25–34',
    '35_44': '35–44',
    '45_54': '45–54',
    '55_plus': '55+',
    unknown: 'Unknown age',
  }
  if (breakdown === 'gender') return genders[bucket] ?? bucket
  if (breakdown === 'age_band') return ages[bucket] ?? bucket
  return bucket === 'unknown' ? 'Unknown state' : bucket
}

function bucketId(cohortId: string, bucket: string) {
  const slug = bucket.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'group'
  return `${cohortId}_${slug}`
}

async function cohortMetrics(
  plan: AdminAnalyticsPlan,
  predicates: AnalyticsPredicate[],
  where: Prisma.Sql,
  users: number,
  suppressed: boolean,
  allowCube: boolean,
) {
  const metrics: AnalyticsMetricResult[] = []
  for (const metric of plan.metrics) {
    const details = metricDetails(metric)
    const value = hidesMetric(metric, users, suppressed)
      ? null
      : metric.type === 'learner_count'
        ? users
        : await executeMetric(metric, predicates, where, users, plan.days, allowCube)
    metrics.push({ ...details, value: rounded(value) })
  }
  return metrics
}

export async function executeAdminAnalyticsPlan(plan: AdminAnalyticsPlan): Promise<AdminAnalyticsResult> {
  const cohorts: AnalyticsCohortResult[] = []
  for (const cohort of plan.cohorts) {
    const where = cohortWhereSql(cohort.predicates, plan.days)
    if (plan.breakdown !== 'none') {
      const expression = breakdownSql(plan.breakdown)
      const buckets = await prisma.$queryRaw<BucketRow[]>`
        SELECT ${expression} AS bucket, COUNT(*)::int AS users
        FROM "User" u
        WHERE ${where}
        GROUP BY 1
        ORDER BY users DESC, bucket
        LIMIT 12
      `
      if (buckets.length === 0) {
        cohorts.push({
          id: cohort.id,
          label: cohort.label,
          users: 0,
          suppressed: false,
          metrics: plan.metrics.map((metric) => ({
            ...metricDetails(metric),
            value: metric.type === 'learner_count' ? 0 : null,
          })),
        })
        continue
      }
      for (const bucket of buckets) {
        const users = Number(bucket.users ?? 0)
        const suppressed = users < MIN_COHORT
        const slice = Prisma.sql`${where} AND (${expression}) = ${bucket.bucket}`
        cohorts.push({
          id: bucketId(cohort.id, bucket.bucket),
          label: plan.cohorts.length > 1 ? `${cohort.label} · ${bucketLabel(plan.breakdown, bucket.bucket)}` : bucketLabel(plan.breakdown, bucket.bucket),
          users: suppressed ? null : users,
          suppressed,
          metrics: await cohortMetrics(plan, cohort.predicates, slice, users, suppressed, false),
        })
      }
      continue
    }
    const users = await countCohort(where)
    const suppressed = hasDemographicFilter(cohort.predicates) && users < MIN_COHORT && plan.answerKind !== 'users'
    cohorts.push({
      id: cohort.id,
      label: cohort.label,
      users: suppressed ? null : users,
      suppressed,
      metrics: await cohortMetrics(plan, cohort.predicates, where, users, suppressed, true),
    })
  }
  return {
    planHash: analyticsPlanHash(plan),
    executedAt: new Date().toISOString(),
    cohorts,
    privacyThreshold: MIN_COHORT,
  }
}

export async function loadAdminAnalyticsUsers(plan: AdminAnalyticsPlan, page: number) {
  if (plan.answerKind !== 'users' || plan.cohorts.length !== 1) {
    return { error: 'This query does not produce a user list' } as const
  }
  const safePage = Math.min(1_000, Math.max(1, page))
  const pageSize = 20
  const offset = (safePage - 1) * pageSize
  const where = cohortWhereSql(plan.cohorts[0].predicates, plan.days)
  const total = await countCohort(where)
  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT u.id, u.email, u."firstName", u."lastName", u."createdAt"
    FROM "User" u
    WHERE ${where}
    ORDER BY u."createdAt" DESC, u.id
    LIMIT ${pageSize} OFFSET ${offset}
  `
  return {
    page: safePage,
    pageSize,
    total,
    users: rows.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
    })),
  }
}
