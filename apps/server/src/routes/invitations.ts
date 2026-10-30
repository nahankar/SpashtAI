import { Router, type Request, type Response } from 'express'
import { prisma } from '../lib/prisma'
import { signToken } from '../lib/jwt'
import { logger } from '../lib/logger'
import { verifyGoogleIdToken, type GoogleUserInfo } from '../lib/google-auth'
import { signInWithGoogleUser } from '../lib/googleSignIn'
import { authUserForClient } from '../lib/profile'
import { effectiveStatus, findInvitationByToken, markInvitationAccepted, maskEmail } from '../lib/invitations'
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
      invitedEmail: maskEmail(inv.email),
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
        message: `This invitation is for ${maskEmail(inv.email)}. Switch Google account and sign in with that address.`,
        invitedEmail: maskEmail(inv.email),
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
    // permissions; a new account respects signups-paused and then goes through normal onboarding.
    const result = await signInWithGoogleUser(googleUser, req)
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
        res.status(409).json({ error: 'invitation_changed', message: 'This invitation changed while you were signing in. Ask your administrator for a new one.' })
        return
      }
      alreadyAccepted = true
    } else {
      await prisma.userActivity.create({
        data: { userId: user.id, action: 'invitation_accepted', resource: 'invitation', resourceId: inv.id, ipAddress: req.ip || null, userAgent: req.headers['user-agent'] || null },
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
