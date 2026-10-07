/** The page owns viewing and navigation; these policies never join a room. */
export function isReadOnlySession(session: { endedAt?: string | null; userId?: string | null }, viewerId?: string | null): boolean {
  return Boolean(session.endedAt || (session.userId && viewerId && session.userId !== viewerId))
}

export function liveResultLocation(sessionId: string, context: {
  launchedFromCoach: boolean
  originCoachThreadId?: string | null
  preparationId?: string | null
  stageId?: string | null
}): string {
  if (context.launchedFromCoach) {
    const params = new URLSearchParams({ elevateResult: sessionId })
    if (context.originCoachThreadId) params.set('thread', context.originCoachThreadId)
    return `/coach?${params.toString()}`
  }
  const params = new URLSearchParams({ session: sessionId })
  if (context.preparationId) {
    params.set('preparationId', context.preparationId)
    if (context.stageId) params.set('stageId', context.stageId)
  }
  return `/elevate?${params.toString()}`
}

export interface ActiveLaunchCandidate {
  id?: string
  userId?: string | null
  endedAt?: string | null
  discardedAt?: string | null
  preparationPractice?: { preparationId: string; stageId?: string | null } | null
}

/**
 * A refresh during journey practice reloads the launch URL (newSession=true).
 * When this browser's active session is the owner's unfinished practice for the
 * same journey, return the URL that resumes it instead of offering a new launch.
 */
export function resumeLaunchLocation(
  session: ActiveLaunchCandidate | null | undefined,
  context: { viewerId?: string | null; preparationId?: string | null; params: URLSearchParams },
): string | null {
  if (!session?.id || !context.viewerId || !context.preparationId) return null
  if (session.userId !== context.viewerId || session.endedAt || session.discardedAt) return null
  const practice = session.preparationPractice
  if (!practice || practice.preparationId !== context.preparationId) return null
  const params = new URLSearchParams(context.params)
  params.delete('newSession')
  params.set('session', session.id)
  params.set('preparationId', practice.preparationId)
  if (practice.stageId) params.set('stageId', practice.stageId)
  else params.delete('stageId')
  return `/elevate?${params.toString()}`
}
