import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { adminAnalyticsPlanSchema, type AdminAnalyticsPlan } from './adminAnalyticsQuerySchema'
import { analyticsPlanHash } from './adminAnalyticsQueryEngine'

export async function saveAdminAnalyticsQuery(
  adminId: string,
  question: string,
  plan: AdminAnalyticsPlan,
) {
  const planHash = analyticsPlanHash(plan)
  const saved = await prisma.adminAnalyticsQuery.upsert({
    where: { adminId_planHash: { adminId, planHash } },
    create: {
      adminId,
      question,
      title: plan.title,
      plan: plan as unknown as Prisma.InputJsonValue,
      planHash,
    },
    update: {
      question,
      plan: plan as unknown as Prisma.InputJsonValue,
      lastRunAt: new Date(),
    },
  })
  await trimAdminAnalyticsRecent(adminId)
  return saved
}

export async function trimAdminAnalyticsRecent(adminId: string) {
  const keep = await prisma.adminAnalyticsQuery.findMany({
    where: { adminId, pinned: false },
    orderBy: { lastRunAt: 'desc' },
    take: 15,
    select: { id: true },
  })
  await prisma.adminAnalyticsQuery.deleteMany({
    where: { adminId, pinned: false, id: { notIn: keep.map((row) => row.id) } },
  })
}

export async function listAdminAnalyticsQueries(adminId: string) {
  const [pinned, recent] = await Promise.all([
    prisma.adminAnalyticsQuery.findMany({
      where: { adminId, pinned: true },
      orderBy: { lastRunAt: 'desc' },
    }),
    prisma.adminAnalyticsQuery.findMany({
      where: { adminId, pinned: false },
      orderBy: { lastRunAt: 'desc' },
      take: 15,
    }),
  ])
  return {
    pinned: pinned.flatMap((row) => {
      const saved = presentSavedQuery(row)
      return saved ? [saved] : []
    }),
    recent: recent.flatMap((row) => {
      const saved = presentSavedQuery(row)
      return saved ? [saved] : []
    }),
  }
}

function refreshInterval(value: number) {
  if (value === 30 || value === 300) return value
  return 60
}

export function presentSavedQuery(row: {
  id: string
  question: string
  title: string
  plan: unknown
  planHash: string
  pinned: boolean
  refreshIntervalSec: number
  lastRunAt: Date
  createdAt: Date
}) {
  const plan = adminAnalyticsPlanSchema.safeParse(row.plan)
  if (!plan.success) {
    logger.warn({ event: 'admin_analytics.saved_plan_skipped', queryId: row.id })
    return null
  }
  return {
    id: row.id,
    question: row.question,
    title: row.title,
    plan: plan.data,
    planHash: row.planHash,
    pinned: row.pinned,
    refreshIntervalSec: refreshInterval(row.refreshIntervalSec),
    lastRunAt: row.lastRunAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  }
}

export async function getAdminAnalyticsQuery(adminId: string, id: string) {
  const row = await prisma.adminAnalyticsQuery.findFirst({ where: { id, adminId } })
  if (!row) return null
  const plan = adminAnalyticsPlanSchema.safeParse(row.plan)
  if (!plan.success) {
    logger.warn({ event: 'admin_analytics.saved_plan_skipped', queryId: row.id })
    return null
  }
  return { row, plan: plan.data }
}
