import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider } from '@/hooks/useConfirm'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { deliveryLabel, type Invitation } from './invitations'

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

  it('offers no actions on accepted invitations or on sample rows', () => {
    const html = render([
      invitation({ id: 'a', status: 'accepted', acceptedAt: '2026-10-31T10:00:00Z' }),
      invitation({ id: 's', sample: true }),
    ])
    expect(html).toContain('Accepted')
    expect(html).toContain('Sample row')
    expect(html).not.toContain('Resend')
  })
})
