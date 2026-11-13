import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '@/lib/api-client'
import { clearPendingGoogleSignup, pendingGoogleSignupCredential } from '@/lib/pending-google-signup'
import { useAuth } from '@/hooks/useAuth'
import { accountDestination } from '@/lib/account-access'
import { safeAppPath } from '@/lib/safe-next-path'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSignInPolicy, workspaceSlugFromNext } from '@/components/auth/useSignInPolicy'
import { EmailCodeSignIn } from '@/components/auth/EmailCodeSignIn'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { ProfileDetailsRow, type ProfileGender } from '@/components/auth/ProfileDetailsRow'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'

export function Register() {
  const [error, setError] = useState('')
  const [signupsPaused, setSignupsPaused] = useState(false)
  const [pausedMessage, setPausedMessage] = useState('')
  const [checkingPlatform, setCheckingPlatform] = useState(true)
  const [detailsReady, setDetailsReady] = useState(false)
  const [googlePending, setGooglePending] = useState(() => Boolean(pendingGoogleSignupCredential()))
  const [emailSignup, setEmailSignup] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<ProfileGender>('')
  const [pincode, setPincode] = useState('')
  const { loginWithGoogle, loginWithEmailCode } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeAppPath(searchParams.get('next'))
  const workspaceSlug = workspaceSlugFromNext(next)
  const policy = useSignInPolicy(workspaceSlug)

  useEffect(() => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
    fetch(`${API}/api/platform`)
      .then((r) => r.json())
      .then((d) => {
        setSignupsPaused(Boolean(d.signupsPaused))
        setPausedMessage(
          d.signupsPausedMessage ||
            'New signups are temporarily paused. Please check back soon.',
        )
      })
      .catch(() => setSignupsPaused(false))
      .finally(() => setCheckingPlatform(false))
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (googlePending && !pendingGoogleSignupCredential()) {
        setGooglePending(false)
        setError('Your Google verification expired. Continue with Google again; your details are still here.')
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [googlePending])

  function finishSignIn(user: Awaited<ReturnType<typeof loginWithGoogle>>) {
    navigate(user.needsProfileCompletion
      ? (next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile')
      : accountDestination(user, next))
  }

  async function handleGoogleCredential(credential: string) {
    setError('')
    try {
      finishSignIn(await loginWithGoogle(credential, undefined, workspaceSlug))
    } catch (error) {
      if (!workspaceSlug && error instanceof ApiError && error.code === 'PROFILE_REQUIRED') {
        setGooglePending(true)
        setEmailSignup(false)
        return
      }
      throw error
    }
  }

  async function submitDetails(e: React.FormEvent) {
    e.preventDefault()
    if (!gender) { setError('Please select Male or Female'); return }
    setError('')
    if (!googlePending) { setDetailsReady(true); return }
    const credential = pendingGoogleSignupCredential()
    if (!credential) {
      setGooglePending(false)
      setError('Your Google verification expired. Continue with Google again; your details are still here.')
      return
    }
    setSubmitting(true)
    try {
      finishSignIn(await loginWithGoogle(credential, { phone, dateOfBirth, gender, pincode }))
    } catch (error) {
      setGooglePending(Boolean(pendingGoogleSignupCredential()))
      setError(error instanceof Error ? error.message : 'Unable to create your account. Please try again.')
    } finally { setSubmitting(false) }
  }

  async function handleEmailCode(challengeId: string, code: string) {
    const user = await loginWithEmailCode(challengeId, code, { phone, dateOfBirth, gender, pincode }, workspaceSlug)
    navigate(user.needsProfileCompletion
      ? (next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile')
      : accountDestination(user, next))
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <LogoWithBeta imgClassName="h-16 w-auto" />
          </div>
          <CardTitle className="text-xl sm:text-2xl">Create your account</CardTitle>
          <CardDescription>Start improving your communication</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {checkingPlatform ? (
            <p className="text-center text-sm text-muted-foreground">Loading…</p>
          ) : signupsPaused ? (
            <div className="space-y-4 text-center">
              <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-foreground">
                {pausedMessage}
              </div>
              <p className="text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  to={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}
                  className="text-foreground font-medium hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}

              {policy.loading && <p role="status" className="text-sm">Loading sign-in options…</p>}
              {policy.error && <p role="alert" className="text-sm text-destructive">{policy.error}</p>}
              {!googlePending && policy.methods.google && <GoogleSignInButton label="signup_with" onCredential={handleGoogleCredential} onError={setError} />}
              {!googlePending && policy.methods.emailCode && !emailSignup && <Button variant="outline" className="w-full" onClick={() => setEmailSignup(true)}>Sign up with email</Button>}
              {googlePending && <p role="status" className="text-sm text-muted-foreground">Google verified. Add your details to finish creating your account.</p>}
              {(googlePending || emailSignup) && <form className="space-y-4" onSubmit={submitDetails}>
                <fieldset disabled={submitting} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="register-phone">Phone number</Label>
                  <Input id="register-phone" type="tel" inputMode="tel" placeholder="10-digit mobile number" value={phone} onChange={e => { setPhone(e.target.value); setDetailsReady(false) }} required autoComplete="tel" />
                </div>
                <ProfileDetailsRow
                  dateOfBirth={dateOfBirth}
                  onDateOfBirthChange={value => { setDateOfBirth(value); setDetailsReady(false) }}
                  gender={gender}
                  onGenderChange={value => { setGender(value); setDetailsReady(false) }}
                  pincode={pincode}
                  onPincodeChange={value => { setPincode(value); setDetailsReady(false) }}
                />
                {(googlePending || !detailsReady) && <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Creating your account…' : googlePending ? 'Create account' : 'Continue'}</Button>}
                </fieldset>
              </form>}
              {googlePending && <Button variant="ghost" className="w-full" disabled={submitting} onClick={() => { clearPendingGoogleSignup(); setGooglePending(false) }}>Use a different Google account</Button>}

              {emailSignup && detailsReady && !googlePending && policy.methods.emailCode && <EmailCodeSignIn workspaceSlug={workspaceSlug} purpose="signup" onVerify={handleEmailCode} />}

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <Link to="/terms?from=signup" className="text-foreground font-medium hover:underline">
                  Terms and Conditions
                </Link>{' '}
                and{' '}
                <Link to="/privacy?from=signup" className="text-foreground font-medium hover:underline">
                  Privacy Policy
                </Link>
                . Your account is created only after these details and sign-in.
              </p>

              <div className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link
                  to={next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'}
                  className="text-foreground font-medium hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
