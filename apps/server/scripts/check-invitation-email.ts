/**
 * Invitation email configuration check. Never prints a value: only variable names and pass/fail.
 *
 * Usage (run from apps/server with the target env loaded, e.g. on EC2):
 *   npx tsx scripts/check-invitation-email.ts                      # names + SMTP connection check, sends nothing
 *   npx tsx scripts/check-invitation-email.ts --send-test <email>  # also sends ONE test message to <email>
 *
 * The connection check opens an authenticated SMTP session (nodemailer `verify`) and sends no mail.
 * `--send-test` sends a plain test message (no invitation, no token) and only to the address given.
 */
import 'dotenv/config'
import nodemailer from 'nodemailer'
import { invitationEmailConfig } from '../src/lib/invitations'

async function main() {
  const config = invitationEmailConfig()
  const names = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'FRONTEND_URL', 'NODE_ENV', 'INVITATION_EMAIL_DELIVERY', 'INVITATION_EXPIRY_DAYS', 'INVITATION_RETENTION_DAYS']
  for (const name of names) console.log(`${name.padEnd(26)} ${process.env[name]?.trim() ? 'set' : 'not set'}`)
  console.log(`\ndelivery mode: ${config.mode}${config.captureRefused ? ' (capture requested but refused in production)' : ''}`)
  console.log(`required missing: ${config.missing.length ? config.missing.join(', ') : 'none'}`)
  if (!config.smtpReady) {
    process.exitCode = 1
    return
  }

  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10)
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST!.trim(),
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER!.trim(), pass: process.env.SMTP_PASS!.trim() },
  })
  try {
    await transport.verify()
    console.log('SMTP connection and login: ok (no mail sent)')
  } catch (err) {
    // Code only: server responses can echo account details.
    const code = (err as { code?: string; responseCode?: number })
    console.log(`SMTP connection and login: FAILED (${code.code ?? 'error'}${code.responseCode ? ` ${code.responseCode}` : ''})`)
    process.exitCode = 1
    return
  }

  const flag = process.argv.indexOf('--send-test')
  if (flag === -1) return
  const to = process.argv[flag + 1]?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.log('--send-test needs one recipient address')
    process.exitCode = 1
    return
  }
  const info = await transport.sendMail({
    from: process.env.SMTP_FROM?.trim() || 'noreply@spashtai.com',
    to,
    subject: 'SpashtAI invitation email test',
    text: 'This is a one-off configuration test from SpashtAI. It is not an invitation and needs no action.',
  })
  console.log(`test message accepted by the mail server: ${info.accepted.length === 1 ? 'yes' : 'no'}`)
}

main().catch((err) => {
  console.error(`check failed: ${err instanceof Error ? err.name : 'error'}`)
  process.exitCode = 1
})
