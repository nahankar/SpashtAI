import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { PULSE_SKILLS } from '../analytics/adminAnalyticsFilters'
import { establishWorkspace, requireWorkspaceManager, type WorkspaceTx } from './context'
import { idSchema, WorkspaceError } from './contracts'
import { addDays, daysBetween, workspaceDay } from './time'
import { fieldQuerySchema, resolveFieldSelections, fieldMemberQuery, fieldMemberWhere, type FieldSelection } from './fieldFilters'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>

export const WORKSPACE_PRODUCTS = ['elevate', 'replay', 'interviews'] as const
export type WorkspaceProduct = typeof WORKSPACE_PRODUCTS[number]
/** Usage events an organization may see; page paths and event metadata are never returned. */
export const WORKSPACE_USAGE_FEATURES = ['elevate', 'replay', 'interviews', 'progress_pulse', 'feedback', 'app'] as const
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const workspaceFiltersSchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
  from: day.optional(),
  to: day.optional(),
  learner: idSchema.optional(),
  product: z.enum(WORKSPACE_PRODUCTS).optional(),
  skill: z.enum(PULSE_SKILLS).optional(),
  field: fieldQuerySchema,
}).strict()
export type WorkspaceFilters = z.infer<typeof workspaceFiltersSchema>

export interface ResolvedFilters {
  from: string
  to: string
  timeZone: string
  learner: { memberId: string; userId: string } | null
  product: WorkspaceProduct | null
  skill: string | null
  workspaceId: string
  fields: FieldSelection[]
}

/**
 * Owner/Admin reports read under the database manager reader: only aggregate-visible
 * organization rows, never child tables with transcripts, recordings, uploads or answers.
 */
export async function asWorkspaceManager(tx: WorkspaceTx, scope: Scope) {
  requireWorkspaceManager(scope)
  await tx.$executeRaw`SELECT set_config('app.workspace_reader', 'manager', true)`
}

export async function resolveFilters(tx: WorkspaceTx, scope: Scope, input: unknown): Promise<ResolvedFilters> {
  const filters = workspaceFiltersSchema.parse(input ?? {})
  const timeZone = scope.workspace.timeZone
  const to = filters.to ?? workspaceDay(timeZone)
  const from = filters.from ?? addDays(to, -(filters.days - 1))
  if (from > to) throw new WorkspaceError(400, 'INVALID_RANGE', 'The start date must be on or before the end date')
  if (daysBetween(from, to).length > 90) throw new WorkspaceError(400, 'INVALID_RANGE', 'Choose a period of at most 90 days')
  let learner: ResolvedFilters['learner'] = null
  if (filters.learner) {
    const member = await tx.workspaceMember.findFirst({ where: { id: filters.learner, workspaceId: scope.workspace.id }, select: { id: true, userId: true } })
    if (!member) throw new WorkspaceError(404, 'LEARNER_NOT_FOUND', 'Learner not found in this workspace')
    learner = { memberId: member.id, userId: member.userId }
  }
  return { from, to, timeZone, learner, product: filters.product ?? null, skill: filters.skill ?? null,
    workspaceId: scope.workspace.id, fields: resolveFieldSelections(scope, filters.field) }
}

/** Timestamps are stored as UTC without zone; this is their calendar day in the organization. */
const localDay = (column: string) => Prisma.raw(`(("${column}" AT TIME ZONE 'UTC') AT TIME ZONE`)
function inRange(column: string, f: ResolvedFilters) {
  return Prisma.sql`${localDay(column)} ${f.timeZone})::date BETWEEN ${f.from}::date AND ${f.to}::date`
}
function dayOf(column: string, f: ResolvedFilters) {
  return Prisma.sql`to_char(${localDay(column)} ${f.timeZone}), 'YYYY-MM-DD')`
}
const learnerClause = (f: ResolvedFilters) => Prisma.sql`
  ${f.learner ? Prisma.sql`AND "userId" = ${f.learner.userId}` : Prisma.empty}
  ${f.fields.length ? Prisma.sql`AND "userId" IN (${fieldMemberQuery(f.workspaceId, f.fields)})` : Prisma.empty}`

