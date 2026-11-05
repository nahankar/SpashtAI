import { Router, type Request, type Response } from 'express'
import { consumeEmailSignInCode, EmailCodeError, requestEmailSignInCode } from '../lib/emailSignIn'
import type { VerifiedSignInIdentity } from '../lib/googleSignIn'
import { signToken } from '../lib/jwt'
import { logger } from '../lib/logger'
import { verifyGoogleIdToken } from '../lib/google-auth'
import { INVALID_LINK, acceptInvitation } from '../lib/invitationAcceptance'
import { authUserForClient, readSignupProfile } from '../lib/profile'
import { effectiveStatus, findInvitationByToken } from '../lib/invitations'
import { invitationAcceptLimiter } from '../middleware/rate-limit'

// Public recipient endpoints. The token travels in the request body (the link keeps it in the URL fragment),
// so it never appears in access logs.
const router = Router()

router.post('/email-code/request', invitationAcceptLimiter, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''
    const inv = await findInvitationByToken(token)
    if (!inv) { res.status(404).json(INVALID_LINK); return }
    if (!['pending', 'accepted'].includes(effectiveStatus(inv))) {
      res.status(410).json({ error: 'invitation_closed', message: 'This invitation has expired or was withdrawn. Ask your administrator for a new one.' }); return
    }
    res.json(await requestEmailSignInCode(inv.email, token))
  } catch (err) {
    if (err instanceof EmailCodeError) { res.status(err.status).json({ error: err.code, message: err.message }); return }
    logger.error({ event: 'invitation.email_code_request_failed' }, 'Invitation code request failed')
    res.status(500).json({ error: 'Could not send a sign-in code' })
  }
})

router.post('/lookup', invitationAcceptLimiter, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const inv = await findInvitationByToken(String(req.body?.token ?? ''))
    if (!inv) {
      res.status(404).json(INVALID_LINK)
      return
    }
    res.json({
      status: effectiveStatus(inv),
      recipientName: inv.recipientName,
      // The link holder is shown the full address so they know which address to verify.
      invitedEmail: inv.email,
      expiresAt: inv.expiresAt,
      workspaceInvitation: Boolean(inv.workspaceId),
      workspace: inv.workspace,
      proposedRole: inv.proposedRole,
      enrollmentFields: inv.status === 'PENDING' && effectiveStatus(inv) === 'pending' ? inv.enrollmentFields : [],
    })
  } catch (err) {
    logger.error({ err }, 'Invitation lookup failed')
    res.status(500).json({ error: 'Could not check this invitation' })
  }
})

router.post('/accept', invitationAcceptLimiter, async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store')
  try {
    const { token, credential, challengeId, code } = (req.body ?? {}) as { token?: string; credential?: string; challengeId?: string; code?: string }
    const inv = await findInvitationByToken(String(token ?? ''))
    if (!inv) {
      res.status(404).json(INVALID_LINK)
      return
    }

    const profileRead = readSignupProfile(req.body)
    if (!profileRead.ok) {
      res.status(400).json({ error: 'PROFILE_REQUIRED', message: profileRead.error })
      return
    }

    let googleUser: VerifiedSignInIdentity | null = null
    try {
      if (credential || challengeId) googleUser = challengeId
        ? await consumeEmailSignInCode(challengeId, code, String(token ?? ''))
        : await verifyGoogleIdToken(credential!)
    } catch (err) {
      if (err instanceof EmailCodeError) { res.status(err.status).json({ error: err.code, message: err.message }); return }
      res.status(401).json({ error: 'google_sign_in_failed', message: 'Google sign-in failed. Please try again.' })
      return
    }
    // Validation, account resolution, acceptance and audit happen in one locked transaction.
    const result = await acceptInvitation(inv, googleUser, req, profileRead.data)
    if (!result.ok) {
      res.status(result.status).json(result.body)
      return
    }
    const jwt = signToken({ userId: result.user.id, email: result.user.email, role: result.user.role })
    res.json({ token: jwt, user: await authUserForClient(result.user), alreadyAccepted: result.alreadyAccepted, newAccount: result.newAccount, workspacePath: result.workspacePath })
  } catch (err) {
    logger.error({ err }, 'Invitation acceptance failed')
    res.status(500).json({ error: 'Could not accept this invitation' })
  }
})

export default router
