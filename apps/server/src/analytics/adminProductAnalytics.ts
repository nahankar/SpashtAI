import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { eligiblePulseSql } from './pulseEligibility'
import { getEnabledFeatures } from '../lib/featureFlags'
import {
  type AnalyticsFilters,
  numberOrNull,
  presentCohort,
  round1,
} from './adminAnalyticsFilters'
import { MIN_COHORT, PRODUCT_FEATURES, type ProductFeature } from './productEvents'

const COVERAGE = {
  canonical: 'Session, journey, interview, feedback, and Progress Pulse figures use retained product records in the selected range.',
  engagement: 'Active time is measured only while a page is visible and the learner has acted in the last minute. It begins with page-exit events from this release, so earlier visits stay unlabeled rather than zero.',
  historical: 'Older feature events keep their original action names. Milestones added in this release show “not recorded yet” until the first real sample arrives.',
}

export function ageBandSql() {
  return Prisma.sql`CASE
    WHEN u."dateOfBirth" IS NULL THEN 'unknown'
    WHEN EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth")) < 18 THEN 'under_18'
    WHEN EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth")) < 25 THEN '18_24'
    WHEN EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth")) < 35 THEN '25_34'
    WHEN EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth")) < 45 THEN '35_44'
    WHEN EXTRACT(YEAR FROM AGE(CURRENT_TIMESTAMP, u."dateOfBirth")) < 55 THEN '45_54'
    ELSE '55_plus'
  END`
}

export function learnerWhere(filters: AnalyticsFilters) {
  const clauses: Prisma.Sql[] = [Prisma.sql`u.role = 'USER'`]
  if (filters.cities.length) clauses.push(Prisma.sql`u.city IN (${Prisma.join(filters.cities)})`)
  if (filters.states.length) clauses.push(Prisma.sql`u.state IN (${Prisma.join(filters.states)})`)
  if (filters.genders.length) clauses.push(Prisma.sql`u.gender::text IN (${Prisma.join(filters.genders)})`)
  if (filters.ageBands.length) clauses.push(Prisma.sql`(${ageBandSql()}) IN (${Prisma.join(filters.ageBands)})`)
  return Prisma.join(clauses, ' AND ')
}

export function demographicFilterActive(filters: AnalyticsFilters) {
  return Boolean(filters.cities.length || filters.states.length || filters.genders.length || filters.ageBands.length)
}

function learners(filters: AnalyticsFilters) {
  return Prisma.sql`SELECT u.id FROM "User" u WHERE ${learnerWhere(filters)}`
}

export function sourcesFor(filters: AnalyticsFilters, enabled: string[]) {
  const allowed = ['elevate', 'replay'].filter((source) => enabled.includes(source))
  const selected = filters.sources.length ? allowed.filter((source) => filters.sources.includes(source)) : allowed
  return selected.length ? selected : ['__none__']
}

function pulseScope(filters: AnalyticsFilters, sources: string[], withUser = false) {
  const skill = filters.skills.length ? Prisma.sql`AND p.skill IN (${Prisma.join(filters.skills)})` : Prisma.empty
  const user = withUser ? Prisma.sql`JOIN "User" u ON u.id = p."userId"` : Prisma.empty
  return Prisma.sql`
    FROM "ProgressPulse" p
    JOIN (${learners(filters)}) l ON l.id = p."userId"
    ${user}
    WHERE p."recordedAt" >= ${filters.since}
      AND p."recordedAt" < ${filters.until}
      AND p.source IN (${Prisma.join(sources)})
      AND ${eligiblePulseSql}
      ${skill}
  `
}

type CountRow = { entries?: number; users?: number; sessions?: number; tracked?: number; skipped?: number; undecided?: number }
type SkillRow = { skill: string; entries: number; users: number; avg_score: number | null; median_score: number | null }
type MoveRow = { skill: string; users: number; improving: number; stable: number; declining: number; avg_delta: number | null }
type DistRow = { skill: string; users: number; b0: number; b2: number; b4: number; b6: number; b8: number }
type CohortRow = { bucket: string | null; users: number; avg_score: number | null }
type TrendRow = { day: string; skill: string; users: number; avg_score: number | null }
type StatusRow = { source: string; users: number; tracked: number; skipped: number; undecided: number }
type ProfileRow = { learners: number; with_gender: number; with_dob: number; with_pincode: number }
type LanguageRow = {
  sessions: number
  users: number
  median_wpm: number | null
  median_filler_rate: number | null
  median_hedging_rate: number | null
  median_sentence_length: number | null
  median_vocab_diversity: number | null
  median_readability: number | null
  median_coherence: number | null
}

