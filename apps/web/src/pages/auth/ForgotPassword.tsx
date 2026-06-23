import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const data = await apiClient<{ message: string; devResetUrl?: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
          skipAuth: true,
        },
      )
      setSent(true)
      if (data.devResetUrl) {
        setDevResetUrl(data.devResetUrl)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send reset link')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Reset your password</CardTitle>
          <CardDescription>
            {sent
              ? 'Check your email for a reset link'
              : "Enter your email and we'll send you a reset link"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                If an account exists for <strong>{email}</strong>, you'll receive a password reset
                link shortly.
              </p>
              {import.meta.env.DEV && !devResetUrl && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3 text-left">
                  <strong>Development:</strong> SMTP is not configured. Check the API server console
                  for the reset URL, or set SMTP_* env vars /{' '}
                  <code className="text-[10px]">EXPOSE_DEV_RESET_URL=true</code> to show the link here.
                </p>
              )}
              {devResetUrl && (
                <div className="text-left text-xs bg-muted rounded-md p-3 space-y-2">
                  <p className="font-medium text-foreground">Development reset link:</p>
                  <a href={devResetUrl} className="text-primary break-all hover:underline">
                    {devResetUrl}
                  </a>
                </div>
              )}
              <Link to="/auth/login">
                <Button variant="outline" className="w-full">
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
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
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Reset Link'}
              </Button>
              <div className="text-center">
                <Link
                  to="/auth/login"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  Back to Sign In
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
