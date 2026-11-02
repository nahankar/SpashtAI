import type { Request } from 'express'
import type { Prisma } from '@prisma/client'

/**
 * Admin-initiated invitation audit (create, resend, revoke, delivery outcome), written in the same transaction as
 * the state change it records. Content-free: invitation id and non-identifying metadata only.
 */
export async function writeInvitationAudit(
  tx: Prisma.TransactionClient,
  adminId: string,
  action: 'invitation_create' | 'invitation_resend' | 'invitation_revoke' | 'invitation_delivery',
  invitationId: string,
  metadata: Record<string, string | number | boolean>,
) {
  await tx.adminAction.create({ data: { adminId, action, targetResource: `invitation:${invitationId}`, metadata } })
}

/**
 * Acceptance audit, written in the same transaction that marks the invitation accepted: if either row fails,
 * the acceptance (and any account created for it) rolls back, so an acceptance can never exist unaudited.
 * Content-free: invitation id and flags only, never an email, name or token.
 */
export async function writeAcceptanceAudit(
  tx: Prisma.TransactionClient,
  a: { invitationId: string; invitedById: string; userId: string; newAccount: boolean; signupsPausedBypass: boolean; req: Request },
) {
  const flags = { newAccount: a.newAccount, signupsPausedBypass: a.signupsPausedBypass }
  await tx.userActivity.create({
    data: {
      userId: a.userId,
      action: 'invitation_accepted',
      resource: 'invitation',
      resourceId: a.invitationId,
      ipAddress: a.req.ip || null,
      userAgent: a.req.headers['user-agent'] || null,
      metadata: flags,
    },
  })
  // Attributed to the inviting Admin; the recipient is the target account.
  await tx.adminAction.create({
    data: {
      adminId: a.invitedById,
      action: 'invitation_accepted',
      targetUserId: a.userId,
      targetResource: `invitation:${a.invitationId}`,
      metadata: { actor: 'recipient', ...flags },
    },
  })
}