/** One row per practice activity (Elevate, Interviews, Replay), with only who, when and which product. */
function activities(workspaceId: string, f: ResolvedFilters) {
  const parts: Prisma.Sql[] = []
  if (!f.product || f.product === 'elevate' || f.product === 'interviews') {
    const purposes = f.product === 'elevate' ? ['COMMUNICATION'] : f.product === 'interviews' ? ['INTERVIEW'] : ['COMMUNICATION', 'INTERVIEW']
    parts.push(Prisma.sql`SELECT "userId", ${dayOf('startedAt', f)} AS day,
      CASE WHEN purpose = 'INTERVIEW' THEN 'interviews' ELSE 'elevate' END AS product, "durationSec" AS seconds
      FROM "Session" WHERE "workspaceId" = ${workspaceId} AND "discardedAt" IS NULL
      AND purpose::text IN (${Prisma.join(purposes)}) AND ${inRange('startedAt', f)} ${learnerClause(f)}`)
  }
  if (!f.product || f.product === 'replay') {
    parts.push(Prisma.sql`SELECT "userId", ${dayOf('createdAt', f)} AS day, 'replay' AS product, NULL::int AS seconds
      FROM "ReplaySession" WHERE "workspaceId" = ${workspaceId} AND purpose = 'COMMUNICATION'
      AND ${inRange('createdAt', f)} ${learnerClause(f)}`)
  }
  return Prisma.join(parts, ' UNION ALL ')
}

type Identity = { memberId: string | null; name: string; email: string | null; role: string | null }
async function identities(tx: WorkspaceTx, workspaceId: string, userIds: string[]) {
  const rows = userIds.length ? await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: userIds } },
    select: { id: true, userId: true, role: true, user: { select: { firstName: true, lastName: true, email: true } } } }) : []
  const map = new Map<string, Identity>(rows.map(row => [row.userId, {
    memberId: row.id, role: row.role, email: row.user.email,
    name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || row.user.email,
  }]))
  return (userId: string): Identity => map.get(userId) ?? { memberId: null, name: 'Former member', email: null, role: null }
}

function presentRange(f: ResolvedFilters) {
  return { from: f.from, to: f.to, timeZone: f.timeZone, learner: f.learner?.memberId ?? null, product: f.product, skill: f.skill, fields: f.fields }
}

