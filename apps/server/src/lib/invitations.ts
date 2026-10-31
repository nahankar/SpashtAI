import crypto from 'crypto'
import { Prisma, type InvitationDeliveryStatus, type UserInvitation } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './prisma'
import { sendEmail } from './email'
import { logger } from './logger'

/**
 * Platform learner invitations. Every invitation targets an ordinary USER account and assigns no tenant or
 * organization; once real tenancy exists, creation, listing and acceptance must be scoped to the active tenant.
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

function newToken() {
  const token = crypto.randomBytes(32).toString('base64url')
  return { token, tokenHash: hashInvitationToken(token) }
}

function expiryFrom(now: Date) {
  return new Date(now.getTime() + invitationExpiryDays() * 24 * 60 * 60 * 1000)
}

export const invitationInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).optional().transform((v) => v || undefined),
  confirmExistingUser: z.boolean().optional(),
})

/** Stored PENDING rows past their expiry are reported as expired. */
export function effectiveStatus(inv: Pick<UserInvitation, 'status' | 'expiresAt'>, now = new Date()): InvitationView {
  if (inv.status === 'PENDING' && inv.expiresAt <= now) return 'expired'
  return inv.status.toLowerCase() as InvitationView
}

function viewWhere(view: InvitationView, now: Date): Prisma.UserInvitationWhereInput {
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
}

const devMailbox: CapturedInvitationEmail[] = []

/** The development mailbox never exists in production, whatever the delivery setting. */
export function devMailboxAvailable() {
  return process.env.NODE_ENV !== 'production' && invitationDeliveryMode() === 'dev_capture'
}

export function capturedInvitationEmails(): CapturedInvitationEmail[] {
  return devMailboxAvailable() ? [...devMailbox] : []
}

export function clearCapturedInvitationEmails() {
  devMailbox.length = 0
}

function acceptUrlFor(token: string) {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  // The token rides in the fragment so it never reaches server or proxy access logs.
  return `${base}/invite#token=${token}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

export function buildInvitationEmail(opts: { recipientName?: string | null; acceptUrl: string; expiresAt: Date }) {
  const greeting = opts.recipientName ? `Hi ${opts.recipientName},` : 'Hi,'
  const expires = opts.expiresAt.toUTCString()
  const subject = "You're invited to SpashtAI"
  const text = [
    greeting,
    '',
    'You have been invited to join SpashtAI, the AI communication coach, as a learner.',
    '',
    'Accept your invitation:',
    opts.acceptUrl,
    '',
    'Sign in with the Google Account for this email address. SpashtAI currently requires a Google Account;',
    'this can be a Gmail or Google Workspace address, or another address you have registered as a Google Account.',
    '',
    `This link works once and expires on ${expires}.`,
    "If you weren't expecting this invitation, you can ignore this email.",
    '',
    '— SpashtAI',
  ].join('\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;padding:32px" cellpadding="0" cellspacing="0">
<tr><td style="font-size:22px;font-weight:700;color:#4f46e5;padding-bottom:16px">SpashtAI</td></tr>
<tr><td style="font-size:16px;line-height:24px">${escapeHtml(greeting)}<br><br>You have been invited to join <strong>SpashtAI</strong>, the AI communication coach, as a learner.</td></tr>
<tr><td style="padding:24px 0"><a href="${escapeHtml(opts.acceptUrl)}" style="background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">Accept invitation</a></td></tr>
<tr><td style="font-size:14px;line-height:21px;color:#4b5563">Sign in with the Google Account for this email address. SpashtAI currently requires a Google Account; this can be a Gmail or Google Workspace address, or another address you have registered as a Google Account.<br><br>This link works once and expires on ${escapeHtml(expires)}. If you weren't expecting this invitation, you can ignore this email.</td></tr>
</table></td></tr></table></body></html>`
  return { subject, text, html }
}

