import { Router, type Request, type Response } from 'express'
import { signToken } from '../lib/jwt'
import { logger } from '../lib/logger'
import { verifyGoogleIdToken, type GoogleUserInfo } from '../lib/google-auth'
import { INVALID_LINK, acceptInvitation } from '../lib/invitationAcceptance'
import { authUserForClient } from '../lib/profile'
import { effectiveStatus, findInvitationByToken } from '../lib/invitations'
import { invitationAcceptLimiter } from '../middleware/rate-limit'

// Public recipient endpoints. The token travels in the request body (the link keeps it in the URL fragment),
// so it never appears in access logs.
const router = Router()

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
      workspaceInvitation: Boolean(inv.workspaceId),
      proposedRole: inv.proposedRole,
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
    // Validation, account resolution, acceptance and audit happen in one locked transaction.
    const result = await acceptInvitation(inv, googleUser, req)
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
