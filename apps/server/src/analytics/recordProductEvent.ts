import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { isPrivilegedRole } from '../lib/userExportFlags'
import { sanitizeProductEvent, type ProductEventDraft } from './productEvents'

export type RecordProductEventInput = ProductEventDraft & {
  userId: string
  role?: string | null
  source?: 'client' | 'server'
}

export async function recordProductEvent(input: RecordProductEventInput) {
  try {
    if (input.role && isPrivilegedRole(input.role)) return { ok: true as const, stored: false }
    if (!input.role) {
      const owner = await prisma.user.findUnique({ where: { id: input.userId }, select: { role: true } })
      if (!owner || isPrivilegedRole(owner.role)) return { ok: true as const, stored: false }
    }
    const sanitized = sanitizeProductEvent(input, input.source ?? 'server')
    if (typeof sanitized === 'string') return { ok: false as const, error: sanitized }

    const data = {
      userId: input.userId,
      feature: sanitized.feature,
      action: sanitized.action,
      sessionId: sanitized.sessionId,
      duration: sanitized.duration,
      engagementMs: sanitized.engagementMs,
      outcome: sanitized.outcome,
      path: sanitized.path,
      visitId: sanitized.visitId,
      eventId: sanitized.eventId,
      metadata: sanitized.metadata ?? undefined,
      schemaVersion: sanitized.schemaVersion,
    }

    try {
      await prisma.featureUsage.create({ data })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { ok: true as const, stored: false, duplicate: true }
      }
      throw error
    }

    if (sanitized.sessionId && sanitized.action === 'results_viewed') {
      const where = { id: sanitized.sessionId, userId: input.userId }
      if (sanitized.feature === 'replay') {
        await prisma.replaySession.updateMany({ where, data: { viewCount: { increment: 1 } } })
      }
      if (sanitized.feature === 'elevate' || sanitized.feature === 'interviews') {
        await prisma.session.updateMany({ where, data: { viewCount: { increment: 1 }, lastViewedAt: new Date() } })
      }
    }
    if (sanitized.sessionId && sanitized.feature === 'replay' && sanitized.action === 'exported') {
      await prisma.replaySession.updateMany({
        where: { id: sanitized.sessionId, userId: input.userId },
        data: { exportCount: { increment: 1 } },
      })
    }
    return { ok: true as const, stored: true }
  } catch (error) {
    console.error('Product event error:', error)
    return { ok: false as const, error: 'Failed to track event' }
  }
}