function presentLanguage(source: 'elevate' | 'replay', row: LanguageRow | undefined, filters: AnalyticsFilters) {
  const users = row?.users ?? 0
  const suppressed = demographicFilterActive(filters) && users < MIN_COHORT
  const value = (metric: number | null | undefined) => suppressed ? null : round1(numberOrNull(metric))
  // Stored filler and Replay hedging/vocabulary columns are already percents.
  // Elevate hedging lives in communicationSignals as a 0–1 rate, and Elevate vocabulary is a 0–1 ratio.
  const percent = (metric: number | null | undefined, alreadyPercent: boolean) => {
    const raw = numberOrNull(metric)
    if (suppressed || raw == null) return null
    return round1(alreadyPercent ? raw : raw * 100)
  }
  return {
    source,
    sessions: suppressed ? null : (row?.sessions ?? 0),
    users: suppressed ? null : users,
    suppressed,
    medianWpm: value(row?.median_wpm),
    medianFillerRate: percent(row?.median_filler_rate, true),
    medianHedgingRate: percent(row?.median_hedging_rate, source === 'replay'),
    medianSentenceLength: value(row?.median_sentence_length),
    medianVocabDiversity: percent(row?.median_vocab_diversity, source === 'replay'),
    medianReadability: value(row?.median_readability),
    medianCoherence: value(row?.median_coherence),
  }
}

async function loadLanguageAnalytics(filters: AnalyticsFilters, sources: Array<'elevate' | 'replay'>) {
  const [elevate, replay] = await Promise.all([
    sources.includes('elevate') ? prisma.$queryRaw<LanguageRow[]>`
      SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT s."userId")::int AS users,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m."userWpm") FILTER (WHERE m."userWpm" > 0) AS median_wpm,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m."userFillerRate") FILTER (WHERE m."communicationSignals" IS NOT NULL OR m."userFillerCount" > 0) AS median_filler_rate,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (m."communicationSignals"#>>'{hedging,rate}')::double precision)
          FILTER (WHERE (m."communicationSignals"#>>'{hedging,rate}') ~ '^[0-9]+(\\.[0-9]+)?$') AS median_hedging_rate,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m."userAvgSentenceLength") FILTER (WHERE m."userAvgSentenceLength" > 0) AS median_sentence_length,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m."userVocabDiversity") FILTER (WHERE m."userVocabDiversity" > 0) AS median_vocab_diversity,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (m."communicationSignals"#>>'{sentenceComplexity,readability}')::double precision)
          FILTER (WHERE (m."communicationSignals"#>>'{sentenceComplexity,readability}') ~ '^[0-9]+(\\.[0-9]+)?$') AS median_readability,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (m."communicationSignals"#>>'{topicCoherence,avgSimilarity}')::double precision)
          FILTER (WHERE (m."communicationSignals"#>>'{topicCoherence,avgSimilarity}') ~ '^[0-9]+(\\.[0-9]+)?$') AS median_coherence
      FROM "SessionMetrics" m
      JOIN "Session" s ON s.id = m."sessionId"
      JOIN (${learners(filters)}) l ON l.id = s."userId"
      WHERE s."discardedAt" IS NULL AND s.purpose = 'COMMUNICATION' AND s.module = 'elevate'
        AND s."startedAt" >= ${filters.since} AND s."startedAt" < ${filters.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "InterviewRun" ir WHERE ir."sessionId" = s.id)
        AND (m."communicationSignals" IS NOT NULL OR m."userWpm" > 0 OR m."userFillerCount" > 0)
    ` : Promise.resolve([]),
    sources.includes('replay') ? prisma.$queryRaw<LanguageRow[]>`
      SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT r."userId")::int AS users,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."wordsPerMinute") FILTER (WHERE res."wordsPerMinute" > 0) AS median_wpm,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."fillerWordRate") FILTER (WHERE res."communicationSignals" IS NOT NULL OR res."fillerWordCount" > 0) AS median_filler_rate,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."hedgingRate") FILTER (WHERE res."communicationSignals" IS NOT NULL OR res."hedgingCount" > 0) AS median_hedging_rate,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."avgSentenceLength") FILTER (WHERE res."avgSentenceLength" > 0) AS median_sentence_length,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."vocabularyDiversity") FILTER (WHERE res."vocabularyDiversity" > 0) AS median_vocab_diversity,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (res."communicationSignals"#>>'{sentenceComplexity,readability}')::double precision)
          FILTER (WHERE (res."communicationSignals"#>>'{sentenceComplexity,readability}') ~ '^[0-9]+(\\.[0-9]+)?$') AS median_readability,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (res."communicationSignals"#>>'{topicCoherence,avgSimilarity}')::double precision)
          FILTER (WHERE (res."communicationSignals"#>>'{topicCoherence,avgSimilarity}') ~ '^[0-9]+(\\.[0-9]+)?$') AS median_coherence
      FROM "ReplayResult" res
      JOIN "ReplaySession" r ON r.id = res."replaySessionId"
      JOIN (${learners(filters)}) l ON l.id = r."userId"
      WHERE r.purpose = 'COMMUNICATION' AND res."createdAt" >= ${filters.since} AND res."createdAt" < ${filters.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)
    ` : Promise.resolve([]),
  ])
  return [
    ...(sources.includes('elevate') ? [presentLanguage('elevate', elevate[0], filters)] : []),
    ...(sources.includes('replay') ? [presentLanguage('replay', replay[0], filters)] : []),
  ]
}

function redactScores(suppress: boolean, users: number, metrics: Record<string, unknown>) {
  if (suppress) return { users: null, suppressed: true, threshold: MIN_COHORT }
  return { users, suppressed: false, threshold: MIN_COHORT, ...metrics }
}

