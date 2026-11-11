import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { AccessPolicyCard } from '@/workspaces/AccessPolicyCard'
import type { AccessPolicy } from '@/workspaces/accessPolicy'
export function PlatformSignInCard() {
  const [policy, setPolicy] = useState<AccessPolicy | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  useEffect(() => { apiClient<{ settings: { googleSignInEnabled: boolean; emailCodeSignInEnabled: boolean } }>('/api/admin/platform').then(({ settings }) => setPolicy({ methods: { google: settings.googleSignInEnabled, emailCode: settings.emailCodeSignInEnabled }, learnerEmailDomains: [] })).catch(e => setError(e.message)) }, [])
  async function save(value: AccessPolicy) {
    setBusy(true); setError(''); setSaved(false)
    try { await apiClient('/api/admin/platform/sign-in', { method: 'PUT', body: JSON.stringify(value.methods) }); setPolicy(value); setSaved(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) }
  }
  return <div className="space-y-2">{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{saved && <p role="status" className="text-sm">Sign-in policy saved.</p>}{policy && <AccessPolicyCard key={JSON.stringify(policy)} policy={policy} busy={busy} tenant={false} onSave={save} />}</div>
}
