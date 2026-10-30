import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getEnabledFeatures } from '../lib/featureFlags'
import { eligiblePulseSql } from './pulseEligibility'
import type { AnalyticsFilters } from './adminAnalyticsFilters'
import { demographicFilterActive, featureFromPath, learnerWhere, sourcesFor } from './adminProductAnalytics'
import { FEATURE_USE_ACTIONS, MIN_COHORT } from './productEvents'
import { type DayRange, localDaySql } from './learnerReport'

/**
 * Day-wise product activity in the report time zone, for all learners (aggregate) or one learner.
 *
 * Every event becomes one fact row (day, feature, learner, kind), and each measure counts its own kind, so page views,
 * feature actions, starts and completions never mix and joins cannot fan out. Distinct learners come from GROUPING
 * SETS over the same facts, never from summing per-feature counts. Feature filters scope activity; source and skill
 * filters scope Pulse evidence only, and the two are reported side by side without implying a link.
 */

export const ACTIVITY_FEATURES = ['elevate', 'replay', 'interviews', 'prepare', 'progress_pulse', 'feedback'] as const
export type ActivityFeature = (typeof ACTIVITY_FEATURES)[number]
const MEASURES = ['pageViews', 'actions', 'starts', 'completions', 'activeMs'] as const
type Measure = (typeof MEASURES)[number]
type Counts = Record<Measure, number | null>

export const MEASURE_DEFINITIONS = {
  activeLearners: 'Distinct learners with any page view, feature action, start or completion. Not summed across features.',
  pageViews: 'Pages opened in the feature (page_view events, attributed by URL path).',
  actions: 'Feature-use actions recorded as product events; see each feature\'s action list. Page views are not actions.',
  starts: 'Canonical records started: sessions, uploads, runs or practices (from product records, not events).',
  completions: 'Canonical records finished, counted on the day they finished.',
  activeMs: 'Measured active time: page visible and the learner acted in the last minute, summed from page-exit events.',
  pulseEntries: 'Eligible Progress Pulse score entries (one per skill per session; skill rows are not sessions).',
} as const

const FEATURE_DEFINITIONS: Record<ActivityFeature, { start: string | null; completion: string | null }> = {
  elevate: { start: 'Elevate session started', completion: 'Elevate session ended' },
  replay: { start: 'Replay upload created', completion: 'Replay analysis completed' },
  interviews: { start: 'Interview run started', completion: 'Interview run ended' },
  prepare: { start: 'Prepare practice started', completion: 'Prepare practice ended' },
  progress_pulse: { start: null, completion: null },
  feedback: { start: null, completion: 'Feedback submitted' },
}

type FactRow = { day: string | null; feature: string | null; kind: string; n: number; ms: number | null }
type UserRow = { day: string | null; feature: string | null; users: number; g_day: number; g_feature: number }
type PulseRow = { day: string | null; entries: number; sessions: number; learners: number }
type SinceRow = { key: string; first: Date | null }

function actionPairs(features: readonly string[]) {
  const clauses = features.flatMap((feature) => {
    const actions = FEATURE_USE_ACTIONS[feature as keyof typeof FEATURE_USE_ACTIONS]
    return actions ? [Prisma.sql`(f.feature = ${feature} AND f.action IN (${Prisma.join([...actions])}))`] : []
  })
  return clauses.length ? Prisma.join(clauses, ' OR ') : Prisma.sql`FALSE`
}

