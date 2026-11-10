import { EnrollmentFields, type EnrollmentField, type EnrollmentResponses } from '@/workspaces/EnrollmentForm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MailCheck, TriangleAlert, UserRoundCog } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { EmailCodeSignIn } from '@/components/auth/EmailCodeSignIn'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { ProfileDetailsRow, type ProfileGender } from '@/components/auth/ProfileDetailsRow'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'
import { formatDate } from '@/lib/invitations'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
const TOKEN_KEY = 'spashtai_invitation_token'

interface Lookup {
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  recipientName: string | null
  invitedEmail: string
  workspaceInvitation?: boolean
  workspace?: { name: string; slug: string; logoDataUrl: string | null; accentColor: string } | null
  proposedRole?: string
  enrollmentFields?: EnrollmentField[]
  expiresAt: string
}

type Problem = { kind: 'wrong_account' | 'blocked' | 'error'; message: string }
type Step = 'workspace' | 'profile'

/** Reads the token from the link fragment (never sent to servers), then forgets it from the address bar. */
function takeToken(): string {
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
  if (fromHash) {
    try { sessionStorage.setItem(TOKEN_KEY, fromHash) } catch { /* private mode */ }
    window.history.replaceState(null, '', window.location.pathname)
    return fromHash
  }
  try { return sessionStorage.getItem(TOKEN_KEY) ?? '' } catch { return '' }
}

async function post<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T & { error?: string; message?: string } }> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }
}

