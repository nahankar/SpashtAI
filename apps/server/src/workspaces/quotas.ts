import type { Prisma } from '@prisma/client'
import { currentDataScope } from '../lib/dataScope'
import { WorkspaceError } from './contracts'

/**
 * Reserves one live voice slot for the current organization inside the caller's
 * transaction. Serialized per workspace, so concurrent starts cannot exceed the
 * limit; the slot is released when the segment ends or goes stale. Personal
 * activity is not limited here.
 */
export async function reserveWorkspaceVoiceSlot(tx: Prisma.TransactionClient): Promise<void> {
  const scope = currentDataScope()
  if (!scope) return
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-voice:${scope.workspaceId}`}))`
  const workspace = await tx.workspace.findUnique({ where: { id: scope.workspaceId }, select: { concurrentVoice: true } })
  const [row] = await tx.$queryRaw<Array<{ open: bigint | null }>>`SELECT public.workspace_open_voice_segments(${scope.workspaceId}) AS open`
  if (!workspace || row?.open == null) throw new WorkspaceError(403, 'WORKSPACE_CONTEXT_REJECTED', 'Open the workspace again to continue')
  if (Number(row.open) >= workspace.concurrentVoice) {
    throw new WorkspaceError(429, 'VOICE_CAPACITY_REACHED', `Your organization's live practice capacity is in use. Try again in a few minutes.`)
  }
}