export async function loadProgressPulseReport(filters: AnalyticsFilters) {
  const enabled = await getEnabledFeatures()
  const sources = sourcesFor(filters, enabled)
  const scope = pulseScope(filters, sources)
  const [headline, skills, movement, distribution, status, profiles, gender, age, state, trends, language] = await Promise.all([
    prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::int AS entries, COUNT(DISTINCT p."userId")::int AS users, COUNT(DISTINCT p."sessionId")::int AS sessions ${scope}`,
    prisma.$queryRaw<SkillRow[]>`SELECT p.skill, COUNT(*)::int AS entries, COUNT(DISTINCT p."userId")::int AS users, AVG(p.score) AS avg_score, PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p.score) AS median_score ${scope} GROUP BY p.skill ORDER BY p.skill`,
    prisma.$queryRaw<MoveRow[]>`
      WITH ranked AS (
        SELECT p."userId", p.skill, p.score,
          ROW_NUMBER() OVER (PARTITION BY p."userId", p.skill ORDER BY p."recordedAt" ASC, p.id ASC) AS first_rn,
          ROW_NUMBER() OVER (PARTITION BY p."userId", p.skill ORDER BY p."recordedAt" DESC, p.id DESC) AS last_rn,
          COUNT(*) OVER (PARTITION BY p."userId", p.skill) AS samples
        ${scope}
      ),
      paired AS (
        SELECT f.skill, f.score AS first_score, l.score AS last_score
        FROM ranked f
        JOIN ranked l ON l."userId" = f."userId" AND l.skill = f.skill AND l.last_rn = 1
        WHERE f.first_rn = 1 AND f.samples >= 2
      )
      SELECT skill, COUNT(*)::int AS users,
        COUNT(*) FILTER (WHERE last_score - first_score > 0.2)::int AS improving,
        COUNT(*) FILTER (WHERE ABS(last_score - first_score) <= 0.2)::int AS stable,
        COUNT(*) FILTER (WHERE first_score - last_score > 0.2)::int AS declining,
        AVG(last_score - first_score) AS avg_delta
      FROM paired GROUP BY skill`,
    prisma.$queryRaw<DistRow[]>`
      WITH latest AS (
        SELECT DISTINCT ON (p."userId", p.skill) p.skill, p.score, p."userId"
        ${scope}
        ORDER BY p."userId", p.skill, p."recordedAt" DESC, p.id DESC
      )
      SELECT skill, COUNT(DISTINCT "userId")::int AS users,
        COUNT(*) FILTER (WHERE score < 2)::int AS b0,
        COUNT(*) FILTER (WHERE score >= 2 AND score < 4)::int AS b2,
        COUNT(*) FILTER (WHERE score >= 4 AND score < 6)::int AS b4,
        COUNT(*) FILTER (WHERE score >= 6 AND score < 8)::int AS b6,
        COUNT(*) FILTER (WHERE score >= 8)::int AS b8
      FROM latest GROUP BY skill`,
    prisma.$queryRaw<StatusRow[]>`
      SELECT 'elevate' AS source, COUNT(DISTINCT s."userId")::int AS users,
        COUNT(*) FILTER (WHERE s."progressPulseStatus" = 'tracked')::int AS tracked,
        COUNT(*) FILTER (WHERE s."progressPulseStatus" = 'skipped')::int AS skipped,
        COUNT(*) FILTER (WHERE s."endedAt" IS NOT NULL AND s."progressPulseStatus" IS NULL)::int AS undecided
      FROM "Session" s JOIN (${learners(filters)}) l ON l.id = s."userId"
      WHERE s."discardedAt" IS NULL AND s.purpose = 'COMMUNICATION'
        AND s."startedAt" >= ${filters.since} AND s."startedAt" < ${filters.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
      UNION ALL
      SELECT 'replay', COUNT(DISTINCT r."userId")::int,
        COUNT(*) FILTER (WHERE r."progressPulseStatus" = 'tracked')::int,
        COUNT(*) FILTER (WHERE r."progressPulseStatus" = 'skipped')::int,
        COUNT(*) FILTER (WHERE r.status = 'completed' AND r."progressPulseStatus" IS NULL)::int
      FROM "ReplaySession" r JOIN (${learners(filters)}) l ON l.id = r."userId"
      WHERE r.purpose = 'COMMUNICATION' AND r."createdAt" >= ${filters.since} AND r."createdAt" < ${filters.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)`,
    prisma.$queryRaw<ProfileRow[]>`
      SELECT COUNT(*)::int AS learners,
        COUNT(*) FILTER (WHERE u.gender IS NOT NULL)::int AS with_gender,
        COUNT(*) FILTER (WHERE u."dateOfBirth" IS NOT NULL)::int AS with_dob,
        COUNT(*) FILTER (WHERE u.pincode IS NOT NULL)::int AS with_pincode
      FROM "User" u WHERE ${learnerWhere(filters)}`,
    prisma.$queryRaw<CohortRow[]>`SELECT COALESCE(u.gender::text, 'unknown') AS bucket, COUNT(DISTINCT p."userId")::int AS users, AVG(p.score) AS avg_score ${pulseScope(filters, sources, true)} GROUP BY 1`,
    prisma.$queryRaw<CohortRow[]>`SELECT ${ageBandSql()} AS bucket, COUNT(DISTINCT p."userId")::int AS users, AVG(p.score) AS avg_score ${pulseScope(filters, sources, true)} GROUP BY 1`,
    prisma.$queryRaw<CohortRow[]>`SELECT COALESCE(u.state, 'unknown') AS bucket, COUNT(DISTINCT p."userId")::int AS users, AVG(p.score) AS avg_score ${pulseScope(filters, sources, true)} GROUP BY 1`,
    prisma.$queryRaw<TrendRow[]>`
      SELECT to_char(date_trunc('day', p."recordedAt"), 'YYYY-MM-DD') AS day, p.skill,
        COUNT(DISTINCT p."userId")::int AS users, AVG(p.score) AS avg_score
      ${scope} GROUP BY 1, 2 ORDER BY 1, 2`,
    loadLanguageAnalytics(filters, sources.filter((source): source is 'elevate' | 'replay' => source === 'elevate' || source === 'replay')),
  ])

  const users = headline[0]?.users ?? 0
  const suppress = demographicFilterActive(filters) && users < MIN_COHORT
  const cohort = (rows: CohortRow[]) => rows.map((row) => presentCohort(row.users, {
    bucket: row.bucket || 'unknown',
    averageScore: round1(numberOrNull(row.avg_score)),
  }))
  return {
    range: { days: filters.days, since: filters.since.toISOString(), until: filters.until.toISOString() },
    filters: { ...filters, since: filters.since.toISOString(), until: filters.until.toISOString() },
    coverage: COVERAGE,
    enabledFeatures: enabled,
    sources,
    summary: redactScores(suppress, users, {
      entries: headline[0]?.entries ?? 0,
      sessions: headline[0]?.sessions ?? 0,
    }),
    skills: suppress ? [] : skills.map((row) => ({
      skill: row.skill,
      entries: row.entries,
      ...presentCohort(row.users, {
        average: round1(numberOrNull(row.avg_score)),
        median: round1(numberOrNull(row.median_score)),
      }),
    })),
    movement: suppress ? [] : movement.map((row) => presentCohort(row.users, {
      skill: row.skill,
      improving: row.improving,
      stable: row.stable,
      declining: row.declining,
      averageDelta: round1(numberOrNull(row.avg_delta)),
    })),
    distribution: suppress ? [] : distribution.map((row) => presentCohort(row.users, {
      skill: row.skill,
      bands: [
        { label: '0–2', count: row.b0 },
        { label: '2–4', count: row.b2 },
        { label: '4–6', count: row.b4 },
        { label: '6–8', count: row.b6 },
        { label: '8–10', count: row.b8 },
      ],
    })),
    decisions: status.map((row) => ({
      source: row.source,
      tracked: row.tracked,
      skipped: row.skipped,
      undecided: row.undecided,
      users: row.users,
    })),
    profileCompleteness: {
      learners: profiles[0]?.learners ?? 0,
      gender: profiles[0]?.with_gender ?? 0,
      dateOfBirth: profiles[0]?.with_dob ?? 0,
      pincode: profiles[0]?.with_pincode ?? 0,
    },
    cohorts: { gender: cohort(gender), ageBand: cohort(age), state: cohort(state) },
    trends: suppress ? [] : trends.filter((row) => row.users >= MIN_COHORT).map((row) => ({
      day: row.day,
      skill: row.skill,
      users: row.users,
      average: round1(numberOrNull(row.avg_score)),
    })),
    language: suppress ? language.map((row) => ({ ...row, suppressed: true, sessions: null, users: null, medianWpm: null, medianFillerRate: null, medianHedgingRate: null, medianSentenceLength: null, medianVocabDiversity: null, medianReadability: null, medianCoherence: null })) : language,
  }
}

type MetricRow = Record<string, number | string | null>
type ActionRow = { feature: string; action: string; users: number; events: number; median_ms: number | null; p75_ms: number | null }
type DayRow = { day: string; feature: string; users: number; events: number }
type SampleRow = { feature: string; action: string; n: number }
type PageViewSummaryRow = { views: number; users: number; routes: number }
type PageViewRouteRow = {
  path: string
  views: number
  users: number
  exits: number
  median_active_ms: number | null
  p75_active_ms: number | null
}
type PageViewTrendRow = { day: string; views: number; users: number }

const FUNNELS: Record<string, Array<{ action: string; label: string; canonical?: string }>> = {
  replay: [
    { action: 'session_create', label: 'Upload created' },
    { action: 'analyze', label: 'Processing started' },
    { action: 'process_completed', label: 'Processing finished' },
    { action: 'results_viewed', label: 'Results viewed' },
    { action: 'exported', label: 'Exported' },
  ],
  elevate: [
    { action: 'session_start', label: 'Session started' },
    { action: 'rtc_connected', label: 'Voice connected' },
    { action: 'session_end', label: 'Session ended' },
    { action: 'results_viewed', label: 'Results viewed' },
    { action: 'exported', label: 'Exported' },
  ],
  interviews: [
    { action: 'practice_start', label: 'Run started' },
    { action: 'answer_completed', label: 'Answer completed' },
    { action: 'run_completed', label: 'Run ended' },
  ],
  prepare: [
    { action: 'journey_created', label: 'Journey created' },
    { action: 'event_practice_started', label: 'Practice started' },
    { action: 'event_practice_completed', label: 'Practice completed' },
    { action: 'reflection_saved', label: 'Reflection saved' },
  ],
  progress_pulse: [
    { action: 'dashboard_viewed', label: 'Dashboard viewed' },
    { action: 'tracked', label: 'Scores tracked' },
    { action: 'skipped', label: 'Scores skipped' },
  ],
  feedback: [
    { action: 'form_started', label: 'Form started' },
    { action: 'submitted', label: 'Submitted' },
    { action: 'first_response', label: 'First admin response' },
    { action: 'resolved', label: 'Resolved' },
  ],
}

function featureFromPath(column: Prisma.Sql) {
  return Prisma.sql`CASE
    WHEN ${column} LIKE '/replay%' THEN 'replay'
    WHEN ${column} LIKE '/elevate%' THEN 'elevate'
    WHEN ${column} LIKE '/interviews%' THEN 'interviews'
    WHEN ${column} LIKE '/progress%' THEN 'progress_pulse'
    WHEN ${column} LIKE '/prepare%' THEN 'prepare'
    WHEN ${column} LIKE '/feedback%' THEN 'feedback'
    ELSE 'app'
  END`
}

export async function loadPageViewReport(filters: AnalyticsFilters) {
  const [summary, routes, trends] = await Promise.all([
    prisma.$queryRaw<PageViewSummaryRow[]>`
      SELECT COUNT(*)::int AS views,
        COUNT(DISTINCT f."userId")::int AS users,
        COUNT(DISTINCT COALESCE(f.path, f.metadata->>'path'))::int AS routes
      FROM "FeatureUsage" f
      JOIN (${learners(filters)}) l ON l.id = f."userId"
      WHERE f.feature = 'app' AND f.action = 'page_view'
        AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}`,
    prisma.$queryRaw<PageViewRouteRow[]>`
      WITH page_views AS (
        SELECT COALESCE(f.path, f.metadata->>'path', 'unknown') AS path,
          COUNT(*)::int AS views,
          COUNT(DISTINCT f."userId")::int AS users
        FROM "FeatureUsage" f
        JOIN (${learners(filters)}) l ON l.id = f."userId"
        WHERE f.feature = 'app' AND f.action = 'page_view'
          AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
        GROUP BY 1
      ),
      page_exits AS (
        SELECT COALESCE(f.path, f.metadata->>'path', 'unknown') AS path,
          COUNT(*)::int AS exits,
          PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f."engagementMs")
            FILTER (WHERE f."engagementMs" IS NOT NULL) AS median_active_ms,
          PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY f."engagementMs")
            FILTER (WHERE f."engagementMs" IS NOT NULL) AS p75_active_ms
        FROM "FeatureUsage" f
        JOIN (${learners(filters)}) l ON l.id = f."userId"
        WHERE f.feature = 'app' AND f.action = 'page_exit'
          AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
        GROUP BY 1
      )
      SELECT v.path, v.views, v.users, COALESCE(e.exits, 0)::int AS exits,
        e.median_active_ms, e.p75_active_ms
      FROM page_views v
      LEFT JOIN page_exits e ON e.path = v.path
      ORDER BY v.views DESC, v.path
      LIMIT 20`,
    prisma.$queryRaw<PageViewTrendRow[]>`
      SELECT to_char(date_trunc('day', f.timestamp), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS views,
        COUNT(DISTINCT f."userId")::int AS users
      FROM "FeatureUsage" f
      JOIN (${learners(filters)}) l ON l.id = f."userId"
      WHERE f.feature = 'app' AND f.action = 'page_view'
        AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
      GROUP BY 1 ORDER BY 1`,
  ])
  const headline = summary[0] ?? { views: 0, users: 0, routes: 0 }
  const suppressed = demographicFilterActive(filters) && headline.users < MIN_COHORT
  return {
    range: { days: filters.days, since: filters.since.toISOString(), until: filters.until.toISOString() },
    coverage: {
      firstParty: 'Page views come from authenticated SpashtAI product events. Admin and super-admin traffic is excluded.',
      clarity: 'Microsoft Clarity provides consented recordings, heatmaps, and UX diagnostics in its own project dashboard.',
    },
    summary: suppressed ? {
      views: null,
      users: null,
      routes: null,
      viewsPerUser: null,
      suppressed: true,
    } : {
      views: headline.views,
      users: headline.users,
      routes: headline.routes,
      viewsPerUser: headline.users > 0 ? round1(headline.views / headline.users) : null,
      suppressed: false,
    },
    routes: suppressed ? [] : routes.map((row) => ({
      path: row.path,
      views: row.views,
      users: row.users,
      exits: row.exits,
      medianActiveMs: numberOrNull(row.median_active_ms),
      p75ActiveMs: numberOrNull(row.p75_active_ms),
    })),
    trends: suppressed ? [] : trends,
    privacyThreshold: MIN_COHORT,
  }
}

export async function loadFeatureReport(filters: AnalyticsFilters) {
  const enabled = await getEnabledFeatures()
  const features = [...PRODUCT_FEATURES]
  const where = Prisma.sql`
    FROM "FeatureUsage" f
    JOIN (${learners(filters)}) l ON l.id = f."userId"
    WHERE f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
      AND f.feature IN (${Prisma.join(features)})
  `
  const [actions, days, samples, replay, elevate, interviews, prepare, feedback, engagement, activity] = await Promise.all([
    prisma.$queryRaw<ActionRow[]>`
      SELECT f.feature, f.action, COUNT(DISTINCT f."userId")::int AS users, COUNT(*)::int AS events,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f."engagementMs") FILTER (WHERE f."engagementMs" IS NOT NULL) AS median_ms,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY f."engagementMs") FILTER (WHERE f."engagementMs" IS NOT NULL) AS p75_ms
      ${where} GROUP BY f.feature, f.action`,
    prisma.$queryRaw<DayRow[]>`
      SELECT to_char(date_trunc('day', f.timestamp), 'YYYY-MM-DD') AS day, f.feature,
        COUNT(DISTINCT f."userId")::int AS users, COUNT(*)::int AS events
      ${where} GROUP BY 1, 2 ORDER BY 1`,
    prisma.$queryRaw<SampleRow[]>`SELECT feature, action, COUNT(*)::int AS n FROM "FeatureUsage" GROUP BY feature, action`,
    canonicalReplay(filters),
    canonicalElevate(filters),
    canonicalInterviews(filters),
    canonicalPrepare(filters),
    canonicalFeedback(filters),
    prisma.$queryRaw<Array<{ feature: string; users: number; median_ms: number | null; p75_ms: number | null }>>`
      SELECT ${featureFromPath(Prisma.sql`f.path`)} AS feature, COUNT(DISTINCT f."userId")::int AS users,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f."engagementMs") AS median_ms,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY f."engagementMs") AS p75_ms
      FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
      WHERE f.action = 'page_exit' AND f."engagementMs" IS NOT NULL
        AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
      GROUP BY 1`,
    prisma.$queryRaw<Array<{ feature: string; users: number; avg_dau: number | null; first_time: number; returning: number }>>`
      WITH touches AS (
        SELECT f.feature, f."userId", MIN(f.timestamp) AS first_at
        FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
        WHERE f.feature IN (${Prisma.join(features)})
        GROUP BY f.feature, f."userId"
      ),
      in_range AS (
        SELECT DISTINCT f.feature, f."userId"
        FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
        WHERE f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
          AND f.feature IN (${Prisma.join(features)})
      ),
      daily AS (
        SELECT feature, AVG(users) AS avg_dau FROM (
          SELECT f.feature, date_trunc('day', f.timestamp) AS day, COUNT(DISTINCT f."userId") AS users
          FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
          WHERE f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
            AND f.feature IN (${Prisma.join(features)})
          GROUP BY 1, 2
        ) d GROUP BY feature
      )
      SELECT t.feature, COUNT(DISTINCT r."userId")::int AS users, d.avg_dau,
        COUNT(DISTINCT r."userId") FILTER (WHERE t.first_at >= ${filters.since})::int AS first_time,
        COUNT(DISTINCT r."userId") FILTER (WHERE t.first_at < ${filters.since})::int AS returning
      FROM touches t
      JOIN in_range r ON r.feature = t.feature AND r."userId" = t."userId"
      LEFT JOIN daily d ON d.feature = t.feature
      GROUP BY t.feature, d.avg_dau`,
  ])
  const seen = new Set(samples.map((row) => `${row.feature}:${row.action}`))
  const byFeature = (feature: string) => actions.filter((row) => row.feature === feature)
  const summaryFor = (feature: ProductFeature) => {
    const rows = byFeature(feature)
    const users = activity.find((row) => row.feature === feature)
    const time = engagement.find((row) => row.feature === feature)
    const unique = users?.users ?? 0
    const dau = numberOrNull(users?.avg_dau)
    return {
      events: rows.reduce((sum, row) => sum + row.events, 0),
      uniqueUsers: unique,
      firstTime: users?.first_time ?? 0,
      returning: users?.returning ?? 0,
      averageDailyUsers: dau == null ? null : round1(dau),
      stickiness: unique > 0 && dau != null ? round1(dau / unique) : null,
      medianActiveMs: time ? numberOrNull(time.median_ms) : null,
      p75ActiveMs: time ? numberOrNull(time.p75_ms) : null,
      activeTimeStatus: time ? 'recorded' : 'not_yet_recorded',
    }
  }
  const funnelFor = (feature: string) => (FUNNELS[feature] ?? []).map((step) => {
    const row = actions.find((item) => item.feature === feature && item.action === step.action)
    const recorded = seen.has(`${feature}:${step.action}`)
    return {
      ...step,
      users: recorded ? (row?.users ?? 0) : null,
      events: recorded ? (row?.events ?? 0) : null,
      status: recorded ? 'recorded' : 'not_yet_recorded',
    }
  })
  const retention = filters.days >= 14 ? await loadRetention(filters, features) : features.map((feature) => ({
    feature, status: 'insufficient_range' as const, cohort: null, returned: null,
  }))
  return {
    range: { days: filters.days, since: filters.since.toISOString(), until: filters.until.toISOString() },
    coverage: COVERAGE,
    enabledFeatures: enabled,
    usage: actions.map((row) => ({ feature: row.feature, action: row.action, _count: { id: row.events }, users: row.users })),
    summary: Object.fromEntries(features.filter((feature) => feature !== 'app').map((feature) => [feature, summaryFor(feature)])),
    funnels: Object.fromEntries(Object.keys(FUNNELS).map((feature) => [feature, funnelFor(feature)])),
    trends: days,
    retention,
    canonical: { replay, elevate, interviews, prepare, feedback },
    language: await loadLanguageAnalytics(filters, ['elevate', 'replay']),
    actions,
  }
}

async function loadRetention(filters: AnalyticsFilters, features: readonly string[]) {
  const week = new Date(filters.since.getTime() + 7 * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<Array<{ feature: string; cohort: number; returned: number }>>`
    WITH first_week AS (
      SELECT DISTINCT f.feature, f."userId"
      FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
      WHERE f.timestamp >= ${filters.since} AND f.timestamp < ${week}
        AND f.feature IN (${Prisma.join(features)})
    ),
    second_week AS (
      SELECT DISTINCT f.feature, f."userId"
      FROM "FeatureUsage" f JOIN (${learners(filters)}) l ON l.id = f."userId"
      WHERE f.timestamp >= ${week} AND f.timestamp < ${filters.until}
        AND f.feature IN (${Prisma.join(features)})
    )
    SELECT fw.feature, COUNT(*)::int AS cohort,
      COUNT(*) FILTER (WHERE sw."userId" IS NOT NULL)::int AS returned
    FROM first_week fw
    LEFT JOIN second_week sw ON sw.feature = fw.feature AND sw."userId" = fw."userId"
    GROUP BY fw.feature`
  return features.map((feature) => {
    const row = rows.find((item) => item.feature === feature)
    const cohort = row?.cohort ?? 0
    if (cohort < MIN_COHORT) return { feature, status: 'suppressed' as const, cohort: null, returned: null }
    return { feature, status: 'recorded' as const, cohort, returned: row?.returned ?? 0 }
  })
}

async function canonicalReplay(filters: AnalyticsFilters) {
  const rows = await prisma.$queryRaw<MetricRow[]>`
    SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT r."userId")::int AS users,
      COUNT(*) FILTER (WHERE r.status = 'completed')::int AS completed,
      COUNT(*) FILTER (WHERE r.status = 'failed')::int AS failed,
      COALESCE(SUM(r."viewCount"), 0)::int AS views,
      COALESCE(SUM(r."exportCount"), 0)::int AS exports,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY res."processingTimeMs") FILTER (WHERE res."processingTimeMs" > 0) AS median_processing_ms
    FROM "ReplaySession" r
    JOIN (${learners(filters)}) l ON l.id = r."userId"
    LEFT JOIN "ReplayResult" res ON res."replaySessionId" = r.id
    WHERE r.purpose = 'COMMUNICATION' AND r."createdAt" >= ${filters.since} AND r."createdAt" < ${filters.until}
      AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)`
  return rows[0] ?? {}
}

async function canonicalElevate(filters: AnalyticsFilters) {
  const rows = await prisma.$queryRaw<MetricRow[]>`
    SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT s."userId")::int AS users,
      COUNT(*) FILTER (WHERE s."endedAt" IS NOT NULL)::int AS completed,
      COUNT(*) FILTER (WHERE s."retainedAt" IS NOT NULL)::int AS retained,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s."durationSec") FILTER (WHERE s."durationSec" IS NOT NULL) AS median_duration_sec,
      PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY s."durationSec") FILTER (WHERE s."durationSec" IS NOT NULL) AS p75_duration_sec
    FROM "Session" s JOIN (${learners(filters)}) l ON l.id = s."userId"
    WHERE s."discardedAt" IS NULL AND s.purpose = 'COMMUNICATION' AND s.module = 'elevate'
      AND s."startedAt" >= ${filters.since} AND s."startedAt" < ${filters.until}
      AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
      AND NOT EXISTS (SELECT 1 FROM "InterviewRun" ir WHERE ir."sessionId" = s.id)`
  return rows[0] ?? {}
}

async function canonicalInterviews(filters: AnalyticsFilters) {
  const rows = await prisma.$queryRaw<MetricRow[]>`
    WITH runs AS (
      SELECT r.id, r."ownerId", s."endedAt", s."durationSec"
      FROM "InterviewRun" r
      JOIN (${learners(filters)}) l ON l.id = r."ownerId"
      JOIN "Session" s ON s.id = r."sessionId"
      WHERE r."createdAt" >= ${filters.since} AND r."createdAt" < ${filters.until} AND s."discardedAt" IS NULL
    )
    SELECT COUNT(*)::int AS runs, COUNT(DISTINCT runs."ownerId")::int AS users,
      COUNT(*) FILTER (WHERE runs."endedAt" IS NOT NULL)::int AS ended,
      COUNT(a.id) FILTER (WHERE a.status = 'ANSWERED')::int AS answered,
      COUNT(a.id) FILTER (WHERE a.status = 'SKIPPED')::int AS skipped,
      COUNT(a.id) FILTER (WHERE a.status = 'INCOMPLETE')::int AS incomplete,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY run_duration."durationSec")
        FROM runs run_duration WHERE run_duration."durationSec" IS NOT NULL) AS median_duration_sec
    FROM runs
    LEFT JOIN "InterviewAttempt" a ON a."runId" = runs.id`
  return rows[0] ?? {}
}

async function canonicalPrepare(filters: AnalyticsFilters) {
  const rows = await prisma.$queryRaw<MetricRow[]>`
    SELECT COUNT(DISTINCT p.id) FILTER (WHERE p."createdAt" >= ${filters.since})::int AS journeys,
      COUNT(DISTINCT p."userId")::int AS users,
      COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'COMPLETED' AND p."createdAt" >= ${filters.since})::int AS completed,
      COUNT(DISTINCT pr.id)::int AS practices,
      COUNT(DISTINCT rec.id)::int AS recordings,
      COUNT(DISTINCT ref.id)::int AS reflections,
      COUNT(DISTINCT q.id)::int AS questions
    FROM "Preparation" p
    JOIN (${learners(filters)}) l ON l.id = p."userId"
    LEFT JOIN "PreparationPractice" pr ON pr."preparationId" = p.id AND pr."createdAt" >= ${filters.since} AND pr."createdAt" < ${filters.until}
    LEFT JOIN "PreparationRecording" rec ON rec."preparationId" = p.id AND rec."createdAt" >= ${filters.since} AND rec."createdAt" < ${filters.until}
    LEFT JOIN "StageReflection" ref ON ref."preparationId" = p.id AND ref."createdAt" >= ${filters.since} AND ref."createdAt" < ${filters.until}
    LEFT JOIN "InterviewQuestion" q ON q."preparationId" = p.id AND q."createdAt" >= ${filters.since} AND q."createdAt" < ${filters.until}
    WHERE p."createdAt" < ${filters.until}`
  return rows[0] ?? {}
}

async function canonicalFeedback(filters: AnalyticsFilters) {
  const rows = await prisma.$queryRaw<MetricRow[]>`
    SELECT COUNT(*)::int AS submitted, COUNT(DISTINCT f."userId")::int AS users,
      COUNT(*) FILTER (WHERE f."sessionId" IS NOT NULL)::int AS linked,
      COUNT(*) FILTER (WHERE f.type::text = 'ISSUE')::int AS issues,
      COUNT(*) FILTER (WHERE f.type::text = 'FEATURE_REQUEST')::int AS requests,
      COUNT(*) FILTER (WHERE f.status::text = 'OPEN')::int AS open,
      COUNT(*) FILTER (WHERE f."acknowledgedAt" IS NOT NULL)::int AS acknowledged,
      COUNT(*) FILTER (WHERE f.status::text IN ('IMPLEMENTED', 'PARKED'))::int AS resolved,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (f."acknowledgedAt" - f."createdAt")))
        FILTER (WHERE f."acknowledgedAt" IS NOT NULL) AS median_first_response_sec
    FROM "UserFeedback" f JOIN (${learners(filters)}) l ON l.id = f."userId"
    WHERE f."createdAt" >= ${filters.since} AND f."createdAt" < ${filters.until}`
  return rows[0] ?? {}
}

export async function loadFeatureUsers(filters: AnalyticsFilters) {
  if (!filters.feature || !(PRODUCT_FEATURES as readonly string[]).includes(filters.feature)) {
    return { error: 'Invalid feature' as const }
  }
  if (demographicFilterActive(filters)) {
    const count = await prisma.$queryRaw<Array<{ users: number }>>`
      SELECT COUNT(*)::int AS users FROM (${learners(filters)}) l`
    if ((count[0]?.users ?? 0) < MIN_COHORT) {
      return { users: [], suppressed: true, page: filters.page, pageSize: 20 }
    }
  }
  const offset = (filters.page - 1) * 20
  const rows = await prisma.$queryRaw<Array<{ id: string; email: string; firstName: string | null; lastName: string | null; events: number; last_at: Date; median_ms: number | null }>>`
    SELECT u.id, u.email, u."firstName" AS "firstName", u."lastName" AS "lastName",
      COUNT(*)::int AS events, MAX(f.timestamp) AS last_at,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY f."engagementMs") FILTER (WHERE f."engagementMs" IS NOT NULL) AS median_ms
    FROM "FeatureUsage" f
    JOIN "User" u ON u.id = f."userId"
    JOIN (${learners(filters)}) l ON l.id = u.id
    WHERE f.feature = ${filters.feature} AND f.timestamp >= ${filters.since} AND f.timestamp < ${filters.until}
    GROUP BY u.id
    ORDER BY events DESC, last_at DESC
    LIMIT 20 OFFSET ${offset}`
  return {
    suppressed: false,
    page: filters.page,
    pageSize: 20,
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: [row.firstName, row.lastName].filter(Boolean).join(' '),
      events: row.events,
      lastActiveAt: row.last_at ? new Date(row.last_at).toISOString() : null,
      medianActiveMs: numberOrNull(row.median_ms),
    })),
  }
}

export async function loadOverviewHeadlines() {
  const [pulse, interviews] = await Promise.all([
    prisma.$queryRaw<Array<{ users: number }>>`SELECT COUNT(DISTINCT "userId")::int AS users FROM "ProgressPulse" WHERE ${eligiblePulseSql}`,
    prisma.$queryRaw<Array<{ runs: number }>>`SELECT COUNT(*)::int AS runs FROM "InterviewRun"`,
  ])
  return {
    pulseParticipants: pulse[0]?.users ?? 0,
    interviewRuns: interviews[0]?.runs ?? 0,
  }
}