export function AcceptInvitation() {
  const navigate = useNavigate()
  const [token] = useState(takeToken)
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [loadError, setLoadError] = useState(token ? '' : 'This invitation link is incomplete. Open the link from your invitation email again.')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [accepting, setAccepting] = useState(false)
  const [responses, setResponses] = useState<EnrollmentResponses>({})
  const [step, setStep] = useState<Step>('workspace')
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<ProfileGender>('')
  const [pincode, setPincode] = useState('')
  const { fetchCurrentUser } = useAuth()

  useEffect(() => {
    if (!token) return
    post<Lookup>('/api/invitations/lookup', { token }).then(({ ok, data }) => {
      if (ok) {
        setLookup(data)
        if (data.workspace) {
          const canonical = `/w/${encodeURIComponent(data.workspace.slug)}/invite`
          if (window.location.pathname !== canonical) navigate(canonical, { replace: true })
        }
        if (!data.enrollmentFields?.length) setStep('profile')
      } else setLoadError(data.message || 'This invitation link is not valid.')
    }).catch(() => setLoadError('Could not check this invitation. Please try again.'))
  }, [token, navigate])

  async function handleIdentity(identity: { credential: string } | { challengeId: string; code: string } | Record<string, never>) {
    setProblem(null)
    setAccepting(true)
    try {
      const { ok, data } = await post<{ token: string; user: { needsProfileCompletion?: boolean }; workspacePath?: string }>('/api/invitations/accept', {
        token,
        ...identity,
        enrollmentResponses: responses,
        phone,
        dateOfBirth,
        gender,
        pincode,
      })
      if (!ok) {
        const kind = data.error === 'wrong_account' ? 'wrong_account' : data.error ? 'blocked' : 'error'
        setProblem({ kind, message: data.message || data.error || 'Could not accept this invitation.' })
        return
      }
      localStorage.setItem('spashtai_token', data.token)
      try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
      await fetchCurrentUser()
      const next = data.workspacePath?.startsWith('/w/') ? data.workspacePath : '/'
      window.location.assign(data.user.needsProfileCompletion ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : next)
    } catch {
      setProblem({ kind: 'error', message: 'Could not reach SpashtAI. Please try again.' })
    } finally {
      setAccepting(false)
    }
  }

  const closed = lookup && (lookup.status === 'expired' || lookup.status === 'revoked')
  const hasWorkspaceFields = !!lookup?.enrollmentFields?.length
  const profileReady = Boolean(phone && dateOfBirth && gender && pincode)

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md" style={lookup?.workspace ? { borderTop: `4px solid ${lookup.workspace.accentColor}` } : undefined}>
        <CardHeader className="text-center space-y-3">
          {lookup?.workspace ? <div className="space-y-2">
            {lookup.workspace.logoDataUrl && <img src={lookup.workspace.logoDataUrl} alt="" className="mx-auto h-16 w-16 object-contain" />}
            <h1 className="text-xl font-semibold">{lookup.workspace.name}</h1>
            <p className="text-xs text-muted-foreground">on SpashtAI</p>
          </div> : <div className="flex justify-center"><LogoWithBeta imgClassName="h-16 w-auto" /></div>}
          <CardDescription className="text-base text-foreground font-medium">
            {lookup?.recipientName ? `${lookup.recipientName}, you're invited to ${lookup.workspace?.name || 'SpashtAI'}` : `You're invited to ${lookup?.workspace?.name || 'SpashtAI'}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>}
          {!lookup && !loadError && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

          {lookup?.workspaceInvitation && <p className="text-sm">This invitation grants {lookup.proposedRole?.toLowerCase()} access to {lookup.workspace?.name || 'an organization workspace'}. Accepting makes this email organization-only. Any previous Personal history is preserved but unavailable. Use a different email for Personal access.</p>}
          {closed && (
            <p className="rounded-md bg-muted p-3 text-sm">
              {lookup.status === 'revoked'
                ? 'This invitation was withdrawn. Ask your administrator for a new one.'
                : 'This invitation has expired. Ask your administrator to resend it.'}
            </p>
          )}

          {lookup && !closed && (
            <>
              <p className="text-sm text-muted-foreground">
                {lookup.status === 'accepted'
                  ? 'This invitation has already been accepted. Sign in with the invited email address to continue.'
                  : <>Complete every required detail, then accept this invitation for <span className="font-medium text-foreground">{lookup.invitedEmail}</span>. The invitation expires on {formatDate(lookup.expiresAt)}.</>}
              </p>

              {problem?.kind === 'wrong_account' && (
                <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="flex items-center gap-2 font-medium"><UserRoundCog className="h-4 w-4" /> Switch Google account</p>
                  <p>{problem.message}</p>
                  <p>Choose that account in the Google prompt, or add it there with “Use another account”.</p>
                </div>
              )}
              {problem && problem.kind !== 'wrong_account' && (
                <p className="flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />{problem.message}</p>
              )}

              {lookup.status !== 'accepted' && hasWorkspaceFields && step === 'workspace' && (
                <form className="space-y-3" onSubmit={e => { e.preventDefault(); setStep('profile') }}>
                  <h2 className="font-semibold">1. Workspace details</h2>
                  <p className="text-sm">Shared with this workspace’s administrators. Your regular profile details come next.</p>
                  <EnrollmentFields fields={lookup.enrollmentFields ?? []} values={responses} onChange={setResponses} />
                  <Button type="submit" disabled={accepting}>Continue</Button>
                </form>
              )}

              {lookup.status !== 'accepted' && step === 'profile' && (
                <form className="space-y-3" onSubmit={e => { e.preventDefault() }}>
                  <h2 className="font-semibold">{hasWorkspaceFields ? '2. Almost there' : 'Almost there'}</h2>
                  <p className="text-sm">Add these details to finish. Opening this page does not create an account.</p>
                  {hasWorkspaceFields && <Button type="button" variant="ghost" className="h-auto p-0 text-sm" onClick={() => setStep('workspace')}>Back to workspace details</Button>}
                  <div className="space-y-2">
                    <Label htmlFor="invite-phone">Phone number</Label>
                    <Input id="invite-phone" type="tel" inputMode="tel" placeholder="10-digit mobile number" value={phone} onChange={e => setPhone(e.target.value)} required autoComplete="tel" />
                  </div>
                  <ProfileDetailsRow dateOfBirth={dateOfBirth} onDateOfBirthChange={setDateOfBirth} gender={gender} onGenderChange={setGender} pincode={pincode} onPincodeChange={setPincode} />
                </form>
              )}

              {accepting && <p role="status" className="text-sm text-muted-foreground">Accepting invitation…</p>}
              {lookup.status === 'accepted' || (step === 'profile' && profileReady) ? (
                <>
                  {lookup.status === 'pending' ? <>
                    <Button className="w-full" disabled={accepting} onClick={() => handleIdentity({})}>Accept invitation and continue</Button>
                    <p className="text-xs text-muted-foreground">Your invitation link verifies {lookup.invitedEmail}. No additional code or Google sign-in is needed to join. For future sign-ins, use an emailed code or Google with this address.</p>
                  </> : <>
                    <GoogleSignInButton label="signin_with" onCredential={credential => handleIdentity({ credential })} onError={(message) => setProblem({ kind: 'error', message })} />
                    <p className="text-center text-xs text-muted-foreground">Or sign in with email</p>
                    <EmailCodeSignIn invitedEmail={lookup.invitedEmail} invitationToken={token} onVerify={(challengeId, code) => handleIdentity({ challengeId, code })} />
                  </>}
                </>
              ) : step === 'profile' ? (
                <p className="text-sm">Complete the details above to accept this invitation.</p>
              ) : null}

              <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  This invitation is for {lookup.invitedEmail}. Accepting the invitation signs you in with this email address.
                </p>
              </div>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <Link to="/terms" className="text-foreground font-medium hover:underline">Terms and Conditions</Link> and{' '}
                <Link to="/privacy" className="text-foreground font-medium hover:underline">Privacy Policy</Link>.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
