import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { canUseClarity, clarityProjectId, loadClarity, readClarityConsent, tagClarity, writeClarityConsent } from '@/lib/clarity'

export function AnalyticsConsent() {
  const { pathname } = useLocation()
  const { user, isAdmin } = useAuth()
  const [consent, setConsent] = useState(readClarityConsent)
  const show = Boolean(user) && !isAdmin && !pathname.startsWith('/admin') && consent == null && import.meta.env.PROD && Boolean(clarityProjectId())

  useEffect(() => {
    if (!user || isAdmin || !canUseClarity(pathname)) return
    loadClarity(clarityProjectId())
    tagClarity(user.id, pathname)
  }, [consent, isAdmin, pathname, user])

  if (!show) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card p-4 shadow-lg">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Optional Microsoft Clarity diagnostics record masked page interactions so we can see where the product is confusing. They are separate from the numbers in admin dashboards, stay off admin pages, and never include your name, email, transcript, or answers.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => { writeClarityConsent('denied'); setConsent('denied') }}>Decline</Button>
          <Button type="button" onClick={() => { writeClarityConsent('granted'); setConsent('granted') }}>Allow diagnostics</Button>
        </div>
      </div>
    </div>
  )
}

export function AnalyticsPrivacySettings() {
  const [consent, setConsent] = useState(readClarityConsent)
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Privacy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Product usage used for admin dashboards is stored with your account. Microsoft Clarity is optional and only runs in production after you allow it.</p>
      </div>
      <div className="rounded-lg border p-4">
        <p className="text-sm">Diagnostic recordings: {consent === 'granted' ? 'Allowed' : consent === 'denied' ? 'Declined' : 'Not chosen'}</p>
        <div className="mt-3 flex gap-2">
          <Button type="button" variant={consent === 'granted' ? 'default' : 'outline'} onClick={() => { writeClarityConsent('granted'); setConsent('granted') }}>Allow</Button>
          <Button type="button" variant={consent === 'denied' ? 'default' : 'outline'} onClick={() => { writeClarityConsent('denied'); setConsent('denied') }}>Decline</Button>
        </div>
      </div>
    </div>
  )
}
