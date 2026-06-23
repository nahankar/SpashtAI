/**
 * Sends transactional email. Configure SMTP_* env vars for production delivery.
 * Falls back to console logging when SMTP is not configured.
 */
export async function sendEmail(opts: {
  to: string
  subject: string
  text: string
  html?: string
}): Promise<{ sent: boolean; reason?: string }> {
  const host = process.env.SMTP_HOST?.trim()
  const port = parseInt(process.env.SMTP_PORT || '587', 10)
  const user = process.env.SMTP_USER?.trim()
  const pass = process.env.SMTP_PASS?.trim()
  const from = process.env.SMTP_FROM?.trim() || 'noreply@spashtai.com'

  if (!host || !user || !pass) {
    console.log('📧 Email (SMTP not configured — console only)')
    console.log(`   To: ${opts.to}`)
    console.log(`   Subject: ${opts.subject}`)
    console.log(`   Body:\n${opts.text}`)
    return { sent: false, reason: 'smtp_not_configured' }
  }

  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    })

    await transport.sendMail({
      from,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html || opts.text.replace(/\n/g, '<br>'),
    })

    return { sent: true }
  } catch (err) {
    console.error('Email send failed:', err)
    console.log(`   Fallback — reset link text:\n${opts.text}`)
    return { sent: false, reason: 'send_failed' }
  }
}

export function buildPasswordResetEmail(resetUrl: string): { subject: string; text: string } {
  return {
    subject: 'Reset your SpashtAI password',
    text: [
      'You requested a password reset for your SpashtAI account.',
      '',
      `Click the link below to set a new password (valid for 1 hour):`,
      resetUrl,
      '',
      'If you did not request this, you can safely ignore this email.',
      '',
      '— SpashtAI',
    ].join('\n'),
  }
}
