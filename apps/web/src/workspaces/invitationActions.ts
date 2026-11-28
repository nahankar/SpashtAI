import type { Invitation } from '@/lib/invitations'
import type { Membership } from './client'

export type WorkspaceInvitationRow = Invitation & { role: Membership['role'] }
export type InvitationAction = 'resend' | 'revoke'
export function canActOnInvitation(inv: WorkspaceInvitationRow, role: Membership['role'], action: InvitationAction) {
  if (role !== 'OWNER' && !(role === 'ADMIN' && inv.role === 'LEARNER')) return false
  // Also account for a link expiring while the table stays open.
  const pending = inv.status === 'pending' && Date.parse(inv.expiresAt) > Date.now()
  return action === 'revoke' ? pending : pending || inv.status === 'expired' || inv.status === 'pending'
}
export function selectedInvitations(rows: WorkspaceInvitationRow[], selected: Set<string>, role: Membership['role'], action: InvitationAction) {
  return rows.filter(inv => selected.has(inv.id) && canActOnInvitation(inv, role, action))
}
export async function applyInvitationActions(rows: WorkspaceInvitationRow[], action: InvitationAction, send: (id: string, action: InvitationAction) => Promise<WorkspaceInvitationRow>) {
  const results: { id: string; email: string; ok: boolean; deliveryStatus?: Invitation['deliveryStatus']; error?: string }[] = []
  // Existing endpoints recheck role, expiry and the shared email limit for each row.
  for (const row of rows) {
    try { const result = await send(row.id, action); results.push({ id: row.id, email: row.email, ok: true, deliveryStatus: result.deliveryStatus }) }
    catch (e) { results.push({ id: row.id, email: row.email, ok: false, error: e instanceof Error ? e.message : 'Action failed' }) }
  }
  return results
}
