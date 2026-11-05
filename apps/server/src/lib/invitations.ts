import crypto from 'crypto'
import { reserveInvitationSend } from './invitationBatch'
import { emailContentSchema } from '../workspaces/enrollment'
import { Prisma, type InvitationDeliveryStatus, type UserInvitation } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './prisma'
import { sendEmail } from './email'
import { logger } from './logger'
import { workspacesEnabled } from '../workspaces/contracts'
import { assertWorkspaceDatabaseSafety } from '../workspaces/databaseSafety'
import { writeInvitationAudit } from './invitationAudit'

/**
 * Shared invitation delivery and platform learner invitations. Null-scope invitations grant no membership;
 * organization invitations use the workspace service and its current membership/role checks.
 * Raw acceptance tokens exist only in the sent link (and the development capture); the database keeps a hash.
 */

export const DEFAULT_INVITATION_EXPIRY_DAYS = 7
export type InvitationView = 'pending' | 'accepted' | 'expired' | 'revoked'
export const INVITATION_VIEWS: InvitationView[] = ['pending', 'accepted', 'expired', 'revoked']

/** INVITATION_EXPIRY_DAYS (1–30), default 7. */
export function invitationExpiryDays(): number {
  const raw = Number.parseInt(process.env.INVITATION_EXPIRY_DAYS ?? '', 10)
  return Number.isFinite(raw) && raw >= 1 && raw <= 30 ? raw : DEFAULT_INVITATION_EXPIRY_DAYS
}

export function hashInvitationToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex')
}

export function newToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

export function expiryFrom(now: Date) {
  return new Date(now.getTime() + invitationExpiryDays() * 24 * 60 * 60 * 1000)
}

export const invitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).optional().transform((v) => v || undefined),
  confirmExistingUser: z.boolean().optional(),
  emailContent: emailContentSchema.optional(),
})

/** Stored PENDING rows past their expiry are reported as expired. */
export function effectiveStatus(inv: Pick<UserInvitation, 'status' | 'expiresAt'>, now = new Date()): InvitationView {
  if (inv.status === 'PENDING' && inv.expiresAt <= now) return 'expired'
  return inv.status.toLowerCase() as InvitationView
}

export function viewWhere(view: InvitationView, now: Date): Prisma.UserInvitationWhereInput {
  switch (view) {
    case 'pending': return { status: 'PENDING', expiresAt: { gt: now } }
    case 'expired': return { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', expiresAt: { lte: now } }] }
    case 'accepted': return { status: 'ACCEPTED' }
    case 'revoked': return { status: 'REVOKED' }
  }
}

// ---------------------------------------------------------------- email delivery

const SMTP_REQUIRED = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'] as const

/**
 * Outside production, invitations are captured in memory (development only) unless
 * INVITATION_EMAIL_DELIVERY=smtp, so local testing never mails a real address by accident.
 * Production always uses SMTP: INVITATION_EMAIL_DELIVERY=capture is refused there.
 */
export function invitationDeliveryMode(): 'smtp' | 'dev_capture' {
  if (process.env.NODE_ENV === 'production') return 'smtp'
  return process.env.INVITATION_EMAIL_DELIVERY?.trim() === 'smtp' ? 'smtp' : 'dev_capture'
}

/** Logged once at startup so a production capture setting is visibly ignored, never silently honoured. */
export function warnIfCaptureRequestedInProduction() {
  if (process.env.NODE_ENV === 'production' && process.env.INVITATION_EMAIL_DELIVERY?.trim() === 'capture') {
    logger.error({ event: 'invitations.capture_refused' }, 'INVITATION_EMAIL_DELIVERY=capture is ignored in production; invitations use SMTP')
  }
}

export function invitationEmailConfig() {
  const missing: string[] = SMTP_REQUIRED.filter((key) => !process.env[key]?.trim())
  if (!process.env.FRONTEND_URL?.trim()) missing.push('FRONTEND_URL')
  return {
    mode: invitationDeliveryMode(),
    // Set when production was asked to capture mail; the request is refused.
    captureRefused: process.env.NODE_ENV === 'production' && process.env.INVITATION_EMAIL_DELIVERY?.trim() === 'capture',
    expiryDays: invitationExpiryDays(),
    smtpReady: missing.length === 0,
    // Names only — never values.
    missing,
    optional: ['SMTP_PORT (default 587; 465 uses TLS)', 'SMTP_FROM (default noreply@spashtai.com)', 'INVITATION_EXPIRY_DAYS (default 7)', 'INVITATION_RETENTION_DAYS (default 90)'],
  }
}

export interface CapturedInvitationEmail {
  id: string
  to: string
  subject: string
  text: string
  acceptUrl: string
  capturedAt: string
  developmentOnly: true
  workspaceId?: string | null
}

const devMailbox: CapturedInvitationEmail[] = []

/** The development mailbox never exists in production, whatever the delivery setting. */
export function devMailboxAvailable() {
  return process.env.NODE_ENV !== 'production' && invitationDeliveryMode() === 'dev_capture'
}

export function capturedInvitationEmails(workspaceId?: string): CapturedInvitationEmail[] {
  return devMailboxAvailable() ? devMailbox.filter(mail => workspaceId ? mail.workspaceId === workspaceId : !mail.workspaceId) : []
}

export function clearCapturedInvitationEmails() {
  devMailbox.length = 0
}

function acceptUrlFor(token: string, workspaceSlug?: string) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  // The token rides in the fragment so it never reaches server or proxy access logs.
  const path = workspaceSlug ? `/w/${encodeURIComponent(workspaceSlug)}/invite` : '/invite'
  return `${base}${path}#token=${token}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function invitationExpiryFooter(expiresAt: Date) {
  const expires = expiresAt.toUTCString()
  return {
    expires,
    notice: `This link works once and expires on ${expires}. If you weren't expecting this invitation, you can ignore this email.`,
    replies: 'Replies to this mailbox are not routinely monitored and may not receive a response.',
  }
}

