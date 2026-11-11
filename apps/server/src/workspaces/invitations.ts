import { reserveWorkspaceInvitationSend } from './invitationLimits'
import { z } from 'zod'
import { batchEmailsSchemaFor, runInvitationBatch } from '../lib/invitationBatch'
import { emailContentSchema, readEnrollmentSettings } from './enrollment'
import type { Prisma } from '@prisma/client'
import type { WorkspaceTokenPayload } from '../lib/jwt'
import { deliverAttempt, effectiveStatus, expiryFrom, INVITATION_VIEWS, newToken, serializeInvitation, viewWhere } from '../lib/invitations'
import { featureSchema, idSchema, WorkspaceError } from './contracts'
import { requireWorkspaceManager, withLockedWorkspaceAccess, type WorkspaceTx, type establishWorkspace } from './context'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>
export const workspaceInvitationInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254), name: z.string().trim().max(120).optional(),
  role: z.enum(['OWNER', 'ADMIN', 'LEARNER']).default('LEARNER'),
  memberFeatures: z.record(featureSchema, z.boolean()).default({}),
  emailContent: emailContentSchema.optional(),
}).strict()
export const workspaceInvitationQuery = z.object({
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
}).strict()
export const pendingInvitationKey = (workspaceId: string, email: string) => `workspace:${workspaceId}:${email}`
export function presentWorkspaceInvitation(inv: Parameters<typeof serializeInvitation>[0]) {
  return { ...serializeInvitation(inv), role: inv.proposedRole, memberFeatures: inv.memberFeatures }
}
export async function reservedWorkspaceSeats(tx: WorkspaceTx, workspaceId: string) {
  const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT public.workspace_reserved_seats(${workspaceId}) AS count`
  return Number(rows[0]?.count ?? 0)
}
function mayManage(scope: Scope, role: string) {
  requireWorkspaceManager(scope)
  if (scope.member.role !== 'OWNER' && role !== 'LEARNER') throw new WorkspaceError(403, 'OWNER_REQUIRED', 'Only an Owner may invite or manage administrators')
}
async function audit(tx: WorkspaceTx, scope: Scope, action: string, id: string, metadata: Prisma.InputJsonObject = {}) {
  await tx.workspaceAudit.create({ data: { workspaceId: scope.workspace.id, actorUserId: scope.member.userId, action, subjectId: id, metadata } })
}
export async function listWorkspaceInvitations(tx: WorkspaceTx, scope: Scope, input: unknown) {
  requireWorkspaceManager(scope)
  const query = workspaceInvitationQuery.parse(input), now = new Date(), base = { workspaceId: scope.workspace.id }
  const where = { ...base, ...(query.status ? viewWhere(query.status, now) : {}) }
  const [items, total, ...counts] = await Promise.all([
    tx.userInvitation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * 20, take: 20 }),
    tx.userInvitation.count({ where }), ...INVITATION_VIEWS.map(status => tx.userInvitation.count({ where: { ...base, ...viewWhere(status, now) } })),
  ])
  return { items: items.map(presentWorkspaceInvitation), total, page: query.page, totalPages: Math.max(1, Math.ceil(total / 20)), counts: Object.fromEntries(INVITATION_VIEWS.map((s, i) => [s, counts[i]])) }
}
/** Prepare under the workspace lock; send after commit, using the shared mailer and attempt fencing. */
export async function createWorkspaceInvitation(claims: WorkspaceTokenPayload, input: unknown) {
  const body = workspaceInvitationInput.parse(input), { token, tokenHash } = newToken(), now = new Date()
  const attempt = await withLockedWorkspaceAccess(claims, async (tx, scope) => {
    mayManage(scope, body.role)
    const existing = await tx.user.findUnique({ where: { email: body.email }, select: { id: true } })
    const member = existing && await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: scope.workspace.id, userId: existing.id } } })
    if (member?.state === 'SUSPENDED') throw new WorkspaceError(409, 'MEMBER_SUSPENDED', 'Reactivate the suspended membership instead of inviting again')
    if (member?.state === 'ACTIVE') throw new WorkspaceError(409, 'ALREADY_MEMBER', 'This person is already an active member')
    if (member && member.role !== body.role) throw new WorkspaceError(409, 'MEMBERSHIP_ROLE_CONFLICT', 'The existing pending membership has a different role')
    const key = pendingInvitationKey(scope.workspace.id, body.email)
    await tx.userInvitation.updateMany({ where: { workspaceId: scope.workspace.id, email: body.email, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', pendingKey: null } })
    if (await tx.userInvitation.findUnique({ where: { pendingKey: key } })) throw new WorkspaceError(409, 'DUPLICATE_PENDING', 'A pending invitation exists. Resend it instead')
    if (!member && await reservedWorkspaceSeats(tx, scope.workspace.id) >= scope.workspace.maxMembers) throw new WorkspaceError(409, 'SEAT_LIMIT', 'This workspace has no available seats')
    for (const [feature, allowed] of Object.entries(body.memberFeatures)) {
      if (allowed && !(await tx.workspaceFeature.findUnique({ where: { workspaceId_feature: { workspaceId: scope.workspace.id, feature } } }))?.entitled) throw new WorkspaceError(403, 'NOT_ENTITLED', 'Member settings cannot exceed workspace entitlements')
    }
    const settings = readEnrollmentSettings(scope.workspace.enrollmentSettings)
    const email = body.emailContent ?? settings.email
    await reserveWorkspaceInvitationSend(tx, scope.workspace)
    const invitation = await tx.userInvitation.create({ data: { workspaceId: scope.workspace.id, email: body.email, recipientName: body.name || null,
      enrollmentFields: settings.fields, emailSubject: email.subject || null, emailMessage: email.message || null,
      proposedRole: body.role, memberFeatures: body.memberFeatures, pendingKey: key, tokenHash, expiresAt: expiryFrom(now), invitedById: scope.member.userId,
      existingUserAtInvite: Boolean(existing), sendCount: 1, lastSentAt: now } })
    await audit(tx, scope, 'invitation_create', invitation.id, { role: body.role, attempt: 1 })
    return { invitation, token, workspaceName: scope.workspace.name, workspaceSlug: scope.workspace.slug }
  })
  return presentWorkspaceInvitation(await deliverAttempt(claims.userId, attempt, work => withLockedWorkspaceAccess(claims, tx => work(tx))))
}
export async function changeWorkspaceInvitation(claims: WorkspaceTokenPayload, id: string, action: 'resend' | 'revoke') {
  idSchema.parse(id)
  const { token, tokenHash } = newToken(), now = new Date()
  const attempt = await withLockedWorkspaceAccess(claims, async (tx, scope) => {
    requireWorkspaceManager(scope)
    await tx.$queryRaw`SELECT id FROM "UserInvitation" WHERE id=${id} AND "workspaceId"=${scope.workspace.id} FOR UPDATE`
    const current = await tx.userInvitation.findFirst({ where: { id, workspaceId: scope.workspace.id } })
    if (!current) throw new WorkspaceError(404, 'INVITATION_NOT_FOUND', 'Invitation not found')
    mayManage(scope, current.proposedRole!)
    if (current.status === 'ACCEPTED' || action === 'resend' && current.status === 'REVOKED') throw new WorkspaceError(409, 'INVITATION_CLOSED', 'This invitation cannot be changed')
    if (action === 'revoke' && current.status === 'REVOKED') return { invitation: current, token, workspaceName: scope.workspace.name, workspaceSlug: scope.workspace.slug }
    if (action === 'resend' && effectiveStatus(current) !== 'pending' && await reservedWorkspaceSeats(tx, scope.workspace.id) >= scope.workspace.maxMembers) throw new WorkspaceError(409, 'SEAT_LIMIT', 'This workspace has no available seats')
    if (action === 'resend') await reserveWorkspaceInvitationSend(tx, scope.workspace)
    const invitation = await tx.userInvitation.update({ where: { id }, data: action === 'revoke'
      ? { status: 'REVOKED', pendingKey: null, revokedAt: now, revokedById: scope.member.userId }
      : { status: 'PENDING', pendingKey: pendingInvitationKey(scope.workspace.id, current.email), tokenHash, expiresAt: expiryFrom(now), deliveryStatus: 'SENDING', deliveryError: null, sendCount: { increment: 1 }, lastSentAt: now } })
    await audit(tx, scope, `invitation_${action}`, id, { attempt: invitation.sendCount })
    return { invitation, token, workspaceName: scope.workspace.name, workspaceSlug: scope.workspace.slug }
  })
  return presentWorkspaceInvitation(action === 'revoke' ? attempt.invitation : await deliverAttempt(claims.userId, attempt, work => withLockedWorkspaceAccess(claims, tx => work(tx))))
}

export const workspaceInvitationBatchInput = workspaceInvitationInput.omit({ email: true, name: true }).extend({ emails: batchEmailsSchemaFor(500) })
export async function createWorkspaceInvitationBatch(claims: WorkspaceTokenPayload, input: unknown) {
  const { emails, ...settings } = workspaceInvitationBatchInput.parse(input)
  // Authorize before starting a batch, then recheck membership/seat limits per recipient.
  await withLockedWorkspaceAccess(claims, async (_tx, scope) => {
    mayManage(scope, settings.role)
    if (emails.length > scope.workspace.invitationBatchSize) throw new WorkspaceError(400, 'INVITATION_BATCH_LIMIT', `This workspace allows up to ${scope.workspace.invitationBatchSize} recipients per batch`)
  })
  return runInvitationBatch(emails, email => createWorkspaceInvitation(claims, { ...settings, email }))
}
