import { Prisma } from '@prisma/client'
import { type DayRange, localDaySql } from './reportDays'
import { prisma } from '../lib/prisma'
import { getEnabledFeatures } from '../lib/featureFlags'
import { eligiblePulseSql } from './pulseEligibility'
import { type AnalyticsFilters, round1 } from './adminAnalyticsFilters'
import { demographicFilterActive, learnerWhere, sourcesFor } from './adminProductAnalytics'

/**
 * Individual-learner reporting for Admin analytics. Authorized individual detail is a separate mode from aggregate
 * reports: it never relaxes aggregate small-cohort suppression, and it is reached only with an explicit learner id
 * (resolved server-side, never a name or email). Learner scope keeps the existing rule: role = 'USER' (admins and
 * super admins are excluded); there is no separate test-account flag.
 */

export { REPORT_TIMEZONE, dayRange, localDaySql, presentRange, zonedMidnight, type DayRange } from './reportDays'

// ---- identity -------------------------------------------------------------------------------------------------

export type LearnerSummary = { id: string; name: string; email: string; city: string | null; state: string | null; joinedAt: string; lastActiveAt: string | null }
type LearnerRow = { id: string; email: string; firstName: string | null; lastName: string | null; city: string | null; state: string | null; createdAt: Date; lastActiveAt: Date | null }

function present(row: LearnerRow): LearnerSummary {
  return { id: row.id, name: [row.firstName, row.lastName].filter(Boolean).join(' '), email: row.email, city: row.city, state: row.state,
    joinedAt: row.createdAt.toISOString(), lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null }
}

/** Learners matching a name or email fragment (enough detail to tell similar accounts apart). */
export async function searchLearners(query: string, limit = 10): Promise<LearnerSummary[]> {
  const q = query.trim()
  if (q.length < 2 || q.length > 100) return []
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const rows = await prisma.$queryRaw<LearnerRow[]>`
    SELECT u.id, u.email, u."firstName", u."lastName", u.city, u.state, u."createdAt", u."lastActiveAt"
    FROM "User" u
    WHERE u.role = 'USER' AND (
      u.email ILIKE ${like} OR u."firstName" ILIKE ${like} OR u."lastName" ILIKE ${like}
      OR (COALESCE(u."firstName", '') || ' ' || COALESCE(u."lastName", '')) ILIKE ${like})
    ORDER BY (lower(u.email) = lower(${q})) DESC, u."lastActiveAt" DESC NULLS LAST, u."createdAt" DESC
    LIMIT ${Math.min(25, Math.max(1, limit))}`
  return rows.map(present)
}

/** The learner for a stable id, or null when it is unknown or not a learner account. */
export async function resolveLearner(id: string): Promise<LearnerSummary | null> {
  const row = await prisma.user.findFirst({ where: { id, role: 'USER' },
    select: { id: true, email: true, firstName: true, lastName: true, city: true, state: true, createdAt: true, lastActiveAt: true } })
  return row ? present(row) : null
}

/** Exact email (case-insensitive) to a learner; used by AI Analytics before model interpretation. */
export async function resolveLearnerByEmail(email: string): Promise<LearnerSummary | null> {
  const row = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' }, role: 'USER' },
    select: { id: true, email: true, firstName: true, lastName: true, city: true, state: true, createdAt: true, lastActiveAt: true } })
  return row ? present(row) : null
}

/** Whether the selected learner passes the other selected filters (and which demographic filters exclude them). */
export async function learnerFilterMatch(learnerId: string, filters: AnalyticsFilters) {
  if (!demographicFilterActive(filters)) return { matches: true, excludedBy: [] as string[] }
  const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM "User" u WHERE ${learnerWhere(filters)} AND u.id = ${learnerId}`
  if (rows.length) return { matches: true, excludedBy: [] as string[] }
  const excludedBy: string[] = []
  const check = async (label: string, partial: Partial<AnalyticsFilters>) => {
    const only = { ...filters, cities: [], states: [], genders: [], ageBands: [], ...partial }
    const hit = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok FROM "User" u WHERE ${learnerWhere(only)} AND u.id = ${learnerId}`
    if (!hit.length) excludedBy.push(label)
  }
  if (filters.genders.length) await check('gender', { genders: filters.genders })
  if (filters.ageBands.length) await check('age band', { ageBands: filters.ageBands })
  if (filters.cities.length) await check('city', { cities: filters.cities })
  if (filters.states.length) await check('state', { states: filters.states })
  return { matches: false, excludedBy }
}

// ---- individual Progress Pulse -------------------------------------------------------------------------------

type EntryRow = { id: string; skill: string; score: number; source: string; sessionId: string | null; recordedAt: Date; day: string }
type DecisionRow = { source: string; sessionId: string; at: Date; day: string; status: string | null; ended: boolean }

/**
 * One learner's eligible Pulse evidence (same eligibility as the dashboard, including validated Replay evidence).
 * Interviews never contribute. Days without measurements are absent, never zero; a change needs two observations
 * from different sessions.
 */
