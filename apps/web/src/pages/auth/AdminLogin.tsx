import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardDescription, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LogoWithBeta } from '@/components/brand/LogoWithBeta'

/**
 * Dedicated admin sign-in (username + password). Regular users use Google-only
 * sign-in on /auth/login. Admin credentials are unchanged.
 */
export function AdminLogin() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const user = await login(email, password)
      const isAdmin = user.role === 'ADMIN' || user.role === 'SUPER_ADMIN'
      if (user.needsProfileCompletion) {
        navigate('/auth/complete-profile')
        return
      }
      navigate(isAdmin ? '/admin' : '/')
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
          <CardTitle className="text-xl">Admin sign in</CardTitle>
          <CardDescription className="text-base">
            Enter your admin credentials to continue
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="admin@spasht.ai"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/auth/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in...' : 'Sign In'}
            </Button>
          </form>

          <div className="border-t pt-3 text-center text-xs text-muted-foreground">
            <Link to="/auth/login" className="hover:text-foreground transition-colors">
              &larr; Back to user sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
