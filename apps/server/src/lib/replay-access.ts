/** Prisma selector used by every mutable/status Replay endpoint. */
export function replaySessionAccessWhere(
  id: string,
  userId: string,
  privileged: boolean,
): { id: string; userId?: string } {
  return privileged ? { id } : { id, userId }
}
