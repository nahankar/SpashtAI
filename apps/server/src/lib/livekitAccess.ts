import type { Request } from 'express'
import { prisma } from './prisma'

// Room membership is bound to a persisted segment, not client metadata.
export async function resolveLivekitAccess(req: Request, input: { sessionId?: string; segmentId?: string; room?: string }) {
  if (!req.user) return { error: 'Authentication required', status: 401 } as const
  if (!input.sessionId || !input.segmentId || !input.room) {
    return { error: 'sessionId, segmentId and room are required', status: 400 } as const
  }
  const session = await prisma.session.findUnique({
    where: { id: input.sessionId },
    include: { user: { select: { firstName: true, email: true } } },
  })
  if (!session || session.userId !== req.user.userId) return { error: 'Session not found', status: 404 } as const
  if (session.discardedAt) return { error: 'Session discarded', status: 410 } as const
  if (session.endedAt) return { error: 'Session already ended', status: 409 } as const
  const segment = await prisma.sessionSegment.findUnique({ where: { id: input.segmentId } })
  if (!segment || segment.sessionId !== session.id || segment.roomName !== input.room || segment.endedAt) {
    return { error: 'Active session segment not found', status: 409 } as const
  }
  return { session, segment, identity: `user_${req.user.userId}` } as const
}
