import crypto from 'crypto'
import { prisma } from './prisma'
import { sendEmail } from './email'
import type { VerifiedSignInIdentity } from './googleSignIn'

const TEN_MINUTES = 10 * 60_000
type CodeRow = { email: string; challengeId: string; contextHash: string; codeHash: string | null; expiresAt: Date; sentAt: Date; attempts: number; windowStart: Date; sends: number }

export class EmailCodeError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message) }
}

export function normalizeSignInEmail(value: unknown): string {
  if (typeof value !== 'string') throw new EmailCodeError(400, 'invalid_email', 'Enter a valid email address.')
  const email = value.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\]+$/.test(email)) {
    throw new EmailCodeError(400, 'invalid_email', 'Enter a valid email address.')
  }
  return email
}

function digest(value: string) {
  const secret = process.env.EMAIL_CODE_SECRET || process.env.JWT_SECRET
  if (!secret && process.env.NODE_ENV === 'production') throw new Error('Email code secret is not configured')
  return crypto.createHmac('sha256', secret || 'local-email-code-development-only').update(value).digest('hex')
}
const contextHash = (invitationToken?: string) => crypto.createHash('sha256').update(invitationToken || 'personal-signin').digest('hex')
const invalidCode = () => new EmailCodeError(401, 'invalid_email_code', 'The code is incorrect, expired, or already used. Request a new code if needed.')

/** Reserve the mailbox budget under a database lock; SMTP runs outside the transaction. */
export async function requestEmailSignInCode(email: string, invitationToken?: string) {
  const challengeId = crypto.randomBytes(32).toString('hex')
  const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
  const hash = digest(`${challengeId}:${code}`)
  const context = contextHash(invitationToken)
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO "EmailSignInCode" ("email", "challengeId", "contextHash", "expiresAt", "sentAt", "windowStart")
      VALUES (${email}, ${challengeId}, ${context}, NOW(), to_timestamp(0), NOW()) ON CONFLICT ("email") DO NOTHING`
    const [row] = await tx.$queryRaw<CodeRow[]>`SELECT * FROM "EmailSignInCode" WHERE "email" = ${email} FOR UPDATE`
    const now = Date.now()
    const sameWindow = now - row.windowStart.getTime() < 60 * 60_000
    if (now - row.sentAt.getTime() < 60_000 || (sameWindow && row.sends >= 5)) {
      throw new EmailCodeError(429, 'email_code_rate_limit', 'Please wait before requesting another code. You can request up to five codes per hour.')
    }
    await tx.$executeRaw`UPDATE "EmailSignInCode" SET "challengeId" = ${challengeId}, "contextHash" = ${context},
      "codeHash" = ${hash}, "expiresAt" = ${new Date(now + TEN_MINUTES)}, "sentAt" = ${new Date(now)},
      "attempts" = 0, "windowStart" = ${sameWindow ? row.windowStart : new Date(now)}, "sends" = ${sameWindow ? row.sends + 1 : 1}
      WHERE "email" = ${email}`
  })
  const result = await sendEmail({
    to: email, subject: 'Your SpashtAI sign-in code', logBody: false,
    text: `Your SpashtAI sign-in code is: ${code}\n\nThis code expires in 10 minutes and can only be used once. Use it only on SpashtAI. Do not share it.\n\nIf you did not request this code, you can ignore this email.\n\nReplies to this mailbox are not routinely monitored.`,
  })
  if (!result.sent) {
    // Never leave a credential usable when delivery failed; do not erase a newer resend.
    await prisma.$executeRaw`UPDATE "EmailSignInCode" SET "codeHash" = NULL WHERE "email" = ${email} AND "challengeId" = ${challengeId}`
    throw new EmailCodeError(503, 'email_delivery_failed', 'We could not send your code. Please try again shortly or continue with Google.')
  }
  return { challengeId, expiresInSeconds: 600, resendAfterSeconds: 60 }
}

/** Failed attempts commit too. The row lock makes concurrent verification single-use. */
export async function consumeEmailSignInCode(challengeId: unknown, code: unknown, invitationToken?: string): Promise<VerifiedSignInIdentity> {
  if (typeof challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(challengeId) || typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalidCode()
  const context = contextHash(invitationToken)
  const hash = digest(`${challengeId}:${code}`)
  const email = await prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw<CodeRow[]>`SELECT * FROM "EmailSignInCode" WHERE "challengeId" = ${challengeId} FOR UPDATE`
    if (!row || !row.codeHash || row.expiresAt.getTime() <= Date.now() || row.attempts >= 5) return null
    const valid = row.contextHash === context && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(row.codeHash, 'hex'))
    await tx.$executeRaw`UPDATE "EmailSignInCode" SET "attempts" = "attempts" + 1, "codeHash" = ${valid || row.attempts >= 4 ? null : row.codeHash} WHERE "email" = ${row.email}`
    return valid ? row.email : null
  })
  if (!email) throw invalidCode()
  return { email, emailVerified: true, googleId: null, firstName: null, lastName: null, avatar: null }
}
