import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Membership } from './client'
import { canActOnInvitation, type InvitationAction, type WorkspaceInvitationRow } from './invitationActions'
export const INVITATION_DELIVERY_LABELS: Record<string, string> = { DEV_CAPTURED: 'Captured locally', SENT: 'Sent to mail server', FAILED: 'Not sent', SENDING: 'Sending / outcome pending' }

export function WorkspaceInvitationRows({ rows, role, busy, selected, onSelect, onSelectAll, onAction }: {
  rows: WorkspaceInvitationRow[]; role: Membership['role']; busy: boolean; selected: Set<string>;
  onSelect: (id: string, checked: boolean) => void; onSelectAll: (checked: boolean) => void;
  onAction: (action: InvitationAction, rows: WorkspaceInvitationRow[]) => void;
}) {
  const selectable = rows.filter(inv => canActOnInvitation(inv, role, 'resend'))
  const all = selectable.length > 0 && selectable.every(inv => selected.has(inv.id))
  const some = selectable.some(inv => selected.has(inv.id))
  return <Table>
    <TableHeader><TableRow>
      <TableHead className="w-12"><input type="checkbox" className="h-4 w-4 accent-primary" aria-label="Select all actionable invitations on this page" aria-checked={some && !all ? 'mixed' : all}
        ref={el => { if (el) el.indeterminate = some && !all }} checked={all} disabled={busy || !selectable.length} onChange={e => onSelectAll(e.target.checked)} /></TableHead>
      <TableHead>Name / Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Email delivery</TableHead><TableHead>Actions</TableHead>
    </TableRow></TableHeader>
    <TableBody>{rows.map(inv => <TableRow key={inv.id}>
      <TableCell><input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`Select ${inv.email}`} checked={selected.has(inv.id)} disabled={busy || !canActOnInvitation(inv, role, 'resend')} onChange={e => onSelect(inv.id, e.target.checked)} /></TableCell>
      <TableCell className="break-all">{inv.recipientName && <div className="font-medium">{inv.recipientName}</div>}{inv.email}</TableCell><TableCell>{inv.role}</TableCell>
      <TableCell><Badge variant="outline" className="capitalize">{inv.status}</Badge></TableCell><TableCell>{INVITATION_DELIVERY_LABELS[inv.deliveryStatus]}</TableCell>
      <TableCell className="space-x-2">{canActOnInvitation(inv, role, 'resend') && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('resend', [inv])}>Resend</Button>}
        {canActOnInvitation(inv, role, 'revoke') && <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction('revoke', [inv])}>Revoke</Button>}</TableCell>
    </TableRow>)}</TableBody>
  </Table>
}
