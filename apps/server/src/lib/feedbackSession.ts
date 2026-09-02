import { prisma } from './prisma'

export type FeedbackSessionModule = 'elevate' | 'replay'

export interface ResolvedFeedbackSession {
  sessionId: string | null
  sessionUrl: string | null
  sessionModule: FeedbackSessionModule | null
}

function frontendOrigin(): string {
  return (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
}

export function buildSessionUrl(module: FeedbackSessionModule, sessionId: string): string {
  const base = frontendOrigin()
  if (module === 'elevate') {
    return `${base}/elevate?session=${encodeURIComponent(sessionId)}`
  }
  return `${base}/replay/${encodeURIComponent(sessionId)}`
}

/** Verify ownership and return canonical session link fields for feedback storage. */
export async function resolveFeedbackSessionLink(
  userId: string,
  sessionModule?: string,
  sessionId?: string,
): Promise<ResolvedFeedbackSession> {
  const empty: ResolvedFeedbackSession = {
    sessionId: null,
    sessionUrl: null,
    sessionModule: null,
  }
  const id = sessionId?.trim()
  if (!id || (sessionModule !== 'elevate' && sessionModule !== 'replay')) {
    return empty
  }

  if (sessionModule === 'elevate') {
    const session = await prisma.session.findFirst({
      where: { id, userId },
      select: { id: true },
    })
    if (!session) return empty
    return {
      sessionId: session.id,
      sessionModule: 'elevate',
      sessionUrl: buildSessionUrl('elevate', session.id),
    }
  }

  const replay = await prisma.replaySession.findFirst({
    where: { id, userId },
    select: { id: true },
  })
  if (!replay) return empty
  return {
    sessionId: replay.id,
    sessionModule: 'replay',
    sessionUrl: buildSessionUrl('replay', replay.id),
  }
}
