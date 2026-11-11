import { useEffect, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface TrafficLimits {
  apiRateLimitMax: number
  apiRateLimitWindowMinutes: number
  authRateLimitMax: number
  authRateLimitWindowMinutes: number
}
const fields = [
  { key: 'apiRateLimitMax', label: 'General API requests per IP', max: 1_000_000 },
  { key: 'apiRateLimitWindowMinutes', label: 'General API window (minutes)', max: 1440 },
  { key: 'authRateLimitMax', label: 'Login attempts per IP', max: 1_000_000 },
  { key: 'authRateLimitWindowMinutes', label: 'Login window (minutes)', max: 1440 },
] as const

export function TrafficLimitsCard() {
  const [values, setValues] = useState<Record<keyof TrafficLimits, string> | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    apiClient<{ settings: TrafficLimits }>('/api/admin/platform').then(({ settings }) => {
      if (active) setValues({
        apiRateLimitMax: String(settings.apiRateLimitMax),
        apiRateLimitWindowMinutes: String(settings.apiRateLimitWindowMinutes),
        authRateLimitMax: String(settings.authRateLimitMax),
        authRateLimitWindowMinutes: String(settings.authRateLimitWindowMinutes),
      })
    }).catch(() => { if (active) setError('Could not load traffic limits. Reload this page to retry.') })
    return () => { active = false }
  }, [])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!values || saving) return
    if (fields.some(({ key, max }) => !/^\d+$/.test(values[key]) || Number(values[key]) < 1 || Number(values[key]) > max)) {
      setError('Enter whole-number request limits from 1 to 1,000,000 and windows from 1 to 1,440 minutes.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiClient('/api/admin/platform/rate-limit/settings', {
        method: 'PUT', body: JSON.stringify(Object.fromEntries(fields.map(({ key }) => [key, Number(values[key])]))),
      })
      setSaved(true)
      toast.success('Traffic limits saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save traffic limits.')
    } finally {
      setSaving(false)
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle>Student traffic limits</CardTitle>
      <CardDescription>Platform-wide limits for all organizations. Students sharing campus internet share the same IP allowance. Defaults: 100 API requests per minute and 5 login attempts per 15 minutes.</CardDescription>
    </CardHeader>
    <CardContent>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(({ key, label, max }) => <div key={key} className="space-y-2">
            <Label htmlFor={key}>{label}</Label>
            <Input id={key} type="number" min={1} max={max} step={1} required
              value={values?.[key] ?? ''} disabled={!values || saving}
              onChange={event => { setValues(current => current && ({ ...current, [key]: event.target.value })); setSaved(false) }} />
          </div>)}
        </div>
        <p className="text-sm text-muted-foreground">Login attempts include Google sign-in, email code requests and verification, signup, and password recovery. These requests also use the general API allowance. Invitation acceptance has its own separate limit.</p>
        <p className="text-sm text-muted-foreground">Changes apply without a restart and reach all servers within 30 seconds. Changing a time window resets its current request counts.</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!values && !error && <p role="status" className="text-sm text-muted-foreground">Loading traffic limits…</p>}
        {saved && <p role="status" className="text-sm text-muted-foreground">Traffic limits saved.</p>}
        <Button type="submit" disabled={!values || saving}>{saving ? 'Saving…' : 'Save traffic limits'}</Button>
      </form>
    </CardContent>
  </Card>
}
