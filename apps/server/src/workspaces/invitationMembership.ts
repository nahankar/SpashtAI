import type { Prisma, UserInvitation } from '@prisma/client'
import { WorkspaceError, workspacesEnabled } from './contracts'
import { assertWorkspaceDatabaseSafety } from './databaseSafety'

/** Called before locking the invitation: every mutator acquires workspace -> invitation. */
export async function lockInvitationTarget(tx: Prisma.TransactionClient, inv: UserInvitation) {
  if (!inv.workspaceId) return null
  if (!workspacesEnabled()) throw new WorkspaceError(404, 'WORKSPACES_DISABLED', 'Workspace invitations are unavailable')
  await assertWorkspaceDatabaseSafety(tx)
  await tx.$queryRaw`SELECT set_config('app.workspace_id', ${inv.workspaceId}, true), set_config('app.workspace_platform_admin', 'false', true)`
  await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${inv.workspaceId} FOR UPDATE`
  const workspace = await tx.workspace.findUnique({ where: { id: inv.workspaceId } })
  if (!workspace || workspace.state !== 'ACTIVE' || workspace.kind !== 'ORGANIZATION') throw new WorkspaceError(403, 'WORKSPACE_UNAVAILABLE', 'This workspace is unavailable')
  if (workspace.storageMode !== 'SHARED' || workspace.databaseKey !== 'primary') throw new WorkspaceError(503, 'WORKSPACE_PLACEMENT_UNAVAILABLE', 'This workspace is not available yet')
  return workspace
}
export async function acceptInvitedMembership(tx: Prisma.TransactionClient, inv: UserInvitation, userId: string, maxMembers: number, alreadyAccepted: boolean, responses: Prisma.InputJsonObject = {}) {
  const workspaceId = inv.workspaceId!
  await tx.$queryRaw`SELECT set_config('app.workspace_actor_id', ${userId}, true)`
  const current = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })
  if (alreadyAccepted) {
    if (current?.state !== 'ACTIVE') throw new WorkspaceError(403, 'MEMBERSHIP_INACTIVE', 'This membership is no longer active')
    return
  }
  const inviter = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: inv.invitedById } } })
  if (inviter?.state !== 'ACTIVE' || !['OWNER', 'ADMIN'].includes(inviter.role) || inv.proposedRole !== 'LEARNER' && inviter.role !== 'OWNER') throw new WorkspaceError(403, 'INVITER_PERMISSION_CHANGED', 'The inviter no longer has permission. Ask an Owner for a new invitation')
  if (current?.state === 'SUSPENDED') throw new WorkspaceError(403, 'MEMBER_SUSPENDED', 'Your workspace membership is suspended')
  if (current?.state === 'ACTIVE') throw new WorkspaceError(409, 'ALREADY_MEMBER', 'You already belong to this workspace. Open it from Your workspaces')
  if (current && current.role !== inv.proposedRole) throw new WorkspaceError(409, 'MEMBERSHIP_ROLE_CONFLICT', 'Your pending membership changed. Ask an Owner for a new invitation')
  if (!current && await tx.workspaceMember.count({ where: { workspaceId, state: { not: 'SUSPENDED' } } }) >= maxMembers) throw new WorkspaceError(409, 'SEAT_LIMIT', 'This workspace has no available seats')
  const features = inv.memberFeatures as Record<string, boolean>
  for (const [feature, allowed] of Object.entries(features)) {
    if (typeof allowed !== 'boolean') throw new WorkspaceError(409, 'INVALID_MEMBER_SETTINGS', 'Ask an Owner for a new invitation')
    if (allowed && !(await tx.workspaceFeature.findUnique({ where: { workspaceId_feature: { workspaceId, feature } } }))?.entitled) throw new WorkspaceError(403, 'NOT_ENTITLED', 'Workspace entitlements changed. Ask an Owner for a new invitation')
  }
  const member = await tx.workspaceMember.upsert({ where: { workspaceId_userId: { workspaceId, userId } },
    create: { workspaceId, userId, role: inv.proposedRole!, state: 'ACTIVE', acceptedAt: new Date(), enrollmentResponses: responses, enrollmentFields: inv.enrollmentFields as Prisma.InputJsonArray },
    update: { state: 'ACTIVE', acceptedAt: new Date(), enrollmentResponses: responses, enrollmentFields: inv.enrollmentFields as Prisma.InputJsonArray } })
  for (const [feature, allowed] of Object.entries(features)) await tx.workspaceMemberFeature.upsert({ where: { workspaceId_memberId_feature: { workspaceId, memberId: member.id, feature } },
    create: { workspaceId, memberId: member.id, feature, allowed }, update: { allowed } })
  await tx.workspaceAudit.create({ data: { workspaceId, actorUserId: userId, action: 'invitation_accepted', subjectId: inv.id, metadata: { role: inv.proposedRole, membershipId: member.id } } })
}
