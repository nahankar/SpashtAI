import { useCallback, useEffect, useState } from 'react'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { EnrollmentField, EnrollmentResponses } from '../EnrollmentFields'
import type { Feature, Membership } from '../client'
import { useWorkspaceShell, workspaceCall } from '../shell/context'
import { featureLabel, canManage } from '../shell/model'
import { EmptyState, ErrorAlert, Loading, PageHeader } from './parts'

interface Member extends Membership {
  name: string; email: string; acceptedAt: string | null
  enrollmentFields: EnrollmentField[]; enrollmentResponses: EnrollmentResponses
  features: Array<{ feature: string; allowed: boolean }>
}
interface MemberPage { items: Member[]; nextCursor: string | null; total: number }
const ALL = 'all'
const ROLES: Membership['role'][] = ['LEARNER', 'ADMIN', 'OWNER']
const STATES: Membership['state'][] = ['ACTIVE', 'INVITED', 'SUSPENDED']
const words = (value: string) => value.charAt(0) + value.slice(1).toLowerCase()
/** Member-level grants only for products a learner uses; plan tiers and exports are organization settings. */
const MEMBER_FEATURES = ['elevate', 'replay', 'interviews', 'progress_pulse', 'feedback']

export function WorkspaceUsers() {
  const { snapshot } = useWorkspaceShell()
  const actor = snapshot.membership.role
  const [q, setQ] = useState(''), [role, setRole] = useState<string>(), [state, setState] = useState<string>()
  const [pages, setPages] = useState<MemberPage[]>([])
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false)
  const query = useCallback((after?: string) => new URLSearchParams(Object.entries({ q: q.trim() || undefined, role, state, after })
    .filter(([, v]) => v) as Array<[string, string]>).toString(), [q, role, state])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setPages([await workspaceCall<MemberPage>(`/api/workspaces/current/members?${query()}`)]) }
    catch (e) { setPages([]); setError(e instanceof Error ? e.message : 'Unable to load members') } finally { setLoading(false) }
  }, [query])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  async function more() {
    const cursor = pages.at(-1)?.nextCursor
    if (!cursor) return
    setLoading(true)
    try { const page = await workspaceCall<MemberPage>(`/api/workspaces/current/members?${query(cursor)}`); setPages(p => [...p, page]) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load members') } finally { setLoading(false) }
  }
  async function change(path: string, method: string, body: unknown, done: string) {
    setBusy(true); setError(''); setNotice('')
    try { await workspaceCall(path, method, body); setNotice(done); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) }
  }
  const items = pages.flatMap(p => p.items)
  return <div className="space-y-5">
    <PageHeader title="Users" description={`${pages[0]?.total ?? 0} members. Workspace roles apply only inside ${snapshot.workspace.name}.`} />
    <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4">
      <div className="space-y-1.5"><Label htmlFor="member-search">Search</Label><Input id="member-search" placeholder="Name or email" value={q} onChange={e => setQ(e.target.value)} className="w-64" /></div>
      <div className="space-y-1.5"><Label>Role</Label><Select value={role ?? ALL} onValueChange={v => setRole(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label="Role filter" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All roles</SelectItem>{ROLES.map(r => <SelectItem key={r} value={r}>{words(r)}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label>Status</Label><Select value={state ?? ALL} onValueChange={v => setState(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label="Status filter" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All statuses</SelectItem>{STATES.map(s => <SelectItem key={s} value={s}>{words(s)}</SelectItem>)}</SelectContent></Select></div>
    </div>
    <ErrorAlert error={error} />{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <Card><CardContent className="pt-6">
      {loading && !items.length ? <Loading /> : items.length === 0 ? <EmptyState>No members match these filters.</EmptyState> :
        <Accordion type="multiple" className="w-full">{items.map(member => <MemberRow key={member.id} member={member} actor={actor} features={snapshot.features} busy={busy} change={change} />)}</Accordion>}
      {pages.at(-1)?.nextCursor && <div className="pt-4"><Button variant="outline" disabled={loading} onClick={more}>Load more</Button></div>}
    </CardContent></Card>
  </div>
}

function MemberRow({ member, actor, features, busy, change }: {
  member: Member; actor: Membership['role']; features: Feature[]; busy: boolean
  change: (path: string, method: string, body: unknown, done: string) => Promise<void>
}) {
  const editable = canManage(actor, member.role)
  const path = `/api/workspaces/current/members/${member.id}`
  const fields = (member.enrollmentFields ?? []).filter(f => f.type !== 'message')
  return <AccordionItem value={member.id}>
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1"><p className="truncate font-medium">{member.name || member.email}</p><p className="truncate text-sm text-muted-foreground">{member.email}</p></div>
      <Badge variant={member.state === 'ACTIVE' ? 'success' : member.state === 'SUSPENDED' ? 'destructive' : 'secondary'}>{words(member.state)}</Badge>
      <Select value={member.role} disabled={busy || !editable} onValueChange={value => change(path, 'PATCH', { role: value }, `Role updated for ${member.email}.`)}>
        <SelectTrigger aria-label={`Role for ${member.email}`} className="w-32"><SelectValue /></SelectTrigger>
        <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r} disabled={r !== 'LEARNER' && actor !== 'OWNER'}>{words(r)}</SelectItem>)}</SelectContent>
      </Select>
      {member.state !== 'INVITED' && (member.state === 'SUSPENDED'
        ? <Button variant="outline" size="sm" disabled={busy || !editable} onClick={() => change(path, 'PATCH', { state: 'ACTIVE' }, `${member.email} can use the workspace again.`)}>Reactivate</Button>
        : <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="outline" size="sm" disabled={busy || !editable}>Suspend</Button></AlertDialogTrigger>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Suspend {member.name || member.email}?</AlertDialogTitle>
            <AlertDialogDescription>{`They lose access to this workspace immediately, including any practice in progress. Their previous Personal history stays preserved, and this email remains organization-only.`}</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => change(path, 'PATCH', { state: 'SUSPENDED' }, `${member.email} was suspended.`)}>Suspend</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>)}
      <AccordionTrigger className="flex-none py-0" aria-label={`Details for ${member.email}`} />
    </div>
    <AccordionContent>
      <div className="grid gap-6 pb-2 lg:grid-cols-2">
        <section className="space-y-2"><h3 className="text-sm font-semibold">Product access</h3>
          <p className="text-xs text-muted-foreground">An individual setting cannot grant more than the organization plan includes.</p>
          {features.filter(f => MEMBER_FEATURES.includes(f.feature)).map(feature => {
            const override = member.features.find(f => f.feature === feature.feature)?.allowed
            return <div key={feature.feature} className="flex items-center justify-between gap-3">
              <Label>{featureLabel(feature.feature)}</Label>
              <Select value={override === undefined ? 'default' : String(override)} disabled={busy || !editable}
                onValueChange={value => change(`${path}/features/${feature.feature}`, 'PUT', { allowed: value === 'default' ? null : value === 'true' }, `Access updated for ${member.email}.`)}>
                <SelectTrigger aria-label={`${member.email} ${feature.feature} access`} className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="default">Organization default</SelectItem><SelectItem value="false">Turned off</SelectItem><SelectItem value="true" disabled={!feature.entitled}>Allowed within plan</SelectItem></SelectContent>
              </Select>
            </div>
          })}
        </section>
        <section className="space-y-2"><h3 className="text-sm font-semibold">Workspace details</h3>
          {fields.length === 0 ? <p className="text-sm text-muted-foreground">No signup details were collected.</p> : <dl className="space-y-2 text-sm">{fields.map(f => {
            const value = member.enrollmentResponses?.[f.id]
            return <div key={f.id}><dt className="font-medium">{f.label}</dt><dd className="whitespace-pre-wrap text-muted-foreground">{Array.isArray(value) ? value.join(', ') : value || '—'}</dd></div>
          })}</dl>}
        </section>
      </div>
    </AccordionContent>
  </AccordionItem>
}
