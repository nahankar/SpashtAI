import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ProfileDetailsRow, type ProfileGender } from '@/components/auth/ProfileDetailsRow'
import { apiClient } from '@/lib/api-client'
import { BrandName, BRAND_ALT } from '@/components/brand/BrandName'

export function CompleteProfile() {
  const { user, updateUser, fetchCurrentUser } = useAuth()
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<ProfileGender>('')
  const [pincode, setPincode] = useState('')
  const [acceptedTerms, setAcceptedTerms] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (user && !user.needsProfileCompletion) {
      navigate('/', { replace: true })
    }
  }, [user, navigate])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (!gender) {
      setError('Please select M or F')
      return
    }

    if (!acceptedTerms) {
      setError('Please accept the Terms and Privacy Policy to continue')
      return
    }

    setSubmitting(true)
    try {
      const data = await apiClient<{ user: typeof user }>('/api/auth/complete-profile', {
        method: 'POST',
        body: JSON.stringify({ phone, dateOfBirth, gender, pincode }),
      })
      if (data.user) updateUser(data.user)
      else await fetchCurrentUser()
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center space-y-2">
          <img src="/spashtai_logo.svg" alt={BRAND_ALT} className="h-12 w-auto mx-auto" />
          <CardTitle className="text-xl">Almost there</CardTitle>
          <CardDescription>
            {user?.email
              ? `Welcome${user.firstName ? `, ${user.firstName}` : ''}! Add a few details to finish setting up your account.`
              : 'Add your contact and location details to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            <div className="space-y-2">
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
              />
            </div>

            <ProfileDetailsRow
              dateOfBirth={dateOfBirth}
              onDateOfBirthChange={setDateOfBirth}
              gender={gender}
              onGenderChange={setGender}
              pincode={pincode}
              onPincodeChange={setPincode}
            />

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border"
                checked={acceptedTerms}
                onChange={(e) => setAcceptedTerms(e.target.checked)}
                required
              />
              <span className="text-muted-foreground">
                I agree to the{' '}
                <Link to="/terms?from=register" className="text-primary hover:underline" target="_blank">
                  Terms
                </Link>{' '}
                and{' '}
                <Link to="/privacy?from=register" className="text-primary hover:underline" target="_blank">
                  Privacy Policy
                </Link>
              </span>
            </label>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Saving…' : 'Continue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
