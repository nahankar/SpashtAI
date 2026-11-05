import { useState, useEffect, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { safeAppPath } from '@/lib/safe-next-path'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EmailCodeSignIn } from '@/components/auth/EmailCodeSignIn'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'

export function Login() {
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [signupsPaused, setSignupsPaused] = useState(false)
  const { loginForDevelopment, loginWithGoogle, loginWithEmailCode } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = safeAppPath(searchParams.get('next'))

  useEffect(() => {
    const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
    fetch(`${API}/api/platform`)
      .then((r) => r.json())
      .then((d) => setSignupsPaused(Boolean(d.signupsPaused)))
      .catch(() => setSignupsPaused(false))
  }, [])

  async function handleGoogleCredential(credential: string) {
    const user = await loginWithGoogle(credential)
    if (user.needsProfileCompletion) {
      navigate(next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile')
      return
    }
    navigate(next || (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? '/admin' : '/'))
  }

  async function handleEmailCode(challengeId: string, code: string) {
    const user = await loginWithEmailCode(challengeId, code)
    navigate(user.needsProfileCompletion
      ? (next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile')
      : next || (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? '/admin' : '/'))
  }

  async function handleLocalSignIn(event: FormEvent) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const user = await loginForDevelopment(email.trim().toLowerCase(), password)
      if (user.needsProfileCompletion) {
        navigate(next ? `/auth/complete-profile?next=${encodeURIComponent(next)}` : '/auth/complete-profile')
        return
      }
      navigate(next || (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? '/admin' : '/'))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid credentials')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-3">
          <div className="flex justify-center">
            <LogoWithBeta imgClassName="h-16 w-auto" />
          </div>
          <CardDescription className="text-base text-foreground font-medium">
            Sign in to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <EmailCodeSignIn onVerify={handleEmailCode} />
          <p className="text-center text-xs text-muted-foreground">Or continue with Google</p>
          <GoogleSignInButton
            label="signin_with"
            onCredential={handleGoogleCredential}
            onError={setError}
          />

          {import.meta.env.DEV && (
            <form onSubmit={handleLocalSignIn} className="space-y-3 border-t pt-4">
              <p className="text-sm text-muted-foreground">{`Local walkthrough sign-in for fictional @walkthrough.test accounts. The server refuses this route in production.`}</p>
              <div className="space-y-2">
                <Label htmlFor="dev-email">Email</Label>
                <Input id="dev-email" type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dev-password">Password</Label>
                <Input id="dev-password" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in for local development'}</Button>
            </form>
          )}

          <div className="text-center text-sm text-muted-foreground">
            {!signupsPaused && (
              <>
                Don&apos;t have an account?{' '}
                <Link
                  to={next ? `/auth/register?next=${encodeURIComponent(next)}` : '/auth/register'}
                  className="text-foreground font-medium hover:underline"
                >
                  Signup
                </Link>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
