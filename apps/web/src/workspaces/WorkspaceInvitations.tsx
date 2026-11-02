import { RecipientExperiencePreview, type EmailPreview } from './RecipientExperiencePreview'
import type { EnrollmentField } from './EnrollmentFields'
import { BulkInvitations, type BatchResult } from '@/components/admin/BulkInvitations'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { identityToken, workspaceRequest, type Entry, type Feature, type Membership } from './client'
import type { Invitation, InvitationStatus } from '@/lib/invitations'

type Row = Invitation & { role: Membership['role'] }
type Page = { items: Row[]; total: number; page: number; totalPages: number; counts: Record<InvitationStatus, number> }
const inputClass = 'rounded-md border px-3 py-2 min-w-0 w-full bg-background'
export function WorkspaceInvitations({ slug, role, features, emailContent, workspaceName, enrollmentFields }: { slug: string; role: Membership['role']; features: Feature[]; emailContent?: { subject: string; message: string }; workspaceName?: string; enrollmentFields?: EnrollmentField[] }) {
  const [rows, setRows] = useState<Page | null>(null), [page, setPage] = useState(1)
  const [status, setStatus] = useState('pending'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ email: string; name: string; role: string; memberFeatures: Record<string, boolean> } | null>(null)
  const call = useCallback(async <T,>(path: string, method = 'GET', body?: unknown) => {
    const entry = await workspaceRequest<Entry>(`/api/workspaces/entry/${encodeURIComponent(slug)}`, identityToken(), 'POST')
    if (!entry.accessToken) throw new Error('Open this workspace again to continue')
    return workspaceRequest<T>(`/api/workspaces/current/invitations${path}`, entry.accessToken, method, body)
  }, [slug])
  const load = useCallback(() => call<Page>(`?status=${status}&page=${page}`).then(setRows), [call, status, page])
  useEffect(() => { let alive = true; call<Page>(`?status=${status}&page=${page}`).then(data => { if (alive) setRows(data) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [call, page, status])
  async function action(path: string, body?: unknown) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await call<Row>(path, 'POST', body)
      setNotice(path.endsWith('/revoke') ? 'Invitation revoked.' : result.deliveryStatus === 'DEV_CAPTURED' ? 'Captured locally. No email was sent.' : result.deliveryStatus === 'SENT' ? 'Accepted by the mail server for delivery.' : result.deliveryStatus === 'FAILED' ? 'Invitation saved, but email was not sent. Ask the platform administrator to check email delivery, then resend.' : 'Invitation saved; delivery outcome is not yet available.')
      setDraft(null); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save invitation') } finally { setBusy(false) }
  }
  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget), memberFeatures: Record<string, boolean> = {}
    for (const feature of features) { const value = f.get(`feature:${feature.feature}`); if (value === 'true' || value === 'false') memberFeatures[feature.feature] = value === 'true' }
    setDraft({ email: String(f.get('email')).trim().toLowerCase(), name: String(f.get('name') || ''), role: String(f.get('role')), memberFeatures })
  }
  return <section className="border rounded-lg p-5 space-y-4" aria-label="Workspace invitations">
    <h2 className="text-xl font-semibold">Invitations</h2>
    <p>Invite someone to this workspace with their Google Account email. Their Personal history stays separate. New accounts cannot be created while public signups are paused.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}{notice && <p role="status">{notice}</p>}
    {rows && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" aria-label="Invitation overview">{Object.entries(rows.counts).map(([label, count]) => <div key={label} className="border rounded p-3"><p className="capitalize">{label}</p><strong>{count}</strong></div>)}</div>}
    <BulkInvitations key={JSON.stringify(emailContent)} workspace emailContent={emailContent} workspaceName={workspaceName} fields={enrollmentFields} preview={body => call<EmailPreview>('/preview', 'POST', body)} send={async body => { const result = await call<BatchResult>('/bulk', 'POST', body); await load(); return result }} />
    <form onSubmit={prepare} className="space-y-3"><div className="grid sm:grid-cols-3 gap-3">
      <label>Email<input name="email" type="email" required maxLength={254} className={inputClass} /></label>
      <label>Name (optional)<input name="name" maxLength={120} className={inputClass} /></label>
      <label>Workspace role<select name="role" className={inputClass}><option value="LEARNER">Learner</option>{role === 'OWNER' && <><option value="ADMIN">Admin</option><option value="OWNER">Owner</option></>}</select></label>
    </div><details><summary>Initial feature permissions</summary><div className="grid sm:grid-cols-2 gap-3 p-3">{features.map(feature => <label key={feature.feature}>{feature.feature.replaceAll('_', ' ')}<select name={`feature:${feature.feature}`} className={inputClass}><option value="default">Organization default</option><option value="false">Disabled</option><option value="true" disabled={!feature.entitled}>Allowed within entitlement</option></select></label>)}</div></details><Button disabled={busy}>Review invitation</Button></form>
    {draft && <div role="dialog" aria-label="Confirm workspace invitation" className="border rounded p-4 space-y-3"><p>Create an invitation for <strong>{draft.email}</strong> as {draft.role.toLowerCase()} in this workspace? This sends an email when delivery is configured; development captures it locally.</p><RecipientExperiencePreview workspaceName={workspaceName} fields={enrollmentFields} emailContent={emailContent ?? { subject: '', message: '' }} onEmailPreview={body => call<EmailPreview>('/preview', 'POST', { ...body, name: draft.name })} /><Button disabled={busy} onClick={() => action('', draft)}>Confirm invitation</Button><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button></div>}
    <label>Show<select disabled={busy} className={inputClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}>{['pending', 'accepted', 'expired', 'revoked'].map(s => <option key={s}>{s}</option>)}</select></label>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Email delivery</th><th>Actions</th></tr></thead><tbody>{rows?.items.map(inv => <tr key={inv.id} className="border-t"><td className="break-all py-3">{inv.email}</td><td>{inv.role}</td><td>{inv.status}</td><td>{({ DEV_CAPTURED: 'Captured locally', SENT: 'Sent to mail server', FAILED: 'Not sent', SENDING: 'Sending / outcome pending' })[inv.deliveryStatus]}</td><td className="space-x-2">{(role === 'OWNER' || inv.role === 'LEARNER') && <>{['pending', 'expired'].includes(inv.status) && <><Button variant="outline" disabled={busy} onClick={() => action(`/${inv.id}/resend`)}>Resend</Button><Button variant="outline" disabled={busy} onClick={() => action(`/${inv.id}/revoke`)}>Revoke</Button></>}</>}</td></tr>)}</tbody></table></div>
    {rows?.items.length === 0 && <p>No {status} invitations.</p>}
    {rows && <div className="flex gap-3 items-center"><Button variant="outline" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span>Page {page} of {rows.totalPages}</span><Button variant="outline" disabled={busy || page >= rows.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
  </section>
}
