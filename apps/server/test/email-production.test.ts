import { afterEach, describe, expect, it, vi } from 'vitest'
const mail = vi.hoisted(() => ({ createTransport: vi.fn(), sendMail: vi.fn() }))
vi.mock('nodemailer', () => ({ createTransport: mail.createTransport }))
import { sendEmail, buildPasswordResetEmail } from '../src/lib/email'
const original = { ...process.env }
afterEach(() => { process.env = { ...original }; vi.restoreAllMocks(); vi.resetAllMocks() })
describe('production transactional email safeguards', () => {
  it('requires STARTTLS and bounded timeouts, and uses the approved sender', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'info@spasht.ai', SMTP_PASS: 'fixture-password', SMTP_PORT: '587' }); delete process.env.SMTP_FROM
    mail.sendMail.mockResolvedValue({}); mail.createTransport.mockReturnValue({ sendMail: mail.sendMail })
    expect(await sendEmail({ to: 'fixture@example.invalid', subject: 'Test', text: 'Body' })).toEqual({ sent: true })
    expect(mail.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 }))
    expect(mail.sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'info@spasht.ai' }))
  })
  it('never logs a reset secret in production when SMTP is missing, even with logBody requested', async () => {
    process.env.NODE_ENV = 'production'; delete process.env.SMTP_HOST; delete process.env.SMTP_PASS; delete process.env.SMTP_USER
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendEmail({ to: 'fixture@example.invalid', subject: 'Reset', text: 'SECRET_RESET_LINK', logBody: true })
    expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET_RESET_LINK')
  })
  it('redacts SMTP failure details instead of logging provider replies or reset content', async () => {
    Object.assign(process.env, { NODE_ENV: 'production', SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'info@spasht.ai', SMTP_PASS: 'fixture-password', SMTP_PORT: '465' })
    mail.createTransport.mockReturnValue({ sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('SECRET_PROVIDER_REPLY'), { code: 'EAUTH' })) })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {}), error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sendEmail({ to: 'fixture@example.invalid', subject: 'Reset', text: 'SECRET_RESET_LINK', logBody: true })).toEqual({ sent: false, reason: 'send_failed' })
    expect(JSON.stringify([log.mock.calls,error.mock.calls])).not.toMatch(/SECRET_PROVIDER_REPLY|SECRET_RESET_LINK|fixture-password/)
    expect(buildPasswordResetEmail('https://example.invalid/reset').text).toContain('not routinely monitored')
  })
})
