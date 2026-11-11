import { getPlatformSettings } from './platformSettings'
import { requireLearnerDomain, requireMethod, methodsFor } from './signInPolicy'
import { lockInvitationTarget, acceptInvitedMembership } from '../workspaces/invitationMembership'
import { validateEnrollmentResponses } from '../workspaces/enrollment'
import { WorkspaceError } from '../workspaces/contracts'
import type { Request } from 'express'
import type { User } from '@prisma/client'
import type { VerifiedSignInIdentity } from './googleSignIn'
import { prisma } from './prisma'
import { loadSignupPolicy, resolveGoogleAccount, withAccountRaceRetry } from './googleSignIn'
import { attachSignupLocation, type SignupProfile } from './profile'
import { effectiveStatus } from './invitations'
import { writeAcceptanceAudit } from './invitationAudit'

export type AcceptanceFailure = { ok: false; status: number; body: { error: string; message?: string; invitedEmail?: string } }
export type AcceptanceResult =
  | { ok: true; user: User; newAccount: boolean; alreadyAccepted: boolean; signupsPausedBypass: boolean; workspacePath?: string }
  | AcceptanceFailure

export const INVALID_LINK = {
  error: 'invalid_link',
  message: 'This invitation link is not valid. If you received a newer invitation email, use the link in that email.',
}

/** Thrown inside the transaction to roll back writes already made, then returned as the response. */
class Abort extends Error {
  constructor(public result: AcceptanceFailure) { super(result.body.error) }
}
const fail = (status: number, body: AcceptanceFailure['body']): AcceptanceFailure => ({ ok: false, status, body })

/**
 * Accepts an invitation using its single-use emailed token or an independently verified identity in one transaction: the invitation row is locked
 * (so revoke and resend wait for, or are seen by, this acceptance), re-validated, the account is resolved or
 * created, and the acceptance and its audit rows are written together. Any failure rolls everything back, so no
 * committed account is ever deleted afterwards. A concurrent signup of the same address that wins the unique
 * constraint makes the whole transaction retry, and the retry finds that account instead of duplicating it.
 */
export async function acceptInvitation(
  invitation: { id: string; tokenHash: string },
  googleUser: VerifiedSignInIdentity | null,
  req: Request,
  profile?: SignupProfile | null,
): Promise<AcceptanceResult> {
  // Read once, outside the transaction, so the transaction never needs a second pool connection. Whether an
  // invitation may create an account while paused depends on the invitation being pending, checked under the lock.
  const policy = await loadSignupPolicy()
  const platformMethods = methodsFor(await getPlatformSettings())
  // Lookup is network I/O — keep it outside the invitation row lock.
  const existingLocation = profile && googleUser
    ? await prisma.user.findFirst({
      where: { email: googleUser.email },
      select: { pincode: true, city: true, state: true, country: true },
    })
    : null
  const located = profile ? await attachSignupLocation(profile, existingLocation) : null
  try {
    return await withAccountRaceRetry(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.invitation_hash', ${invitation.tokenHash}, true)`
      const snapshot = await tx.userInvitation.findUnique({ where: { id: invitation.id } })
      if (!snapshot || snapshot.tokenHash !== invitation.tokenHash) return fail(404, INVALID_LINK)
      const workspace = await lockInvitationTarget(tx, snapshot)
      if (!workspace && googleUser) requireMethod(platformMethods, googleUser.googleId ? 'google' : 'emailCode')
      if (workspace) {
        const existing = await tx.user.findUnique({ where: { email: snapshot.email }, select: { id: true } })
        const member = existing && await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: existing.id } } })
        requireLearnerDomain(workspace, snapshot.email, snapshot.proposedRole!, Boolean(member))
        if (googleUser) requireMethod(methodsFor(workspace), googleUser.googleId ? 'google' : 'emailCode')
      }
      const workspacePath = workspace ? `/w/${workspace.slug}` : undefined
      await tx.$queryRaw`SELECT 1 FROM "UserInvitation" WHERE "id" = ${invitation.id} FOR UPDATE`
      const inv = await tx.userInvitation.findUnique({ where: { id: invitation.id } })
      // A resend replaced the token: this link is superseded.
      if (!inv || inv.tokenHash !== invitation.tokenHash) return fail(404, INVALID_LINK)
      const status = effectiveStatus(inv)
      if (status === 'revoked') return fail(410, { error: 'invitation_revoked', message: 'This invitation was withdrawn. Ask your administrator for a new one.' })
      if (status === 'expired') return fail(410, { error: 'invitation_expired', message: 'This invitation has expired. Ask your administrator to resend it.' })

      // A pending emailed invitation is a single-use bearer credential for exactly its stored email.
      // Check this under the row lock: a concurrent acceptance must never turn it into a reusable login.
      if (!googleUser && status === 'accepted') return fail(401, {
        error: 'sign_in_required', message: 'This invitation has already been accepted. Sign in with an emailed code or Google.',
      })
      const identity: VerifiedSignInIdentity = googleUser ?? {
        email: inv.email, emailVerified: true, googleId: null,
        firstName: inv.recipientName, lastName: null, avatar: null,
      }
      if (!identity.emailVerified || identity.email !== inv.email) {
        return fail(403, {
          error: 'wrong_account',
          message: `This invitation is for ${inv.email}. Sign in with that address using Google or an emailed code.`,
          invitedEmail: inv.email,
        })
      }

      if (status === 'accepted') {
        // Idempotent repeat: plain sign-in for the account that accepted it.
        const account = await resolveGoogleAccount(tx, identity, req, { policy })
        if (!account.ok) return account
        if (account.user.id !== inv.acceptedUserId) throw new Abort(fail(409, { error: 'invitation_used', message: 'This invitation has already been used.' }))
        if (workspace) await acceptInvitedMembership(tx, inv, account.user.id, workspace.maxMembers, true)
        return { ok: true, user: workspace ? await tx.user.findUniqueOrThrow({ where: { id: account.user.id } }) : account.user, newAccount: false, alreadyAccepted: true, signupsPausedBypass: false, workspacePath }
      }

      const responses = workspace ? validateEnrollmentResponses(inv.enrollmentFields, req.body?.enrollmentResponses) : {}
      // The approved paused-signup exception applies only to platform invitations. Organization invitations
      // respect the public pause for new identities; see docs/INVITATIONS.md.
      const account = await resolveGoogleAccount(tx, identity, req, {
        policy,
        invitationBypassesSignupPause: !workspace,
        profile: located,
      })
      if (!account.ok) return account
      const bypassed = account.created && policy.paused
      if (workspace) await acceptInvitedMembership(tx, inv, account.user.id, workspace.maxMembers, false, responses)
      await tx.userInvitation.update({
        where: { id: inv.id },
        data: { status: 'ACCEPTED', pendingKey: null, acceptedAt: new Date(), acceptedUserId: account.user.id },
      })
      if (!workspace) await writeAcceptanceAudit(tx, {
        invitationId: inv.id, invitedById: inv.invitedById, userId: account.user.id, newAccount: account.created, signupsPausedBypass: bypassed, req,
      })
      return { ok: true, user: workspace ? await tx.user.findUniqueOrThrow({ where: { id: account.user.id } }) : account.user, newAccount: account.created, alreadyAccepted: false, signupsPausedBypass: bypassed, workspacePath }
    })
  } catch (err) {
    if (err instanceof Abort) return err.result
    if (err instanceof WorkspaceError) return fail(err.status, { error: err.code, message: err.message })
    throw err
  }
}
