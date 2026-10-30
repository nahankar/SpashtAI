import { useState } from 'react'
import { Loader2, RotateCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  STATUS_LABEL,
  deliveryLabel,
  formatDate,
  resendInvitation,
  revokeInvitation,
  type Invitation,
} from '@/lib/invitations'

const STATUS_VARIANT = { pending: 'outline', accepted: 'success', expired: 'secondary', revoked: 'secondary' } as const
const TONE_CLASS = {
  ok: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-destructive',
  muted: 'text-muted-foreground',
}

export function DeliveryStatus({ invitation }: { invitation: Pick<Invitation, 'deliveryStatus' | 'deliveryError'> }) {
  const d = deliveryLabel(invitation)
  return <span className={cn('text-xs font-medium', TONE_CLASS[d.tone])}>{d.label}</span>
}

/** Invitation rows with Resend/Revoke. Sample rows (Tenant Admin demo) are read-only. */
export function InvitationTable({
  invitations,
  onChanged,
  showStatus = true,
}: {
  invitations: Invitation[]
  onChanged?: () => void
  showStatus?: boolean
}) {
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function act(inv: Invitation, action: 'resend' | 'revoke') {
    const ok = await confirm(action === 'resend'
      ? { title: 'Resend invitation?', description: `Send a new link to ${inv.email}. The previous link stops working and the expiry restarts.`, confirmLabel: 'Resend' }
      : { title: 'Revoke invitation?', description: `The link sent to ${inv.email} will stop working. This does not affect any existing account.`, confirmLabel: 'Revoke', variant: 'destructive' })
    if (!ok) return
    setBusyId(inv.id)
    try {
      if (action === 'resend') {
        const res = await resendInvitation(inv.id)
        const d = deliveryLabel(res.invitation)
        if (d.tone === 'error') toast.error(`Link renewed, email not sent: ${d.label}`)
        else toast.success(`Invitation resent: ${d.label}`)
      } else {
        await revokeInvitation(inv.id)
        toast.success('Invitation revoked')
      }
      onChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">Recipient</th>
            {showStatus && <th className="px-4 py-3 text-left font-medium">Status</th>}
            <th className="px-4 py-3 text-left font-medium">Invited</th>
            <th className="px-4 py-3 text-left font-medium">Expires</th>
            <th className="px-4 py-3 text-left font-medium">Delivery</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invitations.map((inv) => {
            const canResend = !inv.sample && (inv.status === 'pending' || inv.status === 'expired')
            const canRevoke = canResend
            return (
              <tr key={inv.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium">{inv.recipientName || inv.email}</div>
                  {inv.recipientName && <div className="text-xs text-muted-foreground break-all">{inv.email}</div>}
                  {inv.existingUserAtInvite && <div className="text-xs text-muted-foreground">Existing account</div>}
                </td>
                {showStatus && (
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANT[inv.status]}>{STATUS_LABEL[inv.status]}</Badge>
                  </td>
                )}
                <td className="px-4 py-3 text-muted-foreground">{formatDate(inv.createdAt)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {inv.status === 'accepted' ? `Accepted ${formatDate(inv.acceptedAt)}` : formatDate(inv.expiresAt)}
                </td>
                <td className="px-4 py-3"><DeliveryStatus invitation={inv} /></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {inv.sample ? (
                    <span className="text-xs text-muted-foreground">Sample row</span>
                  ) : canResend ? (
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" disabled={busyId === inv.id} onClick={() => act(inv, 'resend')}>
                        {busyId === inv.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                        <span className="ml-1.5">Resend</span>
                      </Button>
                      {canRevoke && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={busyId === inv.id} onClick={() => act(inv, 'revoke')}>
                          <XCircle className="h-4 w-4" />
                          <span className="ml-1.5">Revoke</span>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