export function buildInvitationEmail(opts: { recipientName?: string | null; acceptUrl: string; expiresAt: Date; workspaceName?: string; emailSubject?: string | null; emailMessage?: string | null }) {
  const subject = opts.emailSubject || (opts.workspaceName ? `You're invited to ${opts.workspaceName} on SpashtAI` : "You're invited to SpashtAI")
  const message = opts.emailMessage?.trim() ?? ''
  const footer = invitationExpiryFooter(opts.expiresAt)
  const text = [
    ...(message ? [message, ''] : []),
    opts.acceptUrl,
    '',
    footer.notice,
    '',
    footer.replies,
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0">
${message ? `<tr><td style="font-size:16px;line-height:24px">${escapeHtml(message).replace(/\n/g, '<br>')}</td></tr>` : ''}
<tr><td style="padding:24px 0"><a href="${escapeHtml(opts.acceptUrl)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Accept invitation</a></td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#4b5563">${escapeHtml(footer.notice)}<br><br>${escapeHtml(footer.replies)}</td></tr>
</table></td></tr></table></body></html>`
  return { subject, text, html }
}

async function deliver(inv: UserInvitation, token: string, workspaceName?: string, workspaceSlug?: string): Promise<{ deliveryStatus: InvitationDeliveryStatus; deliveryError: string | null }> {
  const acceptUrl = acceptUrlFor(token, workspaceSlug)
  const email = buildInvitationEmail({ recipientName: inv.recipientName, acceptUrl, expiresAt: inv.expiresAt, workspaceName, emailSubject: inv.emailSubject, emailMessage: inv.emailMessage })
  if (devMailboxAvailable()) {
    devMailbox.unshift({ workspaceId: inv.workspaceId, id: inv.id, to: inv.email, subject: email.subject, text: email.text, acceptUrl, capturedAt: new Date().toISOString(), developmentOnly: true })
    devMailbox.length = Math.min(devMailbox.length, 25)
    return { deliveryStatus: 'DEV_CAPTURED', deliveryError: null }
  }
  if (!invitationEmailConfig().smtpReady) return { deliveryStatus: 'FAILED', deliveryError: 'smtp_not_configured' }
  try {
    const result = await sendEmail({ to: inv.email, ...email, logBody: false })
    return result.sent ? { deliveryStatus: 'SENT', deliveryError: null } : { deliveryStatus: 'FAILED', deliveryError: result.reason ?? 'send_failed' }
  } catch {
    return { deliveryStatus: 'FAILED', deliveryError: 'send_failed' }
  }
}

/** One send attempt, captured under the row lock in the transaction that started it. */
export interface SendAttempt {
  invitation: UserInvitation
  token: string
  workspaceName?: string
  workspaceSlug?: string
}

/**
 * Sends one attempt outside any database transaction, then records its outcome (and a content-free delivery
 * audit row) in one short transaction, fenced to that attempt's token: a resend replaces the token, so an older
 * send that finishes late is audited as superseded instead of overwriting the newer attempt's status. Attempts
 * are counted when they start, so a stale outcome loses no accounting. If the outcome cannot be recorded, the
 * invitation keeps its SENDING status rather than reporting an error for a state change that already committed.
 */
export async function deliverAttempt(adminId: string, attempt: SendAttempt, run: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T> = work => prisma.$transaction(work)) {
  const { invitation: inv, token } = attempt
  const outcome = await deliver(inv, token, attempt.workspaceName, attempt.workspaceSlug)
  try {
    const stale = await run(async (tx) => {
      const { count } = await tx.userInvitation.updateMany({ where: { id: inv.id, tokenHash: hashInvitationToken(token) }, data: outcome })
      const metadata = { attempt: inv.sendCount, deliveryStatus: outcome.deliveryStatus, superseded: count === 0 }
      if (inv.workspaceId) await tx.workspaceAudit.create({ data: { workspaceId: inv.workspaceId, actorUserId: adminId, action: 'invitation_delivery', subjectId: inv.id, metadata } })
      else await writeInvitationAudit(tx, adminId, 'invitation_delivery', inv.id, metadata)
      return count === 0
    })
    if (stale) logger.info({ event: 'invitations.stale_delivery_ignored', invitationId: inv.id, deliveryStatus: outcome.deliveryStatus }, 'Ignored delivery outcome of a superseded send')
  } catch (error) {
    logger.error({ event: 'invitations.delivery_record_failed', invitationId: inv.id, errorType: error instanceof Error ? error.name : 'unknown' }, 'Could not record invitation delivery outcome')
  }
  // Deleted meanwhile (e.g. the account was removed): report the attempt as it started.
  try { return (await run(tx => tx.userInvitation.findUnique({ where: { id: inv.id } }))) ?? inv } catch { return inv }
}

// ---------------------------------------------------------------- admin actions

export type InvitationErrorCode = 'duplicate_pending' | 'existing_user' | 'not_found' | 'not_resendable' | 'not_revocable'
export class InvitationError extends Error {
  constructor(public code: InvitationErrorCode, public status: number, message: string, public details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'InvitationError'
  }
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export function serializeInvitation(inv: UserInvitation, now = new Date()) {
  return {
    id: inv.id,
    email: inv.email,
    recipientName: inv.recipientName,
    status: effectiveStatus(inv, now),
    deliveryStatus: inv.deliveryStatus,
    deliveryError: inv.deliveryError,
    sendCount: inv.sendCount,
    lastSentAt: inv.lastSentAt,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    acceptedAt: inv.acceptedAt,
    revokedAt: inv.revokedAt,
    existingUserAtInvite: inv.existingUserAtInvite,
  }
}

const lockInvitation = (tx: Prisma.TransactionClient, id: string) => tx.$queryRaw`SELECT 1 FROM "UserInvitation" WHERE "id" = ${id} FOR UPDATE`

/** Test seam: runs inside the resend transaction after the update, before the attempt snapshot is read. */
export const invitationTestHooks: { afterResendUpdate?: () => Promise<void> } = {}

/**
 * Creates the invitation and its `invitation_create` audit row in one transaction, then sends outside it. An
 * audit failure therefore leaves no invitation and sends nothing.
 */
export async function createInvitation(adminId: string, input: z.infer<typeof invitationInputSchema>, now = new Date()) {
  reserveInvitationSend(adminId)
  const { email, name, confirmExistingUser } = input
  const { token, tokenHash } = newToken()
  let invitation: UserInvitation
  try {
    invitation = await prisma.$transaction(async (tx) => {
      // Stored PENDING rows for this address that have expired give up the pending slot.
      await tx.userInvitation.updateMany({ where: { workspaceId: null, email, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED', pendingKey: null } })
      const pending = await tx.userInvitation.findUnique({ where: { pendingKey: email, workspaceId: null } })
      if (pending) {
        throw new InvitationError('duplicate_pending', 409, 'A pending invitation already exists for this email. Resend it instead.', { invitationId: pending.id })
      }
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } })
      if (existing && !confirmExistingUser) {
        throw new InvitationError('existing_user', 409, 'This email already has a SpashtAI account. Accepting will sign them in without changing their account.')
      }
      const inv = await tx.userInvitation.create({
        data: { emailSubject: input.emailContent?.subject || null, emailMessage: input.emailContent?.message || null, email, recipientName: name ?? null, pendingKey: email, tokenHash, expiresAt: expiryFrom(now), invitedById: adminId, existingUserAtInvite: Boolean(existing), sendCount: 1, lastSentAt: now },
      })
      await writeInvitationAudit(tx, adminId, 'invitation_create', inv.id, { attempt: 1, existingUser: inv.existingUserAtInvite, expiresAt: inv.expiresAt.toISOString() })
      return inv
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new InvitationError('duplicate_pending', 409, 'A pending invitation already exists for this email. Resend it instead.')
    throw err
  }
  return deliverAttempt(adminId, { invitation, token })
}

/**
 * Issues a fresh token (the previous link stops working) and expiry. The row is locked, updated, read back and
 * audited in one transaction, so this attempt's token, expiry and count can never be another resend's. The
 * email is sent afterwards, outside the transaction.
 */
export async function resendInvitation(adminId: string, id: string, now = new Date()) {
  reserveInvitationSend(adminId)
  const { token, tokenHash } = newToken()
  let invitation: UserInvitation
  try {
    invitation = await prisma.$transaction(async (tx) => {
      await lockInvitation(tx, id)
      const current = await tx.userInvitation.findUnique({ where: { id, workspaceId: null } })
      if (!current) throw new InvitationError('not_found', 404, 'Invitation not found')
      if (current.status === 'ACCEPTED' || current.status === 'REVOKED') {
        throw new InvitationError('not_resendable', 409, `An ${current.status.toLowerCase()} invitation cannot be resent.`)
      }
      await tx.userInvitation.update({
        where: { id, workspaceId: null },
        data: { status: 'PENDING', pendingKey: current.email, tokenHash, expiresAt: expiryFrom(now), deliveryStatus: 'SENDING', deliveryError: null, sendCount: { increment: 1 }, lastSentAt: now },
      })
      await invitationTestHooks.afterResendUpdate?.()
      const inv = await tx.userInvitation.findUniqueOrThrow({ where: { id, workspaceId: null } })
      await writeInvitationAudit(tx, adminId, 'invitation_resend', inv.id, { attempt: inv.sendCount, expiresAt: inv.expiresAt.toISOString() })
      return inv
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new InvitationError('duplicate_pending', 409, 'Another pending invitation exists for this email.')
    throw err
  }
  return deliverAttempt(adminId, { invitation, token })
}

/** Revokes under the row lock; the state change and its audit row commit together or not at all. */
export async function revokeInvitation(adminId: string, id: string, now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await lockInvitation(tx, id)
    const current = await tx.userInvitation.findUnique({ where: { id, workspaceId: null } })
    if (!current) throw new InvitationError('not_found', 404, 'Invitation not found')
    if (current.status === 'REVOKED') return current
    if (current.status === 'ACCEPTED') throw new InvitationError('not_revocable', 409, 'An accepted invitation cannot be revoked.')
    const inv = await tx.userInvitation.update({
      where: { id, workspaceId: null },
      data: { status: 'REVOKED', pendingKey: null, revokedAt: now, revokedById: adminId },
    })
    await writeInvitationAudit(tx, adminId, 'invitation_revoke', inv.id, { previousStatus: effectiveStatus(current, now) })
    return inv
  })
}

export async function listInvitations(opts: { view?: InvitationView; q?: string; page: number; pageSize: number }, now = new Date()) {
  const q = opts.q?.trim()
  const search: Prisma.UserInvitationWhereInput = q
    ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { recipientName: { contains: q, mode: 'insensitive' } }] }
    : {}
  const where: Prisma.UserInvitationWhereInput = { workspaceId: null, AND: [search, ...(opts.view ? [viewWhere(opts.view, now)] : [])] }
  const [items, total, ...counts] = await Promise.all([
    prisma.userInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize }),
    prisma.userInvitation.count({ where }),
    ...INVITATION_VIEWS.map((view) => prisma.userInvitation.count({ where: { workspaceId: null, ...viewWhere(view, now) } })),
  ])
  return {
    items: items.map((inv) => serializeInvitation(inv, now)),
    total,
    page: opts.page,
    pageSize: opts.pageSize,
    totalPages: Math.max(1, Math.ceil(total / opts.pageSize)),
    counts: Object.fromEntries(INVITATION_VIEWS.map((view, i) => [view, counts[i]])) as Record<InvitationView, number>,
  }
}

// ---------------------------------------------------------------- recipient side

export async function findInvitationByToken(token: string) {
  if (!token || token.length > 200) return null
  return prisma.$transaction(async tx => {
    const hash = hashInvitationToken(token)
    await tx.$queryRaw`SELECT set_config('app.invitation_hash', ${hash}, true)`
    const inv = await tx.userInvitation.findUnique({ where: { tokenHash: hash } })
    if (inv?.workspaceId) {
      if (!workspacesEnabled()) return null
      await assertWorkspaceDatabaseSafety(tx)
    }
    const workspace = inv?.workspaceId ? await tx.workspace.findUnique({
      where: { id: inv.workspaceId }, select: { name: true, slug: true, logoDataUrl: true, accentColor: true },
    }) : null
    return inv ? { ...inv, workspace } : null
  })
}


// ---------------------------------------------------------------- retention

export const DEFAULT_INVITATION_RETENTION_DAYS = 90

/** INVITATION_RETENTION_DAYS (30–730), default 90. */
export function invitationRetentionDays(): number {
  const raw = Number.parseInt(process.env.INVITATION_RETENTION_DAYS ?? '', 10)
  return Number.isFinite(raw) && raw >= 30 && raw <= 730 ? raw : DEFAULT_INVITATION_RETENTION_DAYS
}

/**
 * Deletes closed invitations (with their email and name) once they are older than the retention period:
 * accepted ones by acceptance date, revoked ones by revocation date, expired ones by expiry. Pending invitations
 * are never purged. Idempotent, like the other retention sweeps.
 */
export async function purgeClosedInvitations(now = new Date()) {
  const cutoff = new Date(now.getTime() - invitationRetentionDays() * 24 * 60 * 60 * 1000)
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`SELECT public.purge_closed_invitations(${cutoff}::timestamp) AS count`
  const count = rows[0]?.count ?? 0
  return count
}

let retentionTimer: NodeJS.Timeout | null = null
let purging = false
/** Hourly per API process, like the evaluator budget cleanup. */
export function startInvitationRetentionWorker() {
  if (retentionTimer) return
  const run = () => {
    if (purging) return
    purging = true
    void purgeClosedInvitations()
      .then((count) => { if (count) logger.info({ event: 'invitations.purged', count }, 'Purged closed invitations past retention') })
      .catch((error) => logger.error({ event: 'invitations.purge_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Invitation retention purge failed'))
      .finally(() => { purging = false })
  }
  retentionTimer = setInterval(run, 3600000)
  retentionTimer.unref?.()
}

/**
 * Removes every invitation for a deleted account (by address or by the account that accepted it), so no
 * invitation email or name outlives the user. Run in the same transaction as the user delete.
 */
export async function deleteInvitationsForUser(tx: Prisma.TransactionClient, user: { id: string; email: string }, actorId: string) {
  await tx.$queryRaw`SELECT set_config('app.workspace_actor_id', ${actorId}, true), set_config('app.workspace_platform_admin', 'true', true)`
  const rows = await tx.$queryRaw<Array<{ count: number }>>`SELECT public.delete_user_invitations(${user.id}) AS count`
  const count = rows[0]?.count ?? 0
  return count
}
