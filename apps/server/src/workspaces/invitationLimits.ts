import type { Workspace } from '@prisma/client'
import type { WorkspaceTx } from './context'
import { WorkspaceError } from './contracts'

/** Caller holds the Workspace row lock; the shared allowance survives restarts and parallel senders. */
export async function reserveWorkspaceInvitationSend(tx: WorkspaceTx, workspace: Workspace, now = new Date()) {
  const continuing = workspace.invitationWindowStartedAt && now.getTime() - workspace.invitationWindowStartedAt.getTime() < 3_600_000
  const count = continuing ? workspace.invitationWindowCount : 0
  if (workspace.invitationHourlyLimit !== null && count >= workspace.invitationHourlyLimit) {
    throw new WorkspaceError(429, 'INVITATION_LIMIT', `This workspace’s hourly limit of ${workspace.invitationHourlyLimit} invitation attempts has been reached. Try again later or ask the platform Admin to increase it.`)
  }
  await tx.workspace.update({ where: { id: workspace.id }, data: {
    invitationWindowStartedAt: continuing ? workspace.invitationWindowStartedAt : now,
    invitationWindowCount: count + 1,
  } })
}
