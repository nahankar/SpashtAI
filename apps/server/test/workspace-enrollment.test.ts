import { describe, it, expect } from 'vitest'
import { enrollmentSettingsSchema, validateEnrollmentResponses } from '../src/workspaces/enrollment'
import { buildInvitationEmail } from '../src/lib/invitations'
import { batchEmailsSchema, runInvitationBatch } from '../src/lib/invitationBatch'
import { WorkspaceError } from '../src/workspaces/contracts'
const fields = [
  { id: 'department', label: 'Department', type: 'dropdown', required: true, options: ['CS', 'ECE'] },
  { id: 'shift', label: 'Shift', type: 'radio', required: true, options: ['AM', 'PM'] },
  { id: 'skills', label: 'Skills', type: 'checkbox', required: true, options: ['Java', 'Python'] },
  { id: 'roll', label: 'Roll number', type: 'text', required: true, options: [] },
  { id: 'welcome', label: 'Welcome', type: 'message', required: false, options: [] },
]
const valid = { department: 'CS', shift: 'AM', skills: ['Java'], roll: ' 123 ' }
describe('workspace enrollment contract', () => {
  it('validates every control and normalizes text without treating messages as answers', () => {
    expect(validateEnrollmentResponses(fields, valid)).toEqual({ ...valid, roll: '123' })
    for (const key of ['department', 'shift', 'skills', 'roll']) { const input = { ...valid }; delete input[key as keyof typeof input]; expect(() => validateEnrollmentResponses(fields, input)).toThrow() }
    for (const input of [{ ...valid, skills: [] }, { ...valid, department: 'Other' }, { ...valid, shift: ['AM'] }, { ...valid, skills: ['Java', 'Java'] }, { ...valid, extra: 'untrusted' }, { ...valid, welcome: 'answer' }]) expect(() => validateEnrollmentResponses(fields, input)).toThrow()
  })
  it('bounds and rejects ambiguous or dangerous definitions, accepts empty settings', () => {
    expect(enrollmentSettingsSchema.parse({})).toEqual({ fields: [], email: { subject: '', message: '' } })
    for (const input of [{ fields: [fields[0], fields[0]] }, { fields: [{ ...fields[0], options: ['CS', 'CS'] }] }, { fields: [{ ...fields[0], id: 'constructor' }] }, { fields: [{ ...fields[4], required: true }] }, { fields: Array(21).fill(fields[0]) }, { email: { subject: 'Hi\r\nBcc: test@example.invalid' } }]) expect(enrollmentSettingsSchema.safeParse(input).success).toBe(false)
  })
  it('uses the custom message as the body and keeps only the accept button and expiry notice', () => {
    const email = buildInvitationEmail({ workspaceName: 'KLS VDIT', acceptUrl: 'https://example.invalid/invite#token=abc', expiresAt: new Date('2026-12-01'), emailSubject: 'Welcome to KLS VDIT', emailMessage: '<script>alert(1)</script>\nPlease join.' })
    expect(email.subject).toBe('Welcome to KLS VDIT')
    expect(email.text).toContain('<script>alert(1)</script>')
    expect(email.text).toContain('Please join.')
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('Please join.')
    expect(email.text).toContain('https://example.invalid/invite#token=abc')
    expect(email.html).toContain('Accept invitation')
    expect(email.text).toContain('This link works once and expires on Tue, 01 Dec 2026 00:00:00 GMT')
    expect(email.text).toContain("If you weren't expecting this invitation, you can ignore this email.")
    expect(email.text).toContain('Replies to this mailbox are not routinely monitored and may not receive a response.')
    expect(email.text).not.toContain('Google Account')
    expect(email.html).not.toContain('Google Account')
    expect(email.text).not.toContain('You have been invited')
  })
  it('normalizes batches and reports partial errors without exposing internal errors', async () => {
    expect(batchEmailsSchema.parse([' A@EXAMPLE.INVALID ', 'b@example.invalid'])).toEqual(['a@example.invalid', 'b@example.invalid'])
    expect(batchEmailsSchema.safeParse(['a@example.invalid', 'A@example.invalid']).success).toBe(false)
    expect(batchEmailsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `${i}@example.invalid`)).success).toBe(false)
    const result = await runInvitationBatch(['ok', 'seat', 'db'], async email => { if (email === 'seat') throw new WorkspaceError(409, 'SEAT_LIMIT', 'No seats'); if (email === 'db') throw new Error('secret connection string'); return 'saved' })
    expect(result.results).toEqual([{ email: 'ok', ok: true, invitation: 'saved' }, { email: 'seat', ok: false, error: 'No seats' }, { email: 'db', ok: false, error: 'Could not create this invitation. Check its status before retrying' }])
  })
})
