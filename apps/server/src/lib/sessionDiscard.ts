const discardingSessionIds = new Set<string>()

export function markSessionDiscarding(sessionId: string): void {
  discardingSessionIds.add(sessionId)
}

export function clearSessionDiscarding(sessionId: string): void {
  discardingSessionIds.delete(sessionId)
}

export function isSessionDiscarding(sessionId: string): boolean {
  return discardingSessionIds.has(sessionId)
}
