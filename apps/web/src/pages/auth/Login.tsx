import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardDescription } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'

export function Login() {
  const [error, setError] = useState('')
  const [signupsPaused, setSignupsPaused] = useState(false)
  const { loginWithGoogle } = useAuth()
  const navigate = useNavigate()

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
      navigate('/auth/complete-profile')
      return
    }
    navigate(user.role === 'ADMIN' || user.role === 'SUPER_ADMIN' ? '/admin' : '/')
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

          <GoogleSignInButton
            label="signin_with"
            onCredential={handleGoogleCredential}
            onError={setError}
          />

          <div className="text-center text-sm text-muted-foreground">
            {!signupsPaused && (
              <>
                Don&apos;t have an account?{' '}
                <Link to="/auth/register" className="text-foreground font-medium hover:underline">
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
