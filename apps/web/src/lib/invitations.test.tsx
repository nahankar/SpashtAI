import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider } from '@/hooks/useConfirm'
import { MemoryRouter } from 'react-router-dom'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { Sidebar } from '@/components/admin/Sidebar'
import { deliveryLabel, sendConsequence, type Invitation } from './invitations'
import { sampleInvitationList, sampleInvitations } from './__fixtures__/invitations'

const invitation = (over: Partial<Invitation> = {}): Invitation => ({
  id: 'inv-1', email: 'pat@example.com', recipientName: 'Pat Example', status: 'pending', deliveryStatus: 'SENT', deliveryError: null,
  sendCount: 1, lastSentAt: '2026-10-30T10:00:00Z', expiresAt: '2026-11-06T10:00:00Z', createdAt: '2026-10-30T10:00:00Z',
  acceptedAt: null, revokedAt: null, existingUserAtInvite: false, ...over,
})
const render = (rows: Invitation[]) => renderToStaticMarkup(<ConfirmProvider><InvitationTable invitations={rows} /></ConfirmProvider>)

describe('invitation delivery labels', () => {
  it('never describes a failed, unconfigured or captured send as sent', () => {
    expect(deliveryLabel({ deliveryStatus: 'FAILED', deliveryError: 'send_failed' })).toEqual({ label: 'Delivery failed', tone: 'error' })
    expect(deliveryLabel({ deliveryStatus: 'FAILED', deliveryError: 'smtp_not_configured' }).label).toBe('Not sent: email not configured')
    expect(deliveryLabel({ deliveryStatus: 'DEV_CAPTURED', deliveryError: null }).label).toMatch(/dev only, not sent/)
    // SMTP acceptance is not proof of inbox delivery.
    expect(deliveryLabel({ deliveryStatus: 'SENT', deliveryError: null }).label).toBe('Sent to mail server')
  })
})

describe('invitation table', () => {
  it('keeps a pending invitation pending when its email failed, with resend and revoke available', () => {
    const html = render([invitation({ deliveryStatus: 'FAILED', deliveryError: 'send_failed' })])
    expect(html).toContain('Pending')
    expect(html).toContain('Delivery failed')
    expect(html).toContain('Resend')
    expect(html).toContain('Revoke')
  })

  it('offers no actions on accepted or revoked invitations', () => {
    const html = render([
      invitation({ id: 'a', status: 'accepted', acceptedAt: '2026-10-31T10:00:00Z' }),
      invitation({ id: 'r', status: 'revoked', revokedAt: '2026-10-31T10:00:00Z' }),
    ])
    expect(html).toContain('Accepted')
    expect(html).toContain('Revoked')
    expect(html).not.toContain('Resend')
  })

  it('renders every fixture status, with delivery shown apart from status', () => {
    const html = render(sampleInvitations(Date.parse('2026-11-01T00:00:00Z')))
    for (const label of ['Pending', 'Accepted', 'Expired', 'Revoked', 'Delivery failed', 'Sent to mail server']) expect(html).toContain(label)
  })
})

describe('invitation fixture', () => {
  it('uses reserved addresses and filters like the server list', () => {
    expect(sampleInvitations().every((inv) => inv.email.endsWith('@example.com'))).toBe(true)
    const pending = sampleInvitationList({ status: 'pending' })
    expect(pending.counts).toEqual({ pending: 4, accepted: 6, expired: 2, revoked: 1 })
    expect(pending.items.every((inv) => inv.status === 'pending')).toBe(true)
    expect(sampleInvitationList({ q: 'meera' }).items).toHaveLength(1)
    expect(sampleInvitationList({ page: 2, pageSize: 5 }).items).toHaveLength(5)
  })
})

describe('invite confirmation copy', () => {
  it('says plainly what happens to the email', () => {
    expect(sendConsequence('pat@example.com', { mode: 'smtp', smtpReady: true })).toBe('This sends a real invitation email to pat@example.com.')
    expect(sendConsequence('pat@example.com', { mode: 'dev_capture', smtpReady: false })).toMatch(/captured locally and not sent/)
    expect(sendConsequence('pat@example.com', { mode: 'smtp', smtpReady: false })).toMatch(/email is not configured/)
  })
})

describe('Admin navigation', () => {
  it('lists Invitations with the full platform navigation and no demo toggle', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/admin']}><Sidebar /></MemoryRouter>)
    for (const label of ['Dashboard', 'Users', 'Invitations', 'Feedback', 'Health', 'Pricing', 'Legal']) expect(html).toContain(label)
    expect(html).not.toMatch(/Tenant Admin|role="switch"/)
  })
})
