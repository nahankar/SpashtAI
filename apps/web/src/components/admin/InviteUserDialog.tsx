import { useState } from 'react'
import { Loader2, MailPlus } from 'lucide-react'
import { toast } from 'sonner'
import { ApiError } from '@/lib/api-client'
import { createInvitation, deliveryLabel, type Invitation } from '@/lib/invitations'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type Step = 'form' | 'confirm' | 'existing' | 'done'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Invites one learner to SpashtAI through the server invitation service, acting as the signed-in Admin. */
export function InviteUserDialog({
  open,
  onOpenChange,
  onSent,
  demo = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent?: (invitation: Invitation) => void
  /** Tenant Admin demo: the action is real and runs as the signed-in platform Admin. */
  demo?: boolean
}) {
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ invitation: Invitation; notice: string } | null>(null)

  const reset = () => {
    setStep('form'); setEmail(''); setName(''); setError(''); setBusy(false); setResult(null)
  }
  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  async function send(confirmExistingUser = false) {
    setBusy(true)
    setError('')
    try {
      const res = await createInvitation({ email: email.trim(), name: name.trim() || undefined, confirmExistingUser })
      setResult(res)
      setStep('done')
      onSent?.(res.invitation)
      const delivery = deliveryLabel(res.invitation)
      if (delivery.tone === 'error') toast.error(`Invitation saved, email not sent: ${delivery.label}`)
      else toast.success(`Invitation created: ${delivery.label}`)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'existing_user') {
        setStep('existing')
      } else {
        setError(err instanceof Error ? err.message : 'Could not create the invitation')
        setStep('form')
      }
    } finally {
      setBusy(false)
    }
  }

  const recipient = name.trim() ? `${name.trim()} <${email.trim()}>` : email.trim()

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MailPlus className="h-5 w-5 text-primary" /> Invite user to SpashtAI</DialogTitle>
          <DialogDescription>
            Invites one person to SpashtAI as a learner. It grants no admin access and assigns no organization.
          </DialogDescription>
        </DialogHeader>

        {demo && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            Tenant Admin demo: this sends a real platform invitation from your Admin account. It is not tenant-scoped.
          </p>
        )}

        {step === 'form' && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!EMAIL_RE.test(email.trim())) {
                setError('Enter a valid email address.')
                return
              }
              setError('')
              setStep('confirm')
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Name (optional)</Label>
              <Input id="invite-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Recipient's name" />
            </div>
            <p className="text-xs text-muted-foreground">
              The recipient signs in with Google using this address, so it must be a Google Account (Gmail, Google Workspace, or
              another address registered with Google). Email code and magic-link sign-in are not available yet.
            </p>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit">Review invitation</Button>
            </DialogFooter>
          </form>
        )}

        {step === 'confirm' && (
          <div className="space-y-4">
            <p className="text-sm">
              Send a SpashtAI invitation to <span className="font-medium break-all">{recipient}</span>? The link works once and expires
              after the configured period (7 days by default).
            </p>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => setStep('form')}>Back</Button>
              <Button disabled={busy} onClick={() => send(false)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send invitation
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'existing' && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-medium break-all">{email.trim()}</span> already has a SpashtAI account. Accepting will only sign them in;
              their data, role and permissions stay the same. Send anyway?
            </p>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
              <Button disabled={busy} onClick={() => send(true)}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send to existing account
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-4">
            <p className="text-sm">
              Invitation for <span className="font-medium break-all">{result.invitation.email}</span> is pending.
            </p>
            <p className={deliveryLabel(result.invitation).tone === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {result.notice}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={reset}>Invite another</Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
