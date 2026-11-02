import { useWorkspacesEnabled } from './useWorkspacesEnabled'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { identityToken, workspaceRequest as request, type Entry, type Feature, type Membership, type Snapshot, type Workspace } from './client'

const inputClass = 'rounded-md border px-3 py-2 min-w-0 w-full bg-background'
function ErrorNotice({ error }: { error: string }) { return error ? <p role="alert" className="rounded border border-red-300 p-3 text-red-700">{error}</p> : null }
function WorkspaceLogo({ workspace }: { workspace: Workspace }) {
  return workspace.logoDataUrl ? <img src={workspace.logoDataUrl} className="h-12 w-12 object-contain" alt={`${workspace.name} logo`} /> : null
}
export function WorkspaceLink() {
  const enabled = useWorkspacesEnabled()
  return enabled ? <div className="mx-auto max-w-6xl px-4 py-2 text-right"><a href="/workspaces" className="underline">Workspaces</a></div> : null
}
export function WorkspaceList() {
  const [rows, setRows] = useState<Array<Workspace & { membership: Membership; path: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => { let alive = true; request<typeof rows>('/api/workspaces', identityToken()).then(data => { if (alive) setRows(data) }).catch(e => { if (alive) setError(e.message) }); return () => { alive = false } }, [])
  return <main className="mx-auto max-w-4xl p-6 space-y-5"><h1 className="text-3xl font-bold">Your workspaces</h1>
    <p>Choose where to work. Your Personal history stays in Personal.</p><ErrorNotice error={error} />
    {rows.map(row => <div key={row.id} className="flex flex-wrap items-center gap-4 rounded-lg border p-4"><WorkspaceLogo workspace={row} /><div className="flex-1 min-w-0"><h2 className="font-semibold break-words">{row.name}</h2><p>{row.membership.role} · {row.membership.state}</p></div>
      {row.state === 'ACTIVE' ? <a className="underline" href={row.path}>{row.membership.state === 'INVITED' ? 'Review invitation' : 'Open workspace'}</a> : <span>Suspended</span>}</div>)}
  </main>
}

