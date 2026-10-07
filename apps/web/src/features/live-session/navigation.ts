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