export async function loadLearnerProgress(learnerId: string, filters: AnalyticsFilters, range: DayRange) {
  const enabled = await getEnabledFeatures()
  const sources = sourcesFor(filters, enabled)
  const skill = filters.skills.length ? Prisma.sql`AND p.skill IN (${Prisma.join(filters.skills)})` : Prisma.empty
  const [entries, decisions] = await Promise.all([
    prisma.$queryRaw<EntryRow[]>`
      SELECT p.id, p.skill, p.score, p.source, p."sessionId", p."recordedAt", ${localDaySql(Prisma.sql`p."recordedAt"`, range.timeZone)} AS day
      FROM "ProgressPulse" p
      WHERE p."userId" = ${learnerId} AND p."recordedAt" >= ${range.since} AND p."recordedAt" < ${range.until}
        AND p.source IN (${Prisma.join(sources)}) AND ${eligiblePulseSql} ${skill}
      ORDER BY p."recordedAt", p.id
      LIMIT 5000`,
    prisma.$queryRaw<DecisionRow[]>`
      SELECT 'elevate' AS source, s.id AS "sessionId", s."startedAt" AS at, ${localDaySql(Prisma.sql`s."startedAt"`, range.timeZone)} AS day,
        s."progressPulseStatus" AS status, (s."endedAt" IS NOT NULL) AS ended
      FROM "Session" s
      WHERE s."userId" = ${learnerId} AND s."discardedAt" IS NULL AND s.purpose = 'COMMUNICATION'
        AND s."startedAt" >= ${range.since} AND s."startedAt" < ${range.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" pp WHERE pp."sessionId" = s.id)
        AND NOT EXISTS (SELECT 1 FROM "InterviewRun" ir WHERE ir."sessionId" = s.id)
        AND 'elevate' IN (${Prisma.join(sources)})
      UNION ALL
      SELECT 'replay', r.id, r."createdAt", ${localDaySql(Prisma.sql`r."createdAt"`, range.timeZone)}, r."progressPulseStatus", (r.status = 'completed')
      FROM "ReplaySession" r
      WHERE r."userId" = ${learnerId} AND r.purpose = 'COMMUNICATION'
        AND r."createdAt" >= ${range.since} AND r."createdAt" < ${range.until}
        AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" pr WHERE pr."replaySessionId" = r.id)
        AND 'replay' IN (${Prisma.join(sources)})
      ORDER BY at`,
  ])

  const observationKey = (e: EntryRow) => e.sessionId ?? `entry:${e.id}`
  const bySkill = new Map<string, EntryRow[]>()
  for (const e of entries) bySkill.set(e.skill, [...(bySkill.get(e.skill) ?? []), e])
  const skills = [...bySkill.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, rows]) => {
    const first = rows[0]; const latest = rows[rows.length - 1]
    const observations = new Set(rows.map(observationKey)).size
    const comparable = observations >= 2 && observationKey(first) !== observationKey(latest)
    const delta = comparable ? latest.score - first.score : null
    return {
      skill: name, samples: rows.length, observations,
      first: { score: round1(first.score), at: first.recordedAt.toISOString(), day: first.day, source: first.source },
      latest: { score: round1(latest.score), at: latest.recordedAt.toISOString(), day: latest.day, source: latest.source },
      // No change is reported from a single observation (or two entries of the same session).
      change: delta === null ? null : round1(delta),
      // Same ±0.2 band as the aggregate movement report.
      direction: delta === null ? null : delta > 0.2 ? 'improving' : delta < -0.2 ? 'declining' : 'stable',
    }
  })
  const dailyMap = new Map<string, { day: string; skill: string; total: number; samples: number }>()
  for (const e of entries) {
    const key = `${e.day}|${e.skill}`
    const row = dailyMap.get(key) ?? { day: e.day, skill: e.skill, total: 0, samples: 0 }
    row.total += e.score; row.samples += 1; dailyMap.set(key, row)
  }
  const sessionIds = new Set(entries.filter(e => e.sessionId).map(e => e.sessionId!))
  const decided = (status: string | null) => status === 'tracked' || status === 'skipped' ? status : null
  return {
    sources,
    skillsFilter: filters.skills,
    summary: {
      scoreEntries: entries.length,
      sessionsRepresented: sessionIds.size,
      entriesWithoutSession: entries.filter(e => !e.sessionId).length,
      daysWithScores: new Set(entries.map(e => e.day)).size,
      skillsMeasured: skills.length,
    },
    skills,
    daily: [...dailyMap.values()].sort((a, b) => a.day.localeCompare(b.day) || a.skill.localeCompare(b.skill))
      .map(r => ({ day: r.day, skill: r.skill, average: round1(r.total / r.samples), samples: r.samples })),
    history: entries.map(e => ({ id: e.id, day: e.day, at: e.recordedAt.toISOString(), source: e.source, skill: e.skill, score: round1(e.score), sessionId: e.sessionId })),
    decisions: {
      counts: ['elevate', 'replay'].filter(s => sources.includes(s)).map(source => {
        const rows = decisions.filter(d => d.source === source)
        return { source, sessions: rows.length, tracked: rows.filter(d => d.status === 'tracked').length,
          skipped: rows.filter(d => d.status === 'skipped').length, undecided: rows.filter(d => d.ended && !decided(d.status)).length,
          open: rows.filter(d => !d.ended && !decided(d.status)).length }
      }),
      sessions: decisions.map(d => ({ source: d.source, sessionId: d.sessionId, day: d.day, at: new Date(d.at).toISOString(),
        decision: decided(d.status) ?? (d.ended ? 'not_chosen' : 'in_progress') })),
    },
  }
}
