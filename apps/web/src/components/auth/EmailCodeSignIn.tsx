import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

export function EmailCodeSignIn({ invitedEmail, invitationToken, onVerify }: {
  invitedEmail?: string
  invitationToken?: string
  onVerify: (challengeId: string, code: string) => Promise<void>
}) {
  const id = useId()
  const [email, setEmail] = useState(invitedEmail || '')
  const [challengeId, setChallengeId] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [resendAt, setResendAt] = useState(0)

  async function requestCode() {
    setBusy(true); setError('')
    try {
      if (Date.now() < resendAt) throw new Error('Please wait one minute before requesting another code.')
      const response = await fetch(`${API}${invitationToken ? '/api/invitations' : '/api/auth'}/email-code/request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invitationToken ? { token: invitationToken } : { email: email.trim() }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message || data.error || 'Could not send your code.')
      setChallengeId(data.challengeId); setCode(''); setSent(true)
      setResendAt(Date.now() + data.resendAfterSeconds * 1000)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not send your code.') }
    finally { setBusy(false) }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!sent) { await requestCode(); return }
    setBusy(true); setError('')
    try { await onVerify(challengeId, code) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not verify your code.') }
    finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={`${id}-email`}>Email address</Label>
        <Input id={`${id}-email`} type="email" autoComplete="email" required value={email} readOnly={Boolean(invitedEmail)} disabled={busy}
          onChange={event => { setEmail(event.target.value); setSent(false); setChallengeId(''); setCode(''); setError('') }} />
      </div>
      {sent && <>
        <p role="status" className="text-sm text-muted-foreground">A six-digit code was sent to {email}. It expires in 10 minutes. Check your spam folder too.</p>
        <div className="space-y-2">
          <Label htmlFor={`${id}-code`}>Sign-in code</Label>
          <Input id={`${id}-code`} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} disabled={busy}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
        </div>
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait…' : sent ? 'Verify code and continue' : 'Email me a sign-in code'}</Button>
      {sent && <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={requestCode}>Send a new code</Button>}
      <p className="text-xs text-muted-foreground">No Google Account or password required.</p>
    </form>
  )
}
