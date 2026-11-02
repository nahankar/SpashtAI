import { z } from 'zod'
import { WorkspaceError } from './contracts'
import type { WorkspaceTx, establishWorkspace } from './context'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>
export const archiveQuerySchema = z.object({ after: z.string().min(1).max(160).optional() }).strict()

export function requireSessionArchive(scope: Scope) {
  if (scope.workspace.kind !== 'ORGANIZATION' || process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED !== 'true') {
    throw new WorkspaceError(403, 'WORKSPACE_ARCHIVE_UNAVAILABLE', 'Workspace session review is not available yet')
  }
}
export function sessionMetadata(row: { id: string; sessionName: string | null; module: string; purpose: string; startedAt: Date; endedAt: Date | null; durationSec: number | null }) {
  return { id: row.id, name: row.sessionName, module: row.module, purpose: row.purpose, startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSec }
}
export async function ownedArchiveSession(tx: WorkspaceTx, scope: Scope, sessionId: string) {
  requireSessionArchive(scope)
  const session = await tx.session.findFirst({ where: { id: sessionId, workspaceId: scope.workspace.id, userId: scope.member.userId } })
  if (!session) throw new WorkspaceError(404, 'SESSION_NOT_FOUND', 'Session not found')
  if (session.discardedAt) throw new WorkspaceError(410, 'SESSION_DISCARDED', 'Session discarded')
  return session
}
export async function listArchiveSessions(tx: WorkspaceTx, scope: Scope, input: unknown) {
  requireSessionArchive(scope)
  const { after } = archiveQuerySchema.parse(input)
  const rows = await tx.session.findMany({ where: { workspaceId: scope.workspace.id, userId: scope.member.userId, discardedAt: null,
    ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take: 51 })
  const items = rows.slice(0, 50).map(sessionMetadata)
  return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null }
}
export async function archiveSessionDetail(tx: WorkspaceTx, scope: Scope, sessionId: string) {
  const session = await ownedArchiveSession(tx, scope, sessionId)
  const recordings = await tx.sessionRecording.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: 'asc' },
    select: { id: true, duration: true, recordingType: true, status: true } })
  return { session: sessionMetadata(session), recordings }
}
export async function archiveSessionTranscript(tx: WorkspaceTx, scope: Scope, sessionId: string) {
  await ownedArchiveSession(tx, scope, sessionId)
  const owner = await tx.user.findUniqueOrThrow({ where: { id: scope.member.userId }, select: { hideTranscriptText: true } })
  if (owner.hideTranscriptText) throw new WorkspaceError(403, 'TRANSCRIPT_DISABLED', 'Transcript viewing is disabled for your account')
  const transcript = await tx.sessionTranscript.findUnique({ where: { sessionId }, select: { conversationData: true, updatedAt: true } })
  // Older JSON may include internal audioFiles/provider paths. This route returns only
  // the supported conversation fields; it never spreads arbitrary stored objects.
  const stored = transcript?.conversationData
  const messages = stored && typeof stored === 'object' && !Array.isArray(stored) && Array.isArray(stored.messages) ? stored.messages : []
  return { messages: messages.flatMap(message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return []
    return [{ id: typeof message.id === 'string' ? message.id : null, role: typeof message.role === 'string' ? message.role : null,
      content: typeof message.content === 'string' ? message.content : '', timestamp: typeof message.timestamp === 'string' ? message.timestamp : null }]
  }), updatedAt: transcript?.updatedAt ?? null }
}
