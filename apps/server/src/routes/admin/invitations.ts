import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { logger } from '../../lib/logger'
import { invitationSendLimiter } from '../../middleware/rate-limit'
import {
  INVITATION_VIEWS,
  InvitationError,
  capturedInvitationEmails,
  createInvitation,
  devMailboxAvailable,
  invitationEmailConfig,
  invitationInputSchema,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  serializeInvitation,
} from '../../lib/invitations'

// Mounted behind requireAuth + requireCurrentAdmin. Platform-wide by design: there is no tenant yet, so these
// endpoints must never be exposed to a tenant administrator until every query is scoped to the active tenant.
const router = Router()

const listQuery = z.object({
  status: z.enum(INVITATION_VIEWS as [string, ...string[]]).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch((err) => {
      if (err instanceof InvitationError) {
        res.status(err.status).json({ error: err.code, code: err.code, message: err.message, ...err.details })
        return
      }
      logger.error({ err }, 'Admin invitation request failed')
      next(err)
    })
  }
}

function deliveryNotice(deliveryStatus: string) {
  if (deliveryStatus === 'DEV_CAPTURED') return 'Captured locally (development only). No email was sent.'
  if (deliveryStatus === 'FAILED') return 'The invitation was saved but the email could not be sent. It stays pending; fix email delivery and resend.'
  return 'Accepted by the mail server for delivery.'
}

router.get('/', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_query' })
    return
  }
  const { status, ...rest } = parsed.data
  res.json(await listInvitations({ view: status as (typeof INVITATION_VIEWS)[number] | undefined, ...rest }))
}))

router.get('/email-config', (_req, res) => {
  res.json(invitationEmailConfig())
})

// Development-only captured invitations (with their accept links) for local testing. Never available in production.
router.get('/dev-mailbox', (_req, res) => {
  if (!devMailboxAvailable()) {
    res.status(404).json({ error: 'not_available' })
    return
  }
  res.json({ developmentOnly: true, messages: capturedInvitationEmails() })
})

router.post('/', invitationSendLimiter, handle(async (req, res) => {
  const parsed = invitationInputSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_email', message: 'Enter a valid email address.' })
    return
  }
  const inv = await createInvitation(req.user!.userId, parsed.data)
  res.status(201).json({ invitation: serializeInvitation(inv), notice: deliveryNotice(inv.deliveryStatus) })
}))

router.post('/:id/resend', invitationSendLimiter, handle(async (req, res) => {
  const inv = await resendInvitation(req.user!.userId, req.params.id)
  res.json({ invitation: serializeInvitation(inv), notice: deliveryNotice(inv.deliveryStatus) })
}))

router.post('/:id/revoke', handle(async (req, res) => {
  const inv = await revokeInvitation(req.user!.userId, req.params.id)
  res.json({ invitation: serializeInvitation(inv) })
}))

export default router
