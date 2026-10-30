import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Loader2, MailCheck, TriangleAlert, UserRoundCog } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'
import { formatDate } from '@/lib/invitations'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'
const TOKEN_KEY = 'spashtai_invitation_token'

interface Lookup {
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  recipientName: string | null
  invitedEmail: string
  expiresAt: string
}

type Problem = { kind: 'wrong_account' | 'blocked' | 'error'; message: string }

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
  const [token] = useState(takeToken)
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [loadError, setLoadError] = useState(token ? '' : 'This invitation link is incomplete. Open the link from your invitation email again.')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [accepting, setAccepting] = useState(false)
  const { fetchCurrentUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!token) return
    post<Lookup>('/api/invitations/lookup', { token }).then(({ ok, data }) => {
      if (ok) setLookup(data)
      else setLoadError(data.message || 'This invitation link is not valid.')
    }).catch(() => setLoadError('Could not check this invitation. Please try again.'))
  }, [token])

  async function handleCredential(credential: string) {
    setProblem(null)
    setAccepting(true)
    try {
      const { ok, data } = await post<{ token: string; user: { needsProfileCompletion?: boolean } }>('/api/invitations/accept', { token, credential })
      if (!ok) {
        const kind = data.error === 'wrong_account' ? 'wrong_account' : data.error ? 'blocked' : 'error'
        setProblem({ kind, message: data.message || data.error || 'Could not accept this invitation.' })
        return
      }
      localStorage.setItem('spashtai_token', data.token)
      try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
      await fetchCurrentUser()
      // New accounts finish the normal onboarding (profile details) before using SpashtAI.
      navigate(data.user.needsProfileCompletion ? '/auth/complete-profile' : '/', { replace: true })
    } catch {
      setProblem({ kind: 'error', message: 'Could not reach SpashtAI. Please try again.' })
    } finally {
      setAccepting(false)
    }
  }

  const closed = lookup && (lookup.status === 'expired' || lookup.status === 'revoked')

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center"><LogoWithBeta imgClassName="h-16 w-auto" /></div>
          <CardDescription className="text-base text-foreground font-medium">
            {lookup?.recipientName ? `${lookup.recipientName}, you're invited to SpashtAI` : "You're invited to SpashtAI"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadError && <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</p>}
          {!lookup && !loadError && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

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
                  ? 'This invitation has already been accepted. Sign in with the invited Google Account to continue.'
                  : <>Accept by signing in with the Google Account for <span className="font-medium text-foreground">{lookup.invitedEmail}</span>. The invitation expires on {formatDate(lookup.expiresAt)}.</>}
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

              {accepting ? (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Accepting invitation…</div>
              ) : (
                <GoogleSignInButton label="signin_with" onCredential={handleCredential} onError={(message) => setProblem({ kind: 'error', message })} />
              )}

              <div className="flex gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
                <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  SpashtAI currently requires a Google Account. Gmail, Google Workspace and other addresses registered as a Google Account all
                  work. Sign-in by emailed code or magic link isn&apos;t available yet.
                </p>
              </div>
              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <Link to="/terms" className="text-foreground font-medium hover:underline">Terms and Conditions</Link> and{' '}
                <Link to="/privacy" className="text-foreground font-medium hover:underline">Privacy Policy</Link>.
                New accounts add a few profile details next.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
