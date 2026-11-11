import { AccessPolicyCard } from '../AccessPolicyCard'
import { defaultAccessPolicy } from '../accessPolicy'
import { useState, type FormEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EnrollmentSettingsEditor } from '../EnrollmentForm'
import type { EmailPreview } from '../RecipientExperiencePreview'
import type { Feature, Workspace } from '../client'
import { useWorkspaceShell, workspaceCall } from '../shell/context'
import { featureLabel, timeZones } from '../shell/model'
import { ErrorAlert, PageHeader, StatCard } from './parts'

export function WorkspaceSettings() {
  const { snapshot, reload } = useWorkspaceShell()
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  async function save(path: string, method: string, body: unknown, done = 'Saved.') {
    setBusy(true); setError(''); setNotice('')
    try { await workspaceCall(path, method, body); await reload(); setNotice(done) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to save') } finally { setBusy(false) }
  }
  const { workspace } = snapshot
  return <div className="space-y-5">
    <PageHeader title="Workspace settings" description="Changes apply to this workspace only." />
    <ErrorAlert error={error} />{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <BrandingCard key={`${workspace.id}:${workspace.name}:${workspace.timeZone}:${workspace.accentColor}:${workspace.logoDataUrl?.length ?? 0}`} workspace={workspace} busy={busy}
      onSave={body => save('/api/workspaces/current/branding', 'PATCH', body, 'Branding saved.')} />
    <AccessPolicyCard key={JSON.stringify(workspace.accessPolicy)} policy={workspace.accessPolicy ?? defaultAccessPolicy} busy={busy} onSave={body => save('/api/workspaces/current/access-policy', 'PUT', body, 'Sign-in policy saved.')} />
    <FeaturesCard features={snapshot.features} busy={busy} onSave={(feature, body) => save(`/api/workspaces/current/features/${feature}`, 'PUT', body, `${featureLabel(feature)} updated.`)} />
    <EnrollmentSettingsEditor key={JSON.stringify(workspace.enrollmentSettings)} settings={workspace.enrollmentSettings} workspaceName={workspace.name} busy={busy}
      onEmailPreview={body => workspaceCall<EmailPreview>('/api/workspaces/current/invitations/preview', 'POST', body)}
      onSave={body => save('/api/workspaces/current/enrollment', 'PUT', body, 'Signup and email settings saved.')} />
    <Card><CardHeader><CardTitle className="text-base">Plan limits</CardTitle><CardDescription>Set by SpashtAI for your organization. Contact SpashtAI to change them.</CardDescription></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Member seats" value={workspace.limits.maxMembers} />
        <StatCard label="Daily evaluations" value={workspace.limits.dailyEvaluations} />
        <StatCard label="Concurrent voice sessions" value={workspace.limits.concurrentVoice} />
      </CardContent></Card>
  </div>
}

export function BrandingCard({ workspace, busy, onSave }: { workspace: Workspace; busy: boolean; onSave: (body: unknown) => void }) {
  const [name, setName] = useState(workspace.name), [timeZone, setTimeZone] = useState(workspace.timeZone)
  const [accentColor, setAccent] = useState(workspace.accentColor), [logo, setLogo] = useState<string | null>(workspace.logoDataUrl)
  const [error, setError] = useState('')
  function submit(event: FormEvent) { event.preventDefault(); onSave({ name, timeZone, accentColor, logoDataUrl: logo }) }
  return <Card><CardHeader><CardTitle className="text-base">Branding and calendar</CardTitle>
    <CardDescription>The time zone sets the calendar day used for daily limits and every report.</CardDescription></CardHeader>
    <CardContent><form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="ws-name">Name</Label><Input id="ws-name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={100} /></div>
        <div className="space-y-1.5"><Label>Time zone</Label><Select value={timeZone} onValueChange={setTimeZone}>
          <SelectTrigger aria-label="Time zone"><SelectValue /></SelectTrigger>
          <SelectContent className="max-h-72">{timeZones(workspace.timeZone).map(zone => <SelectItem key={zone} value={zone}>{zone}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1.5"><Label htmlFor="ws-accent">Accent colour</Label><Input id="ws-accent" type="color" value={accentColor} onChange={e => setAccent(e.target.value)} className="h-10 w-20 p-1" /></div>
        <div className="space-y-1.5"><Label htmlFor="ws-logo">Logo · PNG, JPEG or WebP, up to 64 KB</Label>
          <Input id="ws-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={e => {
            const file = e.target.files?.[0]; setError('')
            if (!file) return
            if (file.size > 65536) { setError('Choose a logo up to 64 KB'); return }
            const reader = new FileReader(); reader.onload = () => setLogo(String(reader.result)); reader.readAsDataURL(file)
          }} /></div>
      </div>
      <ErrorAlert error={error} />
      <div className="flex flex-wrap items-center gap-3">
        {logo && <img alt="Logo preview" src={logo} className="h-12 w-12 rounded object-contain" />}
        {logo && <Button type="button" variant="outline" onClick={() => setLogo(null)}>Remove logo</Button>}
        <Button type="submit" disabled={busy || Boolean(error)}>Save branding</Button>
      </div>
    </form></CardContent></Card>
}

/** Owners and Admins switch included products on and set the member default; entitlement and readiness are fixed. */
export function FeaturesCard({ features, busy, onSave }: { features: Feature[]; busy: boolean; onSave: (feature: string, body: { enabled: boolean; memberDefault: boolean }) => void }) {
  return <Card><CardHeader><CardTitle className="text-base">Products</CardTitle>
    <CardDescription>Only products in your organization plan can be turned on. A product marked not yet available cannot be used until SpashtAI completes it for organizations.</CardDescription></CardHeader>
    <CardContent><Table>
      <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Plan</TableHead><TableHead>On for workspace</TableHead><TableHead>On for new members</TableHead></TableRow></TableHeader>
      <TableBody>{features.map(f => <TableRow key={f.feature}>
        <TableCell className="font-medium">{featureLabel(f.feature)}{f.ready === false && <Badge variant="secondary" className="ml-2">Not yet available</Badge>}</TableCell>
        <TableCell>{f.entitled ? <Badge variant="success">Included</Badge> : <Badge variant="outline">Not included</Badge>}</TableCell>
        <TableCell><Switch aria-label={`${f.feature} enabled`} checked={f.enabled} disabled={busy || !f.entitled} onCheckedChange={enabled => onSave(f.feature, { enabled, memberDefault: f.memberDefault })} /></TableCell>
        <TableCell><Switch aria-label={`${f.feature} member default`} checked={f.memberDefault} disabled={busy || !f.entitled} onCheckedChange={memberDefault => onSave(f.feature, { enabled: f.enabled, memberDefault })} /></TableCell>
      </TableRow>)}</TableBody>
    </Table></CardContent></Card>
}
