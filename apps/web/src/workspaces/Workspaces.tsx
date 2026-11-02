import { OwnerAccessPanel, type WorkspaceOwner } from './OwnerAccessPanel'
import { EnrollmentSettingsEditor } from './EnrollmentForm'
import { useWorkspacesEnabled } from './useWorkspacesEnabled'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { identityToken, workspaceRequest as request, type Feature, type Membership, type Workspace } from './client'
import { WorkspaceShell } from './shell/WorkspaceShell'
import { featureLabel } from './shell/model'
import { BrandingCard } from './admin/SettingsPage'

function ErrorNotice({ error }: { error: string }) { return error ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null }
function WorkspaceLogo({ workspace }: { workspace: Workspace }) {
  return workspace.logoDataUrl ? <img src={workspace.logoDataUrl} className="h-12 w-12 object-contain" alt={`${workspace.name} logo`} />
    : <span className="flex h-12 w-12 items-center justify-center rounded text-lg font-bold text-white" style={{ background: workspace.accentColor }}>{workspace.name.slice(0, 1).toUpperCase()}</span>
}
export function WorkspaceLink() {
  const enabled = useWorkspacesEnabled()
  return enabled ? <div className="mx-auto max-w-6xl px-4 py-2 text-right"><Button asChild variant="link" size="sm"><Link to="/workspaces">Workspaces</Link></Button></div> : null
}
export function WorkspaceList() {
  const [rows, setRows] = useState<Array<Workspace & { membership: Membership; path: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => { let alive = true; request<typeof rows>('/api/workspaces', identityToken()).then(data => { if (alive) setRows(data) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [])
  return <main className="mx-auto max-w-4xl space-y-5 p-6"><div><h1 className="text-3xl font-bold">Your workspaces</h1>
    <p className="mt-1 text-muted-foreground">Choose where to work. Your Personal history stays in Personal.</p></div><ErrorNotice error={error} />
    {rows.map(row => <Card key={row.id}><CardContent className="flex flex-wrap items-center gap-4 pt-6"><WorkspaceLogo workspace={row} />
      <div className="min-w-0 flex-1"><h2 className="break-words font-semibold">{row.name}</h2><p className="text-sm text-muted-foreground">{row.kind === 'PERSONAL' ? 'Personal' : `${row.membership.role.toLowerCase()} · ${row.membership.state.toLowerCase()}`}</p></div>
      {row.state === 'ACTIVE' ? <Button asChild variant={row.membership.state === 'INVITED' ? 'default' : 'outline'}><Link to={row.path}>{row.membership.state === 'INVITED' ? 'Review invitation' : 'Open'}</Link></Button> : <Badge variant="destructive">Suspended</Badge>}
    </CardContent></Card>)}
  </main>
}

export function OrganizationWorkspace() {
  const { slug = '' } = useParams()
  return <WorkspaceShell key={slug} slug={slug} />
}

/** Platform staff decide entitlements; switching one off also turns the product off for the workspace. */
function PlatformFeatures({ features, busy, onSave }: { features: Feature[]; busy: boolean; onSave: (feature: string, value: { entitled: boolean; enabled: boolean; memberDefault: boolean }) => void }) {
  const set = (row: Feature, change: Partial<Feature>) => {
    const value = { entitled: row.entitled, enabled: row.enabled, memberDefault: row.memberDefault, ...change }
    if (!value.entitled) value.enabled = false
    onSave(row.feature, value)
  }
  return <Card><CardHeader><CardTitle className="text-base">Entitlements</CardTitle><CardDescription>Products marked not yet available stay unavailable to members until their organization path is complete, whatever is set here.</CardDescription></CardHeader>
    <CardContent><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Entitled</TableHead><TableHead>Enabled</TableHead><TableHead>Default for members</TableHead></TableRow></TableHeader>
      <TableBody>{features.map(row => <TableRow key={row.feature}><TableCell className="font-medium">{featureLabel(row.feature)}</TableCell>
        <TableCell><Switch aria-label={`${row.feature} entitled`} checked={row.entitled} disabled={busy} onCheckedChange={entitled => set(row, { entitled })} /></TableCell>
        <TableCell><Switch aria-label={`${row.feature} enabled`} checked={row.enabled} disabled={busy || !row.entitled} onCheckedChange={enabled => set(row, { enabled })} /></TableCell>
        <TableCell><Switch aria-label={`${row.feature} memberDefault`} checked={row.memberDefault} disabled={busy} onCheckedChange={memberDefault => set(row, { memberDefault })} /></TableCell>
      </TableRow>)}</TableBody></Table></CardContent></Card>
}

interface PlatformWorkspace extends Workspace { members: number; features: Feature[]; owners: WorkspaceOwner[] }
const LIMITS = [['maxMembers', 'Member seats', 1], ['dailyEvaluations', 'Daily evaluations', 0], ['concurrentVoice', 'Concurrent voice sessions', 1]] as const

export function PlatformWorkspaces() {
  const [rows, setRows] = useState<PlatformWorkspace[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const [create, setCreate] = useState({ name: '', slug: '', ownerEmail: '' })
  const load = useCallback(async () => setRows(await request<PlatformWorkspace[]>('/api/admin/workspaces', identityToken())), [])
  useEffect(() => { load().catch(e => setError(e.message)) }, [load])
  async function action(path: string, method: string, body: unknown) {
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await request<{ workspace?: Workspace }>(path, identityToken(), method, body); await load()
      if (result.workspace) { setSelected(result.workspace.id); setCreate({ name: '', slug: '', ownerEmail: '' }); setNotice('Organization created. Owner acceptance is pending. No email was sent.') } else setNotice('Saved')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) }
  }
  function submitCreate(event: FormEvent) { event.preventDefault(); action('/api/admin/workspaces', 'POST', create) }
  const workspace = rows.find(row => row.id === selected)
  return <div className="space-y-5"><div><h1 className="text-3xl font-bold">Organization workspaces</h1>
    <p className="mt-1 text-muted-foreground">Each organization is configured here; no organization needs its own code.</p></div>
    <ErrorNotice error={error} />{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <Card><CardHeader><CardTitle className="text-base">Create organization</CardTitle><CardDescription>The Owner must already have a verified account. Access remains pending until they accept. No email is sent.</CardDescription></CardHeader><CardContent>
      <form className="grid gap-4 sm:grid-cols-3" onSubmit={submitCreate}>
        <div className="space-y-1.5"><Label htmlFor="org-name">Name</Label><Input id="org-name" placeholder="KLS VDIT" minLength={2} maxLength={100} required value={create.name} onChange={e => setCreate(c => ({ ...c, name: e.target.value }))} /></div>
        <div className="space-y-1.5"><Label htmlFor="org-slug">Address · /w/</Label><Input id="org-slug" placeholder="klsvdit" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={48} required value={create.slug} onChange={e => setCreate(c => ({ ...c, slug: e.target.value }))} /></div>
        <div className="space-y-1.5"><Label htmlFor="org-owner">Owner email</Label><Input id="org-owner" type="email" required value={create.ownerEmail} onChange={e => setCreate(c => ({ ...c, ownerEmail: e.target.value }))} /></div>
        <div className="sm:col-span-3"><Button type="submit" disabled={busy}>Create workspace</Button></div>
      </form>
    </CardContent></Card>
    <div className="space-y-1.5 max-w-md"><Label>Organization</Label><Select value={selected || undefined} onValueChange={setSelected}>
      <SelectTrigger aria-label="Organization"><SelectValue placeholder="Select organization" /></SelectTrigger>
      <SelectContent>{rows.map(row => <SelectItem value={row.id} key={row.id}>{row.name} · {row.state.toLowerCase()} · {row.members} members</SelectItem>)}</SelectContent></Select></div>
    {workspace && <div key={workspace.id} className="space-y-5">
      <p className="text-sm text-muted-foreground">Address: /w/{workspace.slug} · {workspace.isolationStage.replaceAll('_', ' ').toLowerCase()}</p>
      <OwnerAccessPanel name={workspace.name} slug={workspace.slug} owners={workspace.owners} disabled={busy} onSend={membershipId => request(`/api/admin/workspaces/${workspace.id}/owners/${membershipId}/send-access`, identityToken(), 'POST')} />
      <BrandingCard key={`${workspace.name}:${workspace.timeZone}:${workspace.accentColor}:${workspace.logoDataUrl?.length ?? 0}`} workspace={workspace} busy={busy} onSave={body => action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', body)} />
      <Card><CardHeader><CardTitle className="text-base">Plan limits</CardTitle><CardDescription>Enforced when members practise: seats on joining, evaluations per organization day, and concurrent voice sessions.</CardDescription></CardHeader><CardContent>
        <form key={JSON.stringify(workspace.limits)} className="grid gap-4 sm:grid-cols-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', { limits: Object.fromEntries(LIMITS.map(([key]) => [key, Number(f.get(key))])) }) }}>
          {LIMITS.map(([key, label, min]) => <div key={key} className="space-y-1.5"><Label htmlFor={`limit-${key}`}>{label}</Label><Input id={`limit-${key}`} name={key} type="number" min={min} defaultValue={workspace.limits[key]} required /></div>)}
          <div className="sm:col-span-3"><Button type="submit" disabled={busy}>Save limits</Button></div>
        </form>
      </CardContent></Card>
      <PlatformFeatures features={workspace.features} busy={busy} onSave={(feature, value) => action(`/api/admin/workspaces/${workspace.id}/features/${feature}`, 'PUT', value)} />
      <EnrollmentSettingsEditor key={JSON.stringify(workspace.enrollmentSettings)} settings={workspace.enrollmentSettings} workspaceName={workspace.name} onEmailPreview={body => request(`/api/admin/workspaces/${workspace.id}/invitations/preview`, identityToken(), 'POST', body)} busy={busy} onSave={body => action(`/api/admin/workspaces/${workspace.id}/enrollment`, 'PUT', body)} />
      <Button variant="outline" disabled={busy} onClick={() => action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', { state: workspace.state === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>{workspace.state === 'ACTIVE' ? 'Suspend workspace' : 'Reactivate workspace'}</Button>
    </div>}
  </div>
}