async function deliver(inv: UserInvitation, token: string): Promise<{ deliveryStatus: InvitationDeliveryStatus; deliveryError: string | null }> {
  const acceptUrl = acceptUrlFor(token)
  const email = buildInvitationEmail({ recipientName: inv.recipientName, acceptUrl, expiresAt: inv.expiresAt })
  if (devMailboxAvailable()) {
    devMailbox.unshift({ id: inv.id, to: inv.email, subject: email.subject, text: email.text, acceptUrl, capturedAt: new Date().toISOString(), developmentOnly: true })
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

async function recordDelivery(inv: UserInvitation, token: string, now: Date) {
  const outcome = await deliver(inv, token)
  return prisma.userInvitation.update({
    where: { id: inv.id },
    data: { ...outcome, sendCount: { increment: 1 }, lastSentAt: now },
  })
}

// ---------------------------------------------------------------- admin actions

export type InvitationErrorCode = 'duplicate_pending' | 'existing_user' | 'not_found' | 'not_resendable' | 'not_revocable'
export class InvitationError extends Error {
  constructor(public code: InvitationErrorCode, public status: number, message: string, public details: Record<string, unknown> = {}) {
    super(message)
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

async function audit(adminId: string, action: string, inv: UserInvitation, metadata: Record<string, unknown>) {
  // Content-free: no email address, name or token.
  await prisma.adminAction.create({
    data: { adminId, action, targetResource: `invitation:${inv.id}`, metadata: metadata as Prisma.InputJsonValue },
  })
}

/** Marks stored PENDING rows for this address that have expired, so a new invitation can take the pending slot. */
async function expireStale(email: string, now: Date) {
  await prisma.userInvitation.updateMany({
    where: { email, status: 'PENDING', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', pendingKey: null },
  })
}

export async function createInvitation(adminId: string, input: z.infer<typeof invitationInputSchema>, now = new Date()) {
  const { email, name, confirmExistingUser } = input
  await expireStale(email, now)
  const pending = await prisma.userInvitation.findUnique({ where: { pendingKey: email } })
  if (pending) {
    throw new InvitationError('duplicate_pending', 409, 'A pending invitation already exists for this email. Resend it instead.', { invitationId: pending.id })
  }
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (existing && !confirmExistingUser) {
    throw new InvitationError('existing_user', 409, 'This email already has a SpashtAI account. Accepting will sign them in without changing their account.')
  }

  const { token, tokenHash } = newToken()
  let inv: UserInvitation
  try {
    inv = await prisma.userInvitation.create({
      data: { email, recipientName: name ?? null, pendingKey: email, tokenHash, expiresAt: expiryFrom(now), invitedById: adminId, existingUserAtInvite: Boolean(existing) },
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new InvitationError('duplicate_pending', 409, 'A pending invitation already exists for this email. Resend it instead.')
    throw err
  }
  inv = await recordDelivery(inv, token, now)
  await audit(adminId, 'invitation_create', inv, { deliveryStatus: inv.deliveryStatus, existingUser: inv.existingUserAtInvite, expiresAt: inv.expiresAt.toISOString() })
  return inv
}

/** Issues a fresh token (the previous link stops working) and a fresh expiry, then sends again. */
export async function resendInvitation(adminId: string, id: string, now = new Date()) {
  const current = await prisma.userInvitation.findUnique({ where: { id } })
  if (!current) throw new InvitationError('not_found', 404, 'Invitation not found')
  if (current.status === 'ACCEPTED' || current.status === 'REVOKED') {
    throw new InvitationError('not_resendable', 409, `An ${current.status.toLowerCase()} invitation cannot be resent.`)
  }
  const { token, tokenHash } = newToken()
  let inv: UserInvitation
  try {
    const updated = await prisma.userInvitation.updateMany({
      where: { id, status: { in: ['PENDING', 'EXPIRED'] } },
      data: { status: 'PENDING', pendingKey: current.email, tokenHash, expiresAt: expiryFrom(now), deliveryStatus: 'SENDING', deliveryError: null },
    })
    if (updated.count === 0) throw new InvitationError('not_resendable', 409, 'This invitation changed while resending. Refresh and try again.')
    inv = await prisma.userInvitation.findUniqueOrThrow({ where: { id } })
  } catch (err) {
    if (isUniqueViolation(err)) throw new InvitationError('duplicate_pending', 409, 'Another pending invitation exists for this email.')
    throw err
  }
  inv = await recordDelivery(inv, token, now)
  await audit(adminId, 'invitation_resend', inv, { deliveryStatus: inv.deliveryStatus, sendCount: inv.sendCount, expiresAt: inv.expiresAt.toISOString() })
  return inv
}

export async function revokeInvitation(adminId: string, id: string, now = new Date()) {
  const current = await prisma.userInvitation.findUnique({ where: { id } })
  if (!current) throw new InvitationError('not_found', 404, 'Invitation not found')
  if (current.status === 'REVOKED') return current
  const updated = await prisma.userInvitation.updateMany({
    where: { id, status: { in: ['PENDING', 'EXPIRED'] } },
    data: { status: 'REVOKED', pendingKey: null, revokedAt: now, revokedById: adminId },
  })
  if (updated.count === 0) throw new InvitationError('not_revocable', 409, 'An accepted invitation cannot be revoked.')
  const inv = await prisma.userInvitation.findUniqueOrThrow({ where: { id } })
  await audit(adminId, 'invitation_revoke', inv, { previousStatus: effectiveStatus(current, now) })
  return inv
}

export async function listInvitations(opts: { view?: InvitationView; q?: string; page: number; pageSize: number }, now = new Date()) {
  const q = opts.q?.trim()
  const search: Prisma.UserInvitationWhereInput = q
    ? { OR: [{ email: { contains: q, mode: 'insensitive' } }, { recipientName: { contains: q, mode: 'insensitive' } }] }
    : {}
  const where: Prisma.UserInvitationWhereInput = opts.view ? { AND: [viewWhere(opts.view, now), search] } : search
  const [items, total, ...counts] = await Promise.all([
    prisma.userInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (opts.page - 1) * opts.pageSize, take: opts.pageSize }),
    prisma.userInvitation.count({ where }),
    ...INVITATION_VIEWS.map((view) => prisma.userInvitation.count({ where: viewWhere(view, now) })),
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
  return prisma.userInvitation.findUnique({ where: { tokenHash: hashInvitationToken(token) } })
}

/** Marks the invitation accepted by this account. Returns false when it is no longer pending. */
export async function markInvitationAccepted(inv: UserInvitation, userId: string, now = new Date()) {
  const updated = await prisma.userInvitation.updateMany({
    where: { id: inv.id, tokenHash: inv.tokenHash, status: 'PENDING', expiresAt: { gt: now } },
    data: { status: 'ACCEPTED', pendingKey: null, acceptedAt: now, acceptedUserId: userId },
  })
  return updated.count === 1
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
  const { count } = await prisma.userInvitation.deleteMany({
    where: {
      OR: [
        { status: 'ACCEPTED', acceptedAt: { lt: cutoff } },
        { status: 'REVOKED', revokedAt: { lt: cutoff } },
        { status: { in: ['EXPIRED', 'PENDING'] }, expiresAt: { lt: cutoff } },
      ],
    },
  })
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
export async function deleteInvitationsForUser(tx: Prisma.TransactionClient, user: { id: string; email: string }) {
  const { count } = await tx.userInvitation.deleteMany({
    where: { OR: [{ email: user.email.toLowerCase() }, { acceptedUserId: user.id }] },
  })
  return count
}
