import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { type AccessPolicy } from './accessPolicy'
export function AccessPolicyFields({ value, onChange, tenant = true }: { value: AccessPolicy; onChange: (v: AccessPolicy) => void; tenant?: boolean }) {
  const id = useId()
  const [domains, setDomains] = useState(value.learnerEmailDomains.join(', '))
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-google`}>Google sign-in</Label><Switch id={`${id}-google`} checked={value.methods.google} disabled={value.methods.google && !value.methods.emailCode} onCheckedChange={google => onChange({ ...value, methods: { ...value.methods, google } })} /></div>
    <div className="flex items-center justify-between gap-4"><Label htmlFor={`${id}-email`}>Email-code sign-in</Label><Switch id={`${id}-email`} checked={value.methods.emailCode} disabled={value.methods.emailCode && !value.methods.google} onCheckedChange={emailCode => onChange({ ...value, methods: { ...value.methods, emailCode } })} /></div>
    <p className="text-xs text-muted-foreground">At least one sign-in method must remain enabled. Invitation links still allow first-time joining without a second code.</p>
    {tenant && <div className="space-y-2"><Label htmlFor={`${id}-domains`}>Allowed email domains for new Learners (optional)</Label>
      <Input id={`${id}-domains`} placeholder="klsvdit.edu.in" value={domains} onChange={e => { setDomains(e.target.value); onChange({ ...value, learnerEmailDomains: e.target.value.split(/[\s,;]+/).map(d => d.trim().toLowerCase()).filter(Boolean) }) }} />
      <p className="text-xs text-muted-foreground">Separate domains with commas. Leave blank to allow any domain. Existing memberships keep access; Owners and Admins may use any domain. Subdomains must be listed separately.</p>
    </div>}
  </div>
}
export function AccessPolicyCard({ policy, busy, onSave, tenant = true }: { policy: AccessPolicy; busy: boolean; onSave: (v: AccessPolicy) => void; tenant?: boolean }) {
  const [value, setValue] = useState(policy)
  return <Card><CardHeader><CardTitle className="text-base">Sign-in and email policy</CardTitle><CardDescription>{tenant ? 'Applies to this tenant independently of the main SpashtAI site.' : 'Applies to non-tenant SpashtAI signup and sign-in. Tenants have their own settings.'}</CardDescription></CardHeader>
    <CardContent><form className="space-y-4" onSubmit={e => { e.preventDefault(); onSave(value) }}><AccessPolicyFields value={value} onChange={setValue} tenant={tenant} /><Button disabled={busy || (!value.methods.google && !value.methods.emailCode)}>Save sign-in policy</Button></form></CardContent></Card>
}