/** Fact rows (day, feature, uid, kind, ms) for the cohort and range. */
function factsSql(cohort: Prisma.Sql, range: DayRange) {
  const tz = range.timeZone
  const day = (column: Prisma.Sql) => localDaySql(column, tz)
  const within = (column: Prisma.Sql) => Prisma.sql`${column} >= ${range.since} AND ${column} < ${range.until}`
  const path = Prisma.sql`COALESCE(f.path, f.metadata->>'path')`
  return Prisma.sql`
    SELECT ${day(Prisma.sql`f.timestamp`)} AS day, ${featureFromPath(path)} AS feature, f."userId" AS uid, 'pageViews' AS kind, NULL::bigint AS ms
    FROM "FeatureUsage" f JOIN cohort c ON c.id = f."userId"
    WHERE f.feature = 'app' AND f.action = 'page_view' AND ${within(Prisma.sql`f.timestamp`)}
    UNION ALL
    SELECT ${day(Prisma.sql`f.timestamp`)}, ${featureFromPath(path)}, f."userId", 'activeMs', f."engagementMs"::bigint
    FROM "FeatureUsage" f JOIN cohort c ON c.id = f."userId"
    WHERE f.feature = 'app' AND f.action = 'page_exit' AND f."engagementMs" IS NOT NULL AND ${within(Prisma.sql`f.timestamp`)}
    UNION ALL
    SELECT ${day(Prisma.sql`f.timestamp`)}, f.feature, f."userId", 'actions', NULL
    FROM "FeatureUsage" f JOIN cohort c ON c.id = f."userId"
    WHERE (${actionPairs(ACTIVITY_FEATURES)}) AND ${within(Prisma.sql`f.timestamp`)}
    UNION ALL
    SELECT ${day(Prisma.sql`s."startedAt"`)}, 'elevate', s."userId", 'starts', NULL
    FROM "Session" s JOIN cohort c ON c.id = s."userId"
    WHERE ${elevateScope} AND ${within(Prisma.sql`s."startedAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`s."endedAt"`)}, 'elevate', s."userId", 'completions', NULL
    FROM "Session" s JOIN cohort c ON c.id = s."userId"
    WHERE ${elevateScope} AND s."endedAt" IS NOT NULL AND ${within(Prisma.sql`s."endedAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`r."createdAt"`)}, 'replay', r."userId", 'starts', NULL
    FROM "ReplaySession" r JOIN cohort c ON c.id = r."userId"
    WHERE ${replayScope} AND ${within(Prisma.sql`r."createdAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`res."createdAt"`)}, 'replay', r."userId", 'completions', NULL
    FROM "ReplaySession" r JOIN cohort c ON c.id = r."userId" JOIN "ReplayResult" res ON res."replaySessionId" = r.id
    WHERE ${replayScope} AND r.status = 'completed' AND ${within(Prisma.sql`res."createdAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`ir."createdAt"`)}, 'interviews', ir."ownerId", 'starts', NULL
    FROM "InterviewRun" ir JOIN cohort c ON c.id = ir."ownerId" JOIN "Session" s ON s.id = ir."sessionId"
    WHERE s."discardedAt" IS NULL AND ${within(Prisma.sql`ir."createdAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`s."endedAt"`)}, 'interviews', ir."ownerId", 'completions', NULL
    FROM "InterviewRun" ir JOIN cohort c ON c.id = ir."ownerId" JOIN "Session" s ON s.id = ir."sessionId"
    WHERE s."discardedAt" IS NULL AND s."endedAt" IS NOT NULL AND ${within(Prisma.sql`s."endedAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`pp."createdAt"`)}, 'prepare', s."userId", 'starts', NULL
    FROM "PreparationPractice" pp JOIN "Session" s ON s.id = pp."sessionId" JOIN cohort c ON c.id = s."userId"
    WHERE s."discardedAt" IS NULL AND ${within(Prisma.sql`pp."createdAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`s."endedAt"`)}, 'prepare', s."userId", 'completions', NULL
    FROM "PreparationPractice" pp JOIN "Session" s ON s.id = pp."sessionId" JOIN cohort c ON c.id = s."userId"
    WHERE s."discardedAt" IS NULL AND s."endedAt" IS NOT NULL AND ${within(Prisma.sql`s."endedAt"`)}
    UNION ALL
    SELECT ${day(Prisma.sql`fb."createdAt"`)}, 'feedback', fb."userId", 'completions', NULL
    FROM "UserFeedback" fb JOIN cohort c ON c.id = fb."userId"
    WHERE ${within(Prisma.sql`fb."createdAt"`)}`
}

const elevateScope = Prisma.sql`s."discardedAt" IS NULL AND s.purpose = 'COMMUNICATION' AND s.module = 'elevate'
  AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
  AND NOT EXISTS (SELECT 1 FROM "InterviewRun" ir WHERE ir."sessionId" = s.id)`
const replayScope = Prisma.sql`r.purpose = 'COMMUNICATION'
  AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)`

/**
 * The first day each measure was ever recorded (any learner). Earlier days are "not recorded", not zero: the
 * measure did not exist yet. A feature without starts/completions has none to record ("not applicable").
 */
async function recordedSince(timeZone: string) {
  const rows = await prisma.$queryRaw<SinceRow[]>`
    SELECT 'pageViews:' || ${featureFromPath(Prisma.sql`COALESCE(f.path, f.metadata->>'path')`)} AS key, MIN(f.timestamp) AS first
      FROM "FeatureUsage" f WHERE f.feature = 'app' AND f.action = 'page_view' GROUP BY 1
    UNION ALL
    SELECT 'activeMs:' || ${featureFromPath(Prisma.sql`COALESCE(f.path, f.metadata->>'path')`)}, MIN(f.timestamp)
      FROM "FeatureUsage" f WHERE f.feature = 'app' AND f.action = 'page_exit' AND f."engagementMs" IS NOT NULL GROUP BY 1
    UNION ALL
    SELECT 'actions:' || f.feature, MIN(f.timestamp) FROM "FeatureUsage" f WHERE ${actionPairs(ACTIVITY_FEATURES)} GROUP BY f.feature
    UNION ALL SELECT 'starts:elevate', MIN(s."startedAt") FROM "Session" s WHERE s.module = 'elevate'
    UNION ALL SELECT 'completions:elevate', MIN(s."startedAt") FROM "Session" s WHERE s.module = 'elevate'
    UNION ALL SELECT 'starts:replay', MIN(r."createdAt") FROM "ReplaySession" r
    UNION ALL SELECT 'completions:replay', MIN(r."createdAt") FROM "ReplaySession" r
    UNION ALL SELECT 'starts:interviews', MIN(ir."createdAt") FROM "InterviewRun" ir
    UNION ALL SELECT 'completions:interviews', MIN(ir."createdAt") FROM "InterviewRun" ir
    UNION ALL SELECT 'starts:prepare', MIN(pp."createdAt") FROM "PreparationPractice" pp
    UNION ALL SELECT 'completions:prepare', MIN(pp."createdAt") FROM "PreparationPractice" pp
    UNION ALL SELECT 'completions:feedback', MIN(fb."createdAt") FROM "UserFeedback" fb`
  const day = (instant: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
  const since: Record<string, string | null> = {}
  for (const row of rows) since[row.key] = row.first ? day(new Date(row.first)) : null
  return since
}

export type ActivityTarget = { learnerId: string } | null

export function activityFeatures(filters: AnalyticsFilters): ActivityFeature[] | { error: string } {
  if (!filters.feature) return [...ACTIVITY_FEATURES]
  return (ACTIVITY_FEATURES as readonly string[]).includes(filters.feature) ? [filters.feature as ActivityFeature] : { error: 'Invalid activity feature' }
}

export async function loadDailyActivity(filters: AnalyticsFilters, range: DayRange, target: ActivityTarget) {
  const features = activityFeatures(filters)
  if ('error' in features) return features
  const individual = Boolean(target)
  const cohort = target
    ? Prisma.sql`SELECT u.id FROM "User" u WHERE ${learnerWhere(filters)} AND u.id = ${target.learnerId}`
    : Prisma.sql`SELECT u.id FROM "User" u WHERE ${learnerWhere(filters)}`
  const enabled = await getEnabledFeatures()
  const sources = sourcesFor(filters, enabled)
  const skill = filters.skills.length ? Prisma.sql`AND p.skill IN (${Prisma.join(filters.skills)})` : Prisma.empty
  const featureList = Prisma.join(features)

  const [cohortSize, facts, users, pulse, since] = await Promise.all([
    !individual && demographicFilterActive(filters)
      ? prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM (${cohort}) c`
      : Promise.resolve(null),
    prisma.$queryRaw<FactRow[]>`
      WITH cohort AS (${cohort}), facts AS (${factsSql(Prisma.sql`cohort`, range)})
      SELECT day, feature, kind, COUNT(*)::int AS n, SUM(ms)::float8 AS ms
      FROM facts WHERE feature IN (${featureList}) GROUP BY day, feature, kind`,
    prisma.$queryRaw<UserRow[]>`
      WITH cohort AS (${cohort}), facts AS (${factsSql(Prisma.sql`cohort`, range)})
      SELECT day, feature, COUNT(DISTINCT uid)::int AS users, GROUPING(day)::int AS g_day, GROUPING(feature)::int AS g_feature
      FROM facts WHERE feature IN (${featureList})
      GROUP BY GROUPING SETS ((day, feature), (day), (feature), ())`,
    prisma.$queryRaw<PulseRow[]>`
      WITH cohort AS (${cohort}), entries AS (
        SELECT ${localDaySql(Prisma.sql`p."recordedAt"`, range.timeZone)} AS day, p."sessionId", p."userId"
        FROM "ProgressPulse" p JOIN cohort c ON c.id = p."userId"
        WHERE p."recordedAt" >= ${range.since} AND p."recordedAt" < ${range.until}
          AND p.source IN (${Prisma.join(sources)}) AND ${eligiblePulseSql} ${skill}
      )
      SELECT day, COUNT(*)::int AS entries, COUNT(DISTINCT "sessionId")::int AS sessions, COUNT(DISTINCT "userId")::int AS learners
      FROM entries GROUP BY ROLLUP (day)`,
    recordedSince(range.timeZone),
  ])

  const suppressed = cohortSize !== null && (cohortSize[0]?.n ?? 0) < MIN_COHORT
  const scope = {
    timeZone: range.timeZone,
    activity: { features, note: 'Feature filter applies to activity measures only.' },
    pulse: { sources: sources.filter((s) => s !== '__none__'), skills: filters.skills,
      note: 'Source and skill filters apply to Pulse evidence only; they do not narrow activity.' },
    learners: individual ? 'one learner' : demographicFilterActive(filters) ? 'learners matching the demographic filters' : 'all learners',
    excludes: 'Admin and super-admin accounts. Discarded Elevate sessions are no longer retained and are not counted.',
  }
  const base = { mode: individual ? 'individual' as const : 'aggregate' as const, scope, threshold: MIN_COHORT,
    // First day each measure was recorded for any learner; null = never recorded, 'not_applicable' = no such measure.
    recordedSince: Object.fromEntries(features.map((feature) => [feature, Object.fromEntries(MEASURES.map((m) =>
      [m, measureApplies(feature, m) ? since[`${m}:${feature}`] ?? null : 'not_applicable']))])),
    definitions: {
      measures: MEASURE_DEFINITIONS,
      features: Object.fromEntries(features.map((feature) => [feature, {
        actions: [...(FEATURE_USE_ACTIONS[feature as keyof typeof FEATURE_USE_ACTIONS] ?? [])],
        ...FEATURE_DEFINITIONS[feature],
      }])),
    } }
  if (suppressed) return { ...base, suppressed: true as const, days: null, totals: null }

  const measureValue = (feature: ActivityFeature, measure: Measure, day: string) => {
    if ((measure === 'starts' && !FEATURE_DEFINITIONS[feature].start) || (measure === 'completions' && !FEATURE_DEFINITIONS[feature].completion)) return null
    const first = since[`${measure}:${feature}`]
    if (!first || day < first) return null // never recorded on or before this day
    const row = facts.find((f) => f.day === day && f.feature === feature && f.kind === measure)
    return measure === 'activeMs' ? (row?.ms ?? 0) : (row?.n ?? 0)
  }
  const usersFor = (day: string | null, feature: string | null) =>
    users.find((u) => (day === null ? u.g_day === 1 : u.g_day === 0 && u.day === day) && (feature === null ? u.g_feature === 1 : u.g_feature === 0 && u.feature === feature))?.users ?? 0
  const sumRecorded = (values: Array<number | null>) => values.some((v) => v !== null) ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null

  const days = range.days.map((day) => {
    const perFeature = features.map((feature) => {
      const counts = Object.fromEntries(MEASURES.map((m) => [m, measureValue(feature, m, day)])) as Counts
      return { feature, activeLearners: usersFor(day, feature), ...counts }
    })
    const pulseDay = pulse.find((p) => p.day === day)
    return {
      day,
      activeLearners: usersFor(day, null),
      ...Object.fromEntries(MEASURES.map((m) => [m, sumRecorded(perFeature.map((f) => f[m]))])) as Counts,
      notRecorded: Object.fromEntries(MEASURES.map((m) => [m, perFeature.filter((f) => f[m] === null && measureApplies(f.feature, m)).map((f) => f.feature)])),
      pulseEntries: pulseDay?.entries ?? 0,
      pulseSessions: pulseDay?.sessions ?? 0,
      features: perFeature,
    }
  })
  const pulseTotal = pulse.find((p) => p.day === null)
  return {
    ...base,
    suppressed: false as const,
    days,
    totals: {
      activeLearners: usersFor(null, null),
      byFeature: features.map((feature) => ({ feature, activeLearners: usersFor(null, feature) })),
      ...Object.fromEntries(MEASURES.map((m) => [m, sumRecorded(days.map((d) => d[m]))])) as Counts,
      pulseEntries: pulseTotal?.entries ?? 0,
      pulseSessions: pulseTotal?.sessions ?? 0,
      pulseLearners: pulseTotal?.learners ?? 0,
    },
  }
}

function measureApplies(feature: ActivityFeature, measure: Measure) {
  if (measure === 'starts') return Boolean(FEATURE_DEFINITIONS[feature].start)
  if (measure === 'completions') return Boolean(FEATURE_DEFINITIONS[feature].completion)
  return true
}
