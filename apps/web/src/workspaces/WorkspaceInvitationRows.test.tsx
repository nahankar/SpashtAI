import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkspaceInvitationRows } from './WorkspaceInvitationRows'
import { applyInvitationActions, canActOnInvitation, selectedInvitations, type WorkspaceInvitationRow } from './invitationActions'
const row = (id: string, status: WorkspaceInvitationRow['status'] = 'pending', role: WorkspaceInvitationRow['role'] = 'LEARNER'): WorkspaceInvitationRow => ({
  id, email: `${id}@example.invalid`, recipientName: 'Asha Rao', status, role, expiresAt: new Date(Date.now() + 86400000).toISOString(), deliveryStatus: 'SENT', deliveryError: null, sendCount: 1, lastSentAt: null, createdAt: '', acceptedAt: null, revokedAt: null, existingUserAtInvite: false,
})
const html = (rows: WorkspaceInvitationRow[], role: WorkspaceInvitationRow['role'] = 'OWNER', selected = new Set<string>()) => renderToStaticMarkup(<WorkspaceInvitationRows rows={rows} role={role} selected={selected} busy={false} onSelect={() => {}} onSelectAll={() => {}} onAction={() => {}} />)
describe('workspace invitation actions', () => {
  it('keeps Resend and hides Revoke for expired links, including pending rows past expiry', () => {
    const expired = row('expired', 'expired'), elapsed = { ...row('elapsed'), expiresAt: new Date(0).toISOString() }
    for (const r of [expired, elapsed]) { expect(html([r])).toContain('>Resend</button>'); expect(html([r])).not.toContain('>Revoke</button>'); expect(canActOnInvitation(r, 'OWNER', 'revoke')).toBe(false) }
    expect(html([row('pending')])).toContain('>Revoke</button>')
  })
  it('limits selection and both actions to manageable active/expired invitations', () => {
    const items = [row('pending'), row('expired', 'expired'), row('accepted', 'accepted'), row('revoked', 'revoked'), row('owner', 'pending', 'OWNER')]
    const selected = new Set(items.map(i => i.id))
    expect(selectedInvitations(items, selected, 'ADMIN', 'resend').map(i => i.id)).toEqual(['pending', 'expired'])
    expect(selectedInvitations(items, selected, 'ADMIN', 'revoke').map(i => i.id)).toEqual(['pending'])
    expect(selectedInvitations(items, selected, 'LEARNER', 'resend')).toEqual([])
    expect(html([items[4]], 'ADMIN')).not.toContain('>Revoke</button>')
    expect(html(items)).toContain('Select all actionable invitations on this page')
    expect(html(items, 'OWNER', new Set(['pending']))).toContain('aria-checked="mixed"')
    expect(html([row('named')])).toContain('Asha Rao')
  })
  it('reports per-row success and failure without retrying sends or stopping at a failed row', async () => {
    const send = vi.fn().mockResolvedValueOnce(row('one')).mockRejectedValueOnce(new Error('Hourly email limit reached')).mockResolvedValueOnce({ ...row('three'), deliveryStatus: 'FAILED' })
    const result = await applyInvitationActions([row('one'), row('two'), row('three')], 'resend', send)
    expect(send.mock.calls).toEqual([['one', 'resend'], ['two', 'resend'], ['three', 'resend']])
    expect(result).toMatchObject([{ id: 'one', ok: true, deliveryStatus: 'SENT' }, { id: 'two', ok: false, error: 'Hourly email limit reached' }, { id: 'three', ok: true, deliveryStatus: 'FAILED' }])
  })
})