interface Member extends Membership { name: string; email: string; features: Array<{ feature: string; allowed: boolean }> }
export function OrganizationWorkspace() {
  const { slug = '' } = useParams()
  return <OrganizationContent key={slug} slug={slug} />
}
function OrganizationContent({ slug }: { slug: string }) {
  // Tokens remain in this tab's component memory, never a shared localStorage context.
  const [entry, setEntry] = useState<Entry | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const load = useCallback(async () => {
    const next = await request<Entry>(`/api/workspaces/entry/${encodeURIComponent(slug)}`, identityToken(), 'POST')
    if (next.workspace.kind !== 'ORGANIZATION') throw new Error('Open Personal from Your workspaces')
    setEntry(next)
    if (next.accessToken) {
      const state = await request<Snapshot>('/api/workspaces/current', next.accessToken)
      setSnapshot(state)
      setMembers(state.membership.role === 'LEARNER' ? [] : await request<Member[]>('/api/workspaces/current/members', next.accessToken))
    }
  }, [slug])
  useEffect(() => { setEntry(null); setSnapshot(null); setMembers([]); setError(''); load().catch(e => setError(e.message)) }, [load])
  async function action(work: () => Promise<unknown>) {
    setBusy(true); setError(''); setNotice('')
    try { await work(); await load(); setNotice('Saved') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) }
  }
  // Each mutation exchanges identity for fresh, membership-checked workspace access.
  async function mutate(path: string, method: string, body: unknown) {
    const current = await request<Entry>(`/api/workspaces/entry/${encodeURIComponent(slug)}`, identityToken(), 'POST')
    if (!current.accessToken) throw new Error('Accept your workspace invitation first')
    return request(path, current.accessToken, method, body)
  }
  const manager = snapshot && snapshot.membership.role !== 'LEARNER'
  return <main className="mx-auto max-w-5xl p-6 space-y-6" key={slug}>
    <header style={{ borderColor: entry?.workspace.accentColor }} className="flex flex-wrap gap-4 items-center border-b-4 pb-4"><a href="/workspaces" className="underline">Switch workspace</a><a href="/coach" className="underline">Personal</a></header>
    <ErrorNotice error={error} />{notice && <p role="status">{notice}</p>}
    {entry && <><div className="flex items-center gap-4"><WorkspaceLogo workspace={entry.workspace} /><div><h1 className="text-3xl font-bold break-words">{entry.workspace.name}</h1><p>{entry.membership.role} · {entry.workspace.timeZone}</p></div></div>
      <p className="rounded-lg bg-amber-50 text-amber-950 p-4">{entry.notice}</p>
      {entry.membership.state === 'INVITED' && <section className="border rounded-lg p-5 space-y-3"><h2 className="text-xl font-semibold">Workspace invitation</h2><p>Accept to join {entry.workspace.name} as {entry.membership.role}. Your Personal records will stay private.</p><Button disabled={busy} onClick={() => action(() => request(`/api/workspaces/entry/${encodeURIComponent(slug)}/accept`, identityToken(), 'POST'))}>Accept invitation</Button></section>}
    </>}
    {snapshot && <>
      {snapshot.counts && <section className="grid sm:grid-cols-3 gap-3" aria-label="Membership overview">{Object.entries(snapshot.counts).map(([label, count]) => <div className="border rounded p-4" key={label}><p className="capitalize">{label}</p><strong className="text-2xl">{count}</strong></div>)}</section>}
      {manager && <>
        <BrandingForm workspace={snapshot.workspace} busy={busy} onSave={body => action(() => mutate('/api/workspaces/current/branding', 'PATCH', body))} />
        <section className="rounded-lg border p-5 space-y-4"><h2 className="text-xl font-semibold">Members</h2><p>Email invitations are not connected yet. You can add an existing verified account; that person accepts from Your workspaces. No email is sent.</p>
          <form className="flex flex-wrap gap-3" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const f = new FormData(event.currentTarget); action(() => mutate('/api/workspaces/current/members', 'POST', { email: f.get('email'), role: f.get('role') })) }}>
            <label className="flex-1 min-w-48">Email<input name="email" type="email" required className={inputClass} /></label><label>Role<select name="role" className={inputClass}><option>LEARNER</option>{snapshot.membership.role === 'OWNER' && <><option>ADMIN</option><option>OWNER</option></>}</select></label><Button disabled={busy} className="self-end">Add existing account</Button></form>
          <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th className="p-2">Member</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead><tbody>{members.map(member => <tr key={member.id} className="border-t"><td className="p-2 break-all">{member.name}<br />{member.email}</td><td><select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy || (snapshot.membership.role !== 'OWNER' && member.role !== 'LEARNER')} onChange={e => action(() => mutate(`/api/workspaces/current/members/${member.id}`, 'PATCH', { role: e.target.value }))}><option>LEARNER</option><option>ADMIN</option><option>OWNER</option></select></td><td>{member.state}</td><td>{member.state !== 'INVITED' && <Button variant="outline" disabled={busy || (snapshot.membership.role !== 'OWNER' && member.role !== 'LEARNER')} onClick={() => action(() => mutate(`/api/workspaces/current/members/${member.id}`, 'PATCH', { state: member.state === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' }))}>{member.state === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}</Button>}</td></tr>)}</tbody></table></div>
          <details className="border rounded p-3"><summary className="cursor-pointer font-semibold">Individual feature access</summary><p className="my-3">An individual setting cannot grant access beyond the organization entitlement.</p>{members.map(member => <details className="border-t p-2" key={member.id}><summary>{member.name || member.email}</summary><div className="grid sm:grid-cols-2 gap-3 p-3">{snapshot.features.map(feature => <label key={feature.feature}>{feature.feature.replaceAll('_', ' ')}<select className={inputClass} aria-label={`${member.email} ${feature.feature} access`} value={String(member.features.find(f => f.feature === feature.feature)?.allowed ?? 'default')} disabled={busy || (snapshot.membership.role !== 'OWNER' && member.role !== 'LEARNER')} onChange={e => action(() => mutate(`/api/workspaces/current/members/${member.id}/features/${feature.feature}`, 'PUT', { allowed: e.target.value === 'default' ? null : e.target.value === 'true' }))}><option value="default">Organization default</option><option value="false">Disabled</option><option value="true" disabled={!feature.entitled}>Allowed within entitlement</option></select></label>)}</div></details>)}</details>
        </section>
      </>}
      <FeatureSettings features={snapshot.features} busy={busy} manager={Boolean(manager)} onSave={(feature, value) => action(() => mutate(`/api/workspaces/current/features/${feature}`, 'PUT', value))} />
    </>}
  </main>
}

function BrandingForm({ workspace, busy, onSave }: { workspace: Workspace; busy: boolean; onSave: (body: unknown) => void }) {
  const [logo, setLogo] = useState<string | null>(workspace.logoDataUrl)
  const [error, setError] = useState('')
  useEffect(() => setLogo(workspace.logoDataUrl), [workspace.logoDataUrl])
  return <form key={workspace.id} className="rounded-lg border p-5 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); onSave({ name: f.get('name'), timeZone: f.get('timeZone'), accentColor: f.get('accentColor'), logoDataUrl: logo }) }}>
    <h2 className="text-xl font-semibold">Workspace branding</h2><div className="grid sm:grid-cols-2 gap-3"><label>Name<input name="name" defaultValue={workspace.name} required minLength={2} maxLength={100} className={inputClass} /></label><label>Time zone<input name="timeZone" defaultValue={workspace.timeZone} required className={inputClass} /></label><label>Accent color<input name="accentColor" type="color" defaultValue={workspace.accentColor} className="block h-10" /></label><label>Logo · PNG, JPEG or WebP, up to 64 KB<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { const file = e.target.files?.[0]; setError(''); if (!file) return; if (file.size > 65536) { setError('Choose a logo up to 64 KB'); return }; const reader = new FileReader(); reader.onload = () => setLogo(String(reader.result)); reader.readAsDataURL(file) }} /></label></div>
    <ErrorNotice error={error} /><Button type="button" variant="outline" onClick={() => { setLogo(null); setError('') }}>Remove logo</Button>{logo && <img alt="Logo preview" src={logo} className="h-14 w-14 object-contain" />}<Button disabled={busy || Boolean(error)}>Save branding</Button>
  </form>
}
function FeatureSettings({ features, busy, manager, onSave, platform = false }: { features: Feature[]; busy: boolean; manager: boolean; platform?: boolean; onSave: (feature: string, value: unknown) => void }) {
  return <section className="border rounded-lg p-5 space-y-3"><h2 className="text-xl font-semibold">Feature configuration</h2><p>Settings are saved for the workspace. Product access stays unavailable until isolation work is complete.</p>
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Feature</th><th>Entitled</th><th>Enabled</th><th>Default for members</th></tr></thead><tbody>{features.map(row => <tr className="border-t" key={row.feature}><td className="py-3">{row.feature.replaceAll('_', ' ')}</td>{(['entitled', 'enabled', 'memberDefault'] as const).map(field => <td key={field}><input type="checkbox" aria-label={`${row.feature} ${field}`} checked={row[field]} disabled={busy || !manager || (field === 'entitled' && !platform) || (field === 'enabled' && !row.entitled)} onChange={e => { const value = { entitled: row.entitled, enabled: row.enabled, memberDefault: row.memberDefault, [field]: e.target.checked }; if (!value.entitled) value.enabled = false; onSave(row.feature, platform ? value : { enabled: value.enabled, memberDefault: value.memberDefault }) }} /></td>)}</tr>)}</tbody></table></div>
  </section>
}

interface PlatformWorkspace extends Workspace { members: number; features: Feature[] }
export function PlatformWorkspaces() {
  const [rows, setRows] = useState<PlatformWorkspace[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => setRows(await request<PlatformWorkspace[]>('/api/admin/workspaces', identityToken())), [])
  useEffect(() => { load().catch(e => setError(e.message)) }, [load])
  async function action(path: string, method: string, body: unknown) { setBusy(true); setError(''); setNotice(''); try { const result = await request<{ workspace?: Workspace }>(path, identityToken(), method, body); await load(); if (result.workspace) { setSelected(result.workspace.id); setNotice('Organization created. Owner acceptance is pending. No email was sent.') } else setNotice('Saved') } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) } }
  const workspace = rows.find(row => row.id === selected)
  return <div className="space-y-5"><h1 className="text-3xl font-bold">Organization workspaces</h1><p>Foundation preview. Creating an organization does not enable learner practices or analytics.</p><ErrorNotice error={error} />{notice && <p role="status">{notice}</p>}
    <form className="rounded-lg border p-5 space-y-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); action('/api/admin/workspaces', 'POST', { name: f.get('name'), slug: f.get('slug'), ownerEmail: f.get('ownerEmail') }) }}>
      <h2 className="text-xl font-semibold">Create organization</h2><div className="grid sm:grid-cols-3 gap-3"><label>Name<input name="name" placeholder="KLS VDIT" minLength={2} maxLength={100} required className={inputClass} /></label><label>Address · /w/<input name="slug" placeholder="kls-vdit" pattern="[a-z0-9]+(-[a-z0-9]+)*" minLength={3} maxLength={48} required className={inputClass} /></label><label>Owner email<input name="ownerEmail" type="email" required className={inputClass} /></label></div><p>The Owner must already have a verified account. Access remains pending until they accept. No email is sent.</p><Button disabled={busy}>Create workspace</Button>
    </form>
    <section className="space-y-3"><label>Organization<select className={inputClass} value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select organization</option>{rows.map(row => <option value={row.id} key={row.id}>{row.name} · {row.state} · {row.members} members</option>)}</select></label></section>
    {workspace && <><p>Address: /w/{workspace.slug} · {workspace.isolationStage.replaceAll('_', ' ')}</p><BrandingForm workspace={workspace} busy={busy} onSave={body => action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', body)} />
      <form key={workspace.id} className="border rounded-lg p-5 space-y-3" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', { limits: { maxMembers: Number(f.get('maxMembers')), dailyEvaluations: Number(f.get('dailyEvaluations')), concurrentVoice: Number(f.get('concurrentVoice')) } }) }}><h2 className="text-xl font-semibold">Configured limits</h2><p>Practice quotas will take effect when organization product access is implemented.</p><div className="grid sm:grid-cols-3 gap-3">{(['maxMembers', 'dailyEvaluations', 'concurrentVoice'] as const).map(key => <label key={key}>{({maxMembers:'Member seats', dailyEvaluations:'Daily evaluations', concurrentVoice:'Concurrent voice sessions'})[key]}<input className={inputClass} name={key} type="number" min={key === 'dailyEvaluations' ? 0 : 1} defaultValue={workspace.limits[key]} required /></label>)}</div><Button disabled={busy}>Save limits</Button></form>
      <FeatureSettings features={workspace.features} busy={busy} manager platform onSave={(feature, value) => action(`/api/admin/workspaces/${workspace.id}/features/${feature}`, 'PUT', value)} />
      <Button variant="outline" disabled={busy} onClick={() => action(`/api/admin/workspaces/${workspace.id}`, 'PATCH', { state: workspace.state === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>{workspace.state === 'ACTIVE' ? 'Suspend workspace' : 'Reactivate workspace'}</Button>
    </>}
  </div>
}