export async function workspaceOverview(tx: WorkspaceTx, scope: Scope, input: unknown) {
  await asWorkspaceManager(tx, scope)
  const f = await resolveFilters(tx, scope, input)
  const workspaceId = scope.workspace.id
  const memberWhere = await fieldMemberWhere(tx, scope, f.fields)
  const [states, products, learners, budget, voice] = await Promise.all([
    tx.workspaceMember.groupBy({ by: ['state'], where: { workspaceId, ...memberWhere, ...(f.learner ? { userId: f.learner.userId } : {}) }, _count: { _all: true } }),
    tx.$queryRaw<Array<{ product: string; count: bigint }>>`SELECT product, count(*) AS count FROM (${activities(workspaceId, f)}) a GROUP BY product`,
    tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(DISTINCT "userId") AS count FROM (${activities(workspaceId, f)}) a`,
    tx.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: `workspace-${workspaceId}`, day: workspaceDay(f.timeZone) } } }),
    tx.$queryRaw<Array<{ open: bigint | null }>>`SELECT public.workspace_open_voice_segments(${workspaceId}) AS open`,
  ])
  const count = (state: string) => states.find(row => row.state === state)?._count._all ?? 0
  return {
    range: presentRange(f),
    members: { active: count('ACTIVE'), invited: count('INVITED'), suspended: count('SUSPENDED'), seats: scope.workspace.maxMembers },
    activeLearners: Number(learners[0]?.count ?? 0),
    activity: Object.fromEntries(WORKSPACE_PRODUCTS.map(p => [p, Number(products.find(row => row.product === p)?.count ?? 0)])),
    evaluations: { day: workspaceDay(f.timeZone), used: budget?.used ?? 0, limit: scope.workspace.dailyEvaluations },
    voice: { inUse: Number(voice[0]?.open ?? 0), limit: scope.workspace.concurrentVoice },
  }
}

export async function workspaceDailyActivity(tx: WorkspaceTx, scope: Scope, input: unknown) {
  await asWorkspaceManager(tx, scope)
  const f = await resolveFilters(tx, scope, input)
  const rows = await tx.$queryRaw<Array<{ day: string; product: string; count: bigint; learners: bigint; seconds: bigint | null }>>`
    SELECT day, product, count(*) AS count, count(DISTINCT "userId") AS learners, sum(seconds) AS seconds
    FROM (${activities(scope.workspace.id, f)}) a GROUP BY day, product`
  const active = await tx.$queryRaw<Array<{ day: string; learners: bigint }>>`
    SELECT day, count(DISTINCT "userId") AS learners FROM (${activities(scope.workspace.id, f)}) a GROUP BY day`
  // Every day in the period is present, so an empty day reads as zero rather than missing.
  const days = daysBetween(f.from, f.to).map(d => ({
    day: d,
    activeLearners: Number(active.find(row => row.day === d)?.learners ?? 0),
    ...Object.fromEntries(WORKSPACE_PRODUCTS.map(p => [p, Number(rows.find(row => row.day === d && row.product === p)?.count ?? 0)])),
    practiceMinutes: Math.round(rows.filter(row => row.day === d).reduce((sum, row) => sum + Number(row.seconds ?? 0), 0) / 60),
  }))
  return { range: presentRange(f), days }
}

export async function workspaceLearnerActivity(tx: WorkspaceTx, scope: Scope, input: unknown) {
  await asWorkspaceManager(tx, scope)
  const f = await resolveFilters(tx, scope, input)
  const rows = await tx.$queryRaw<Array<{ userId: string; product: string; count: bigint; lastDay: string }>>`
    SELECT "userId", product, count(*) AS count, max(day) AS "lastDay" FROM (${activities(scope.workspace.id, f)}) a GROUP BY "userId", product`
  const who = await identities(tx, scope.workspace.id, [...new Set(rows.map(row => row.userId))])
  const learners = [...new Set(rows.map(row => row.userId))].map(userId => {
    const own = rows.filter(row => row.userId === userId)
    return { ...who(userId), lastActiveDay: own.map(row => row.lastDay).sort().at(-1) ?? null,
      ...Object.fromEntries(WORKSPACE_PRODUCTS.map(p => [p, Number(own.find(row => row.product === p)?.count ?? 0)])) }
  }).sort((a, b) => (b.lastActiveDay ?? '').localeCompare(a.lastActiveDay ?? ''))
  return { range: presentRange(f), learners }
}

export async function workspaceFeatureUsage(tx: WorkspaceTx, scope: Scope, input: unknown, exporting = false) {
  await asWorkspaceManager(tx, scope)
  const f = await resolveFilters(tx, scope, input)
  const features = f.product ? [f.product] : [...WORKSPACE_USAGE_FEATURES]
  const base = Prisma.sql`FROM "FeatureUsage" WHERE "workspaceId" = ${scope.workspace.id}
    AND feature IN (${Prisma.join(features)}) AND ${inRange('timestamp', f)} ${learnerClause(f)}`
  const [byAction, daily, byLearner] = await Promise.all([
    tx.$queryRaw<Array<{ feature: string; action: string; count: bigint; learners: bigint }>>`
      SELECT feature, action, count(*) AS count, count(DISTINCT "userId") AS learners ${base} GROUP BY feature, action ORDER BY count(*) DESC, feature, action LIMIT ${exporting ? 10001 : 200}`,
    tx.$queryRaw<Array<{ day: string; feature: string; count: bigint }>>`
      SELECT ${dayOf('timestamp', f)} AS day, feature, count(*) AS count ${base} GROUP BY 1, feature`,
    tx.$queryRaw<Array<{ userId: string; count: bigint; lastDay: string }>>`
      SELECT "userId", count(*) AS count, max(${dayOf('timestamp', f)}) AS "lastDay" ${base} GROUP BY "userId" ORDER BY count(*) DESC, "userId" LIMIT ${exporting ? 10001 : 500}`,
  ])
  const who = await identities(tx, scope.workspace.id, byLearner.map(row => row.userId))
  return {
    range: presentRange(f),
    features: byAction.map(row => ({ feature: row.feature, action: row.action, events: Number(row.count), learners: Number(row.learners) })),
    days: daysBetween(f.from, f.to).map((d): Record<string, string | number> => ({ day: d,
      ...Object.fromEntries(features.map(feature => [feature, Number(daily.find(row => row.day === d && row.feature === feature)?.count ?? 0)])) })),
    learners: byLearner.map(row => ({ ...who(row.userId), events: Number(row.count), lastActiveDay: row.lastDay })),
  }
}

export async function workspaceProgressPulse(tx: WorkspaceTx, scope: Scope, input: unknown, exporting = false) {
  await asWorkspaceManager(tx, scope)
  const f = await resolveFilters(tx, scope, input)
  if (f.product === 'interviews') throw new WorkspaceError(400, 'PULSE_SOURCE_UNSUPPORTED', 'Progress Pulse covers Elevate and Replay communication practice')
  // Communication Pulse only: technical interview grading is reported separately and never mixed in.
  const sources = f.product ? [f.product] : ['elevate', 'replay']
  const base = Prisma.sql`FROM "ProgressPulse" WHERE "workspaceId" = ${scope.workspace.id} AND source IN (${Prisma.join(sources)})
    ${f.skill ? Prisma.sql`AND skill = ${f.skill}` : Prisma.empty} AND ${inRange('recordedAt', f)} ${learnerClause(f)}`
  const [skills, daily, byLearner] = await Promise.all([
    tx.$queryRaw<Array<{ skill: string; average: number; samples: bigint; learners: bigint }>>`
      SELECT skill, avg(score)::float8 AS average, count(*) AS samples, count(DISTINCT "userId") AS learners ${base} GROUP BY skill ORDER BY skill`,
    tx.$queryRaw<Array<{ day: string; average: number; samples: bigint }>>`
      SELECT ${dayOf('recordedAt', f)} AS day, avg(score)::float8 AS average, count(*) AS samples ${base} GROUP BY 1`,
    tx.$queryRaw<Array<{ userId: string; average: number; samples: bigint; lastDay: string }>>`
      SELECT "userId", avg(score)::float8 AS average, count(*) AS samples, max(${dayOf('recordedAt', f)}) AS "lastDay" ${base} GROUP BY "userId" ORDER BY avg(score) DESC, "userId" LIMIT ${exporting ? 10001 : 500}`,
  ])
  const who = await identities(tx, scope.workspace.id, byLearner.map(row => row.userId))
  const round = (value: number) => Math.round(value * 10) / 10
  return {
    range: presentRange(f),
    skills: skills.map(row => ({ skill: row.skill, average: round(row.average), samples: Number(row.samples), learners: Number(row.learners) })),
    days: daysBetween(f.from, f.to).map(d => {
      const row = daily.find(r => r.day === d)
      return { day: d, average: row ? round(row.average) : null, samples: Number(row?.samples ?? 0) }
    }),
    learners: byLearner.map(row => ({ ...who(row.userId), average: round(row.average), samples: Number(row.samples), lastActiveDay: row.lastDay })),
  }
}

const feedbackQuerySchema = z.object({
  after: idSchema.optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'CONSIDERED', 'IMPLEMENTED', 'PARKED']).optional(),
  type: z.enum(['FEEDBACK', 'ISSUE', 'FEATURE_REQUEST']).optional(),
  learner: idSchema.optional(),
}).strict()

/** Learner feedback submitted inside this organization; attachments and session links stay with platform staff. */
export async function workspaceFeedback(tx: WorkspaceTx, scope: Scope, input: unknown) {
  await asWorkspaceManager(tx, scope)
  const query = feedbackQuerySchema.parse(input ?? {})
  let userId: string | undefined
  if (query.learner) {
    const member = await tx.workspaceMember.findFirst({ where: { id: query.learner, workspaceId: scope.workspace.id }, select: { userId: true } })
    if (!member) throw new WorkspaceError(404, 'LEARNER_NOT_FOUND', 'Learner not found in this workspace')
    userId = member.userId
  }
  const where = { workspaceId: scope.workspace.id, ...(query.status ? { status: query.status } : {}), ...(query.type ? { type: query.type } : {}), ...(userId ? { userId } : {}) }
  const [rows, byStatus] = await Promise.all([
    tx.userFeedback.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
      ...(query.after ? { cursor: { id: query.after }, skip: 1 } : {}),
      select: { id: true, feedbackNumber: true, userId: true, type: true, subject: true, body: true, status: true, sessionModule: true, createdAt: true } }),
    tx.userFeedback.groupBy({ by: ['status'], where: { workspaceId: scope.workspace.id }, _count: { _all: true } }),
  ])
  const who = await identities(tx, scope.workspace.id, [...new Set(rows.map(row => row.userId))])
  const items = rows.slice(0, 50).map(({ userId: owner, ...row }) => ({ ...row, learner: who(owner) }))
  return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null,
    counts: Object.fromEntries(byStatus.map(row => [row.status, row._count._all])) }
}
