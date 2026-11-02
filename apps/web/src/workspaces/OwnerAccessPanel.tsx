import { useState } from 'react'
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
export interface WorkspaceOwner { id: string; email: string; state: 'INVITED' | 'ACTIVE' | 'SUSPENDED' }
export function OwnerAccessPanel({ name, slug, owners, disabled, onSend }: { name: string; slug: string; owners: WorkspaceOwner[]; disabled: boolean; onSend: (membershipId: string) => Promise<{ deliveryStatus: string }> }) {
  const [confirm, setConfirm] = useState<WorkspaceOwner | null>(null)
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [sending, setSending] = useState(false)
  const origin = typeof window === 'undefined' ? 'https://spasht.ai' : window.location.origin
  const url = `${origin}/w/${encodeURIComponent(slug)}`
  function instructions(owner: WorkspaceOwner) {
    return `Your ${name} workspace\nLogin email: ${owner.email}\nWorkspace: ${url}\nSign in with the Google Account for this email. There is no separate workspace password. If shown, select Accept invitation. As Owner you can invite learners and workspace administrators and manage this workspace. Personal history stays separate. Workspace analytics are available to Owners and Admins; practice products appear as they become available for your organization.`
  }
  async function send() {
    if (!confirm) return
    setSending(true); setError(''); setNotice('')
    try {
      const result = await onSend(confirm.id)
      setNotice(result.deliveryStatus === 'SENT' ? 'Access email accepted by the mail server for delivery.' : result.deliveryStatus === 'PREVIEW_ONLY' ? 'Development mode: no email sent. Copy the access instructions in this panel.' : 'Email was not sent. Access remains assigned; share the link manually or ask the platform administrator to check email settings.')
      setConfirm(null)
    } catch { setError('Could not confirm delivery. Check with the recipient before sending again.') }
    finally { setSending(false) }
  }
  return <section className="rounded-lg border p-5 space-y-4" aria-label="Workspace Owner access">
    <h2 className="text-xl font-semibold">Workspace Owner access</h2>
    <p>Share the workspace link with the assigned Owner. They use their own Google Account, accept the pending membership, then manage invitations at this workspace address. The platform Admin panel is separate.</p>
    <p className="break-all"><strong>Workspace login link:</strong> {url}</p>
    <p>Creating a workspace does not send an email automatically. Sending access instructions does not change anyone’s role or permissions.</p>
    {owners.length === 0 && <p>No Owner is assigned. Contact the platform administrator.</p>}
    {owners.map(owner => <div key={owner.id} className="rounded border p-4 space-y-3"><p className="break-all"><strong>{owner.email}</strong> · Owner · {owner.state === 'INVITED' ? 'Pending acceptance' : owner.state === 'ACTIVE' ? 'Active' : 'Suspended'}</p>
      <pre className="whitespace-pre-wrap break-words text-sm">{instructions(owner)}</pre>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={disabled || sending} onClick={async () => { setError(''); try { await navigator.clipboard.writeText(instructions(owner)); setNotice('Access instructions copied.') } catch { setError('Copy is unavailable. Select and copy the instructions above.') } }}>Copy access instructions</Button>
      <Button type="button" disabled={disabled || sending || owner.state === 'SUSPENDED'} onClick={() => { setConfirm(owner); setError(''); setNotice('') }}>Send access email</Button></div>
    </div>)}
    <AlertDialog open={Boolean(confirm)} onOpenChange={open => { if (!open && !sending) setConfirm(null) }}>
      <AlertDialogContent>{confirm && <><AlertDialogHeader><AlertDialogTitle>Confirm Owner access email</AlertDialogTitle>
        <AlertDialogDescription>Send access instructions for {name} to <strong>{confirm.email}</strong>? Production sends a real email. Development mode sends nothing.</AlertDialogDescription></AlertDialogHeader>
        <p className="text-sm">This link requires their existing membership and Google sign-in. It is not a password or a public access grant.</p>
        <AlertDialogFooter><AlertDialogCancel disabled={sending}>Cancel</AlertDialogCancel><Button disabled={sending || disabled} onClick={send}>{sending ? 'Sending…' : 'Confirm and send access email'}</Button></AlertDialogFooter></>}
      </AlertDialogContent>
    </AlertDialog>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="text-red-700">{error}</p>}
  </section>
}
