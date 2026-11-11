import { RecipientExperiencePreview, type EmailPreview } from './RecipientExperiencePreview'
import type { EnrollmentField } from './EnrollmentFields'
import { BulkInvitations, type BatchResult } from '@/components/admin/BulkInvitations'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Feature, Membership } from './client'
import { workspaceCall } from './shell/context'
import { featureLabel, deliveryNotice } from './shell/model'
import type { Invitation, InvitationStatus } from '@/lib/invitations'

type Row = Invitation & { role: Membership['role'] }
type Page = { items: Row[]; total: number; page: number; totalPages: number; counts: Record<InvitationStatus, number> }
type Draft = { email: string; name: string; role: Membership['role']; memberFeatures: Record<string, boolean> }
const STATUSES = ['pending', 'accepted', 'expired', 'revoked'] as const
const DELIVERY: Record<string, string> = { DEV_CAPTURED: 'Captured locally', SENT: 'Sent to mail server', FAILED: 'Not sent', SENDING: 'Sending / outcome pending' }
const INVITE_FEATURES = ['elevate', 'replay', 'interviews', 'progress_pulse', 'feedback']

export function WorkspaceInvitations({ role, features, emailContent, workspaceName, enrollmentFields, invitationLimits }: { invitationLimits?: { batchSize: number; hourlyLimit: number | null }; role: Membership['role']; features: Feature[]; emailContent?: { subject: string; message: string }; workspaceName?: string; enrollmentFields?: EnrollmentField[] }) {
  const [rows, setRows] = useState<Page | null>(null), [page, setPage] = useState(1)
  const [status, setStatus] = useState<string>('pending'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [inviteRole, setInviteRole] = useState<Membership['role']>('LEARNER')
  const [grants, setGrants] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => workspaceCall<T>(`/api/workspaces/current/invitations${path}`, method, body), [])
  const load = useCallback(() => call<Page>(`?status=${status}&page=${page}`).then(setRows), [call, status, page])
  useEffect(() => { let alive = true; call<Page>(`?status=${status}&page=${page}`).then(data => { if (alive) setRows(data) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [call, page, status])
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
    <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3"><CardTitle className="text-base">Sent invitations</CardTitle>
      <Select value={status} disabled={busy} onValueChange={v => { setStatus(v); setPage(1) }}>
        <SelectTrigger aria-label="Invitation status" className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent></Select>
    </CardHeader><CardContent>
      {rows?.items.length === 0 ? <p className="text-sm text-muted-foreground">No {status} invitations.</p> : <Table>
        <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Status</TableHead><TableHead>Email delivery</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
        <TableBody>{rows?.items.map(inv => <TableRow key={inv.id}>
          <TableCell className="break-all">{inv.email}</TableCell><TableCell>{inv.role}</TableCell>
          <TableCell><Badge variant="outline" className="capitalize">{inv.status}</Badge></TableCell><TableCell>{DELIVERY[inv.deliveryStatus]}</TableCell>
          <TableCell className="space-x-2">{(role === 'OWNER' || inv.role === 'LEARNER') && ['pending', 'expired'].includes(inv.status) && <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => action(`/${inv.id}/resend`)}>Resend</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => action(`/${inv.id}/revoke`)}>Revoke</Button></>}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      {rows && <div className="flex items-center gap-3 pt-4"><Button variant="outline" disabled={busy || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="text-sm">Page {page} of {Math.max(rows.totalPages, 1)}</span><Button variant="outline" disabled={busy || page >= rows.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button></div>}
    </CardContent></Card>
  </div>
}
