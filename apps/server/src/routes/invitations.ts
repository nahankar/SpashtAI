import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'
import { signToken } from '../lib/jwt'
import { logger } from '../lib/logger'
import { verifyGoogleIdToken, type GoogleUserInfo } from '../lib/google-auth'
import { signInWithGoogleUser } from '../lib/googleSignIn'
import { areSignupsPaused } from '../lib/platformSettings'
import { authUserForClient } from '../lib/profile'
import { effectiveStatus, findInvitationByToken, markInvitationAccepted } from '../lib/invitations'
import { invitationAcceptLimiter } from '../middleware/rate-limit'

// Public recipient endpoints. The token travels in the request body (the link keeps it in the URL fragment),
// so it never appears in access logs.
const router = Router()

const INVALID_LINK = {
  error: 'invalid_link',
  message: 'This invitation link is not valid. If you received a newer invitation email, use the link in that email.',
}

router.post('/lookup', invitationAcceptLimiter, async (req: Request, res: Response) => {
  try {
    const inv = await findInvitationByToken(String(req.body?.token ?? ''))
    if (!inv) {
      res.status(404).json(INVALID_LINK)
      return
    }
    res.json({
      status: effectiveStatus(inv),
      recipientName: inv.recipientName,
      // The link holder is shown the full address so they know which Google Account to use.
      invitedEmail: inv.email,
      expiresAt: inv.expiresAt,
    })
  } catch (err) {
    logger.error({ err }, 'Invitation lookup failed')
    res.status(500).json({ error: 'Could not check this invitation' })
  }
})

router.post('/accept', invitationAcceptLimiter, async (req: Request, res: Response) => {
  try {
    const { token, credential } = (req.body ?? {}) as { token?: string; credential?: string }
    if (!credential) {
      res.status(400).json({ error: 'Google credential is required' })
      return
    }
    const inv = await findInvitationByToken(String(token ?? ''))
    if (!inv) {
      res.status(404).json(INVALID_LINK)
      return
    }

    let googleUser: GoogleUserInfo
    try {
      googleUser = await verifyGoogleIdToken(credential)
    } catch {
      res.status(401).json({ error: 'google_sign_in_failed', message: 'Google sign-in failed. Please try again.' })
      return
    }
    // The invitation is bound to a verified Google identity for exactly the invited address.
    if (!googleUser.emailVerified || googleUser.email !== inv.email) {
      res.status(403).json({
        error: 'wrong_account',
        message: `This invitation is for ${inv.email}. Switch Google account and sign in with that address.`,
        invitedEmail: inv.email,
      })
      return
    }

    const status = effectiveStatus(inv)
    if (status === 'revoked' || status === 'expired') {
      res.status(410).json({
        error: `invitation_${status}`,
        message: status === 'revoked'
          ? 'This invitation was withdrawn. Ask your administrator for a new one.'
          : 'This invitation has expired. Ask your administrator to resend it.',
      })
      return
    }

    // Same account resolution as normal Google sign-in: an existing account keeps its data, role and
    // permissions; a new account then goes through normal onboarding. A pending, unexpired invitation for this
    // exact verified address may create a USER account while signups are paused; nothing else bypasses the pause.
    const pending = status === 'pending'
    const signupsPaused = pending && (await areSignupsPaused())
    const result = await signInWithGoogleUser(googleUser, req, { invitationBypassesSignupPause: pending })
    if (!result.ok) {
      res.status(result.status).json(result.body)
      return
    }
    const { user } = result

    let alreadyAccepted = status === 'accepted'
    if (alreadyAccepted) {
      if (inv.acceptedUserId !== user.id) {
        res.status(409).json({ error: 'invitation_used', message: 'This invitation has already been used.' })
        return
      }
    } else if (!(await markInvitationAccepted(inv, user.id))) {
      const latest = await prisma.userInvitation.findUnique({ where: { id: inv.id } })
      if (latest?.status !== 'ACCEPTED' || latest.acceptedUserId !== user.id) {
        // Revoked or expired while signing in: an account created only for this invitation is removed again.
        if (result.created) await prisma.user.delete({ where: { id: user.id } })
        res.status(409).json({ error: 'invitation_changed', message: 'This invitation changed while you were signing in. Ask your administrator for a new one.' })
        return
      }
      alreadyAccepted = true
    } else {
      const bypassed = result.created && signupsPaused
      await prisma.userActivity.create({
        data: {
          userId: user.id,
          action: 'invitation_accepted',
          resource: 'invitation',
          resourceId: inv.id,
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
          // Content-free: records only that the paused-signup control was bypassed by this invitation.
          metadata: { newAccount: result.created, signupsPausedBypass: bypassed },
        },
      })
      // Also in the Admin audit trail, attributed to the inviting Admin; the recipient is the target account.
      await prisma.adminAction.create({
        data: {
          adminId: inv.invitedById,
          action: 'invitation_accepted',
          targetUserId: user.id,
          targetResource: `invitation:${inv.id}`,
          metadata: { actor: 'recipient', newAccount: result.created, signupsPausedBypass: bypassed },
        },
      })
    }

    const jwt = signToken({ userId: user.id, email: user.email, role: user.role })
    res.json({ token: jwt, user: await authUserForClient(user), alreadyAccepted, newAccount: result.created })
  } catch (err) {
    logger.error({ err }, 'Invitation acceptance failed')
    res.status(500).json({ error: 'Could not accept this invitation' })
  }
})

export default router
