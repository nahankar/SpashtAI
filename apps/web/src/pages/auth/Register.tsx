import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'

export function Register() {
  const [error, setError] = useState('')
  const [signupsPaused, setSignupsPaused] = useState(false)
  const [pausedMessage, setPausedMessage] = useState('')
  const [checkingPlatform, setCheckingPlatform] = useState(true)
  const { loginWithGoogle } = useAuth()
  const navigate = useNavigate()

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

  async function handleGoogleCredential(credential: string) {
    const user = await loginWithGoogle(credential)
    // New Google users still complete phone, DOB, gender and pincode before entering.
    navigate(user.needsProfileCompletion ? '/auth/complete-profile' : '/')
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
                <Link to="/auth/login" className="text-foreground font-medium hover:underline">
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

              <GoogleSignInButton
                label="signup_with"
                onCredential={handleGoogleCredential}
                onError={setError}
              />

              <p className="text-xs text-muted-foreground text-center leading-relaxed">
                By continuing, you agree to the{' '}
                <Link to="/terms?from=signup" className="text-foreground font-medium hover:underline">
                  Terms and Conditions
                </Link>{' '}
                and{' '}
                <Link to="/privacy?from=signup" className="text-foreground font-medium hover:underline">
                  Privacy Policy
                </Link>
                . You&apos;ll add a few details (phone, date of birth, gender, pincode) next.
              </p>

              <div className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link to="/auth/login" className="text-foreground font-medium hover:underline">
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
