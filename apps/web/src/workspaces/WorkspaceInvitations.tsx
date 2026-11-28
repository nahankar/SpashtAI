import { RecipientExperiencePreview, type EmailPreview } from './RecipientExperiencePreview'
import type { EnrollmentField } from './EnrollmentFields'
import { BulkInvitations, type BatchResult } from '@/components/admin/BulkInvitations'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { Feature, Membership } from './client'
import { workspaceCall } from './shell/context'
import { featureLabel, deliveryNotice } from './shell/model'
import { WorkspaceInvitationRows, INVITATION_DELIVERY_LABELS } from './WorkspaceInvitationRows'
import { applyInvitationActions, canActOnInvitation, selectedInvitations, type InvitationAction } from './invitationActions'
import type { Invitation, InvitationStatus } from '@/lib/invitations'

type Row = Invitation & { role: Membership['role'] }
type Page = { items: Row[]; total: number; page: number; totalPages: number; counts: Record<InvitationStatus, number> }
type Draft = { email: string; name: string; role: Membership['role']; memberFeatures: Record<string, boolean> }
const STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const
const INVITE_FEATURES = ['elevate', 'replay', 'interviews', 'progress_pulse', 'feedback']

export function WorkspaceInvitations({ role, features, emailContent, workspaceName, enrollmentFields, invitationLimits }: { invitationLimits?: { batchSize: number; hourlyLimit: number | null }; role: Membership['role']; features: Feature[]; emailContent?: { subject: string; message: string }; workspaceName?: string; enrollmentFields?: EnrollmentField[] }) {
  const [rows, setRows] = useState<Page | null>(null), [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>('pending'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [inviteRole, setInviteRole] = useState<Membership['role']>('LEARNER')
  const [grants, setGrants] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [search, setSearch] = useState(''), [query, setQuery] = useState(''), [roleFilter, setRoleFilter] = useState('all'), [delivery, setDelivery] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set()), [loading, setLoading] = useState(true)
  const [confirmation, setConfirmation] = useState<{ action: InvitationAction; rows: Row[] } | null>(null)
  const [failures, setFailures] = useState<{ email: string; error?: string }[]>([])
  useEffect(() => { const timer = setTimeout(() => setQuery(search), 250); return () => clearTimeout(timer) }, [search])
  const params = new URLSearchParams({ page: String(page), ...(status === 'all' ? {} : { status }), ...(query.trim() ? { q: query.trim() } : {}), ...(roleFilter === 'all' ? {} : { role: roleFilter }), ...(delivery === 'all' ? {} : { delivery }) }).toString()
  function resetSelection() { setSelected(new Set()); setPage(1); setConfirmation(null) }

  const call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => workspaceCall<T>(`/api/workspaces/current/invitations${path}`, method, body), [])
  const load = useCallback(async () => {
    const data = await call<Page>(`?${params}`); setRows(data)
    setSelected(previous => new Set(data.items.filter(inv => previous.has(inv.id) && canActOnInvitation(inv, role, 'resend')).map(inv => inv.id)))
    if (data.page > data.totalPages) setPage(data.totalPages)
  }, [call, params, role])
  useEffect(() => { let alive = true; setLoading(true); setError('')
    call<Page>(`?${params}`).then(data => { if (alive) { setRows(data); if (data.page > data.totalPages) setPage(data.totalPages) } })
      .catch(e => { if (alive) { setError(e.message); setRows(null) } }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [call, params])
  const fetching = loading || search !== query
  const resendRows = selectedInvitations(rows?.items ?? [], selected, role, 'resend')
  const revokeRows = selectedInvitations(rows?.items ?? [], selected, role, 'revoke')
  async function confirmActions() {
    if (!confirmation || busy) return
    setBusy(true); setError(''); setNotice(''); setFailures([])
    const result = await applyInvitationActions(confirmation.rows, confirmation.action, (id, action) => call<Row>(`/${id}/${action}`, 'POST'))
    const succeeded = result.filter(r => r.ok), failed = result.filter(r => !r.ok)
    const unsent = succeeded.filter(r => r.deliveryStatus === 'FAILED').length
    const captured = succeeded.filter(r => r.deliveryStatus === 'DEV_CAPTURED').length
    setNotice(confirmation.action === 'revoke' ? `${succeeded.length} invitation(s) revoked. ${failed.length} failed.`
      : `${succeeded.length} resend(s) processed. ${unsent} not sent; ${captured} captured locally; ${failed.length} failed. Sent to a mail server does not confirm inbox delivery.`)
    setFailures(failed); setSelected(new Set(failed.map(r => r.id))); setConfirmation(null)
    try { await load() } catch { setError('Actions finished, but the list could not be refreshed. Reload before trying again.'); setRows(null) }
    finally { setBusy(false) }
  }
  async function action(path: string, body?: unknown) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await call<Row>(path, 'POST', body)
      setNotice(deliveryNotice(path, result.deliveryStatus))
      if (!path) { setDraft(null); setEmail(''); setName(''); setGrants({}) }
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save invitation') } finally { setBusy(false) }
  }
  function prepare(event: FormEvent) {
    event.preventDefault()
    const memberFeatures: Record<string, boolean> = {}
    for (const [feature, value] of Object.entries(grants)) if (value === 'true' || value === 'false') memberFeatures[feature] = value === 'true'
    setDraft({ email: email.trim().toLowerCase(), name, role: inviteRole, memberFeatures })
  }
  return <div className="space-y-5" aria-label="Workspace invitations">
    <div><h1 className="text-2xl font-bold tracking-tight">Invitations</h1>
      <p className="mt-1 text-sm text-muted-foreground">Invite someone with their email address. After acceptance, this email has organization access only; previous Personal history is preserved but unavailable.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {rows && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Invitation overview">{STATUSES.map(s => <Card key={s}><CardHeader className="p-4"><CardDescription className="capitalize">{s}</CardDescription><CardTitle className="text-2xl tabular-nums">{rows.counts[s] ?? 0}</CardTitle></CardHeader></Card>)}</div>}
    <Card><CardHeader><CardTitle className="text-base">Invite one person</CardTitle></CardHeader><CardContent>
      <form onSubmit={prepare} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="invite-name">Name (optional)</Label><Input id="invite-name" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Workspace role</Label><Select value={inviteRole} onValueChange={v => setInviteRole(v as Membership['role'])}>
            <SelectTrigger aria-label="Workspace role"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="LEARNER">Learner</SelectItem>{role === 'OWNER' && <><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="OWNER">Owner</SelectItem></>}</SelectContent></Select></div>
        </div>
        <Accordion type="single" collapsible><AccordionItem value="grants"><AccordionTrigger>Initial product access</AccordionTrigger><AccordionContent>
          <div className="grid gap-3 sm:grid-cols-2">{features.filter(f => INVITE_FEATURES.includes(f.feature)).map(feature => <div key={feature.feature} className="flex items-center justify-between gap-3">
            <Label>{featureLabel(feature.feature)}</Label>
            <Select value={grants[feature.feature] ?? 'default'} onValueChange={v => setGrants(g => ({ ...g, [feature.feature]: v }))}>
              <SelectTrigger aria-label={`${feature.feature} initial access`} className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="default">Organization default</SelectItem><SelectItem value="false">Turned off</SelectItem><SelectItem value="true" disabled={!feature.entitled}>Allowed within plan</SelectItem></SelectContent>
            </Select>
          </div>)}</div>
        </AccordionContent></AccordionItem></Accordion>
        <Button type="submit" disabled={busy}>Review invitation</Button>
      </form>
    </CardContent></Card>
    <BulkInvitations key={JSON.stringify(emailContent)} workspace invitationLimits={invitationLimits} emailContent={emailContent} workspaceName={workspaceName} fields={enrollmentFields} preview={body => call<EmailPreview>('/preview', 'POST', body)} send={async body => { const result = await call<BatchResult>('/bulk', 'POST', body); await load(); return result }} />
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open) setDraft(null) }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">{draft && <>
        <DialogHeader><DialogTitle>Confirm workspace invitation</DialogTitle>
          <DialogDescription>Invite <strong>{draft.email}</strong> as {draft.role.toLowerCase()}. This sends an email when delivery is configured; development captures it locally.</DialogDescription></DialogHeader>
        <RecipientExperiencePreview workspaceName={workspaceName} fields={enrollmentFields} emailContent={emailContent ?? { subject: '', message: '' }} onEmailPreview={body => call<EmailPreview>('/preview', 'POST', { ...body, name: draft.name })} />
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setDraft(null)}>Cancel</Button><Button disabled={busy} onClick={() => action('', draft)}>Confirm invitation</Button></DialogFooter>
      </>}</DialogContent>
    </Dialog>
    <Card><CardHeader><CardTitle className="text-base">Sent invitations</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input aria-label="Search invitations by name or email" placeholder="Search by name or email…" value={search} disabled={busy} maxLength={200} onChange={e => { resetSelection(); setSearch(e.target.value) }} />
        <Select value={status} disabled={busy} onValueChange={v => { resetSelection(); setStatus(v) }}>
          <SelectTrigger aria-label="Invitation status"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All statuses</SelectItem>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>
        <Select value={roleFilter} disabled={busy} onValueChange={v => { resetSelection(); setRoleFilter(v) }}>
          <SelectTrigger aria-label="Filter invitations by role"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All roles</SelectItem><SelectItem value="LEARNER">Learner</SelectItem><SelectItem value="ADMIN">Admin</SelectItem><SelectItem value="OWNER">Owner</SelectItem></SelectContent></Select>
        <Select value={delivery} disabled={busy} onValueChange={v => { resetSelection(); setDelivery(v) }}>
          <SelectTrigger aria-label="Filter invitations by email delivery"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">All email delivery</SelectItem>{Object.entries(INVITATION_DELIVERY_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
      </div>
      {(search || status !== 'pending' || roleFilter !== 'all' || delivery !== 'all') && <Button variant="ghost" disabled={busy} onClick={() => { resetSelection(); setSearch(''); setStatus('pending'); setRoleFilter('all'); setDelivery('all') }}>Clear filters</Button>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>{selected.size} selected on this page</span>
        <Button variant="outline" size="sm" disabled={busy || fetching || !resendRows.length} onClick={() => setConfirmation({ action: 'resend', rows: resendRows })}>Resend selected ({resendRows.length})</Button>
        <Button variant="outline" size="sm" disabled={busy || fetching || !revokeRows.length} onClick={() => setConfirmation({ action: 'revoke', rows: revokeRows })}>Revoke selected ({revokeRows.length})</Button>
        {!!selected.size && <Button variant="ghost" size="sm" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Select all applies to actionable invitations on this page. Only pending invitations can be revoked. Resends use the workspace email limit.</p>
      {failures.length > 0 && <div role="alert" className="text-sm text-destructive"><p>These invitations could not be updated:</p><ul>{failures.map(f => <li key={f.email}>{f.email}: {f.error}</li>)}</ul></div>}
      {fetching ? <p role="status" className="text-sm text-muted-foreground">Loading invitations…</p> : rows?.items.length === 0 ? <p className="text-sm text-muted-foreground">No invitations match these filters.</p> : <WorkspaceInvitationRows rows={rows?.items ?? []} role={role} busy={busy} selected={selected}
        onSelect={(id, checked) => setSelected(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next })}
        onSelectAll={checked => setSelected(checked ? new Set((rows?.items ?? []).filter(inv => canActOnInvitation(inv, role, 'resend')).map(inv => inv.id)) : new Set())}
        onAction={(action, items) => setConfirmation({ action, rows: items })} />}
      {rows && <div className="flex flex-wrap items-center gap-3 pt-4"><span className="text-sm">{rows.total} matching invitation(s)</span><Button variant="outline" disabled={busy || fetching || page <= 1} onClick={() => { setSelected(new Set()); setLoading(true); setPage(p => p - 1) }}>Previous</Button><span className="text-sm">Page {page} of {Math.max(rows.totalPages, 1)}</span><Button variant="outline" disabled={busy || fetching || page >= rows.totalPages} onClick={() => { setSelected(new Set()); setLoading(true); setPage(p => p + 1) }}>Next</Button></div>}
    </CardContent></Card>
    <Dialog open={Boolean(confirmation)} onOpenChange={open => { if (!open && !busy) setConfirmation(null) }}>
      <DialogContent><DialogHeader><DialogTitle>{confirmation?.action === 'revoke' ? 'Revoke' : 'Resend'} {confirmation?.rows.length} invitation(s)?</DialogTitle>
        <DialogDescription>{confirmation?.action === 'revoke' ? 'These pending invitation links will stop working.' : 'This sends a fresh invitation email to each listed recipient and replaces their previous link. Email limits still apply.'}</DialogDescription></DialogHeader>
        <ul className="max-h-64 overflow-y-auto break-all text-sm">{confirmation?.rows.map(inv => <li key={inv.id}>{inv.recipientName ? `${inv.recipientName} · ` : ''}{inv.email}</li>)}</ul>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</Button><Button disabled={busy} onClick={() => void confirmActions()}>{busy ? 'Processing…' : 'Confirm'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
