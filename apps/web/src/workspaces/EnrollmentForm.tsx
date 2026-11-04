import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { RecipientExperiencePreview, type EmailPreview } from './RecipientExperiencePreview'
import type { EnrollmentField, EnrollmentSettings } from './EnrollmentFields'
export { EnrollmentFields } from './EnrollmentFields'
export type { EnrollmentField, EnrollmentSettings, EnrollmentResponses } from './EnrollmentFields'
const FIELD_TYPES: Array<[EnrollmentField['type'], string]> = [['text', 'Text field'], ['dropdown', 'Dropdown'], ['radio', 'Radio buttons'], ['checkbox', 'Checkboxes'], ['message', 'Plain text message']]
export function EnrollmentSettingsEditor({ settings, onSave, busy, workspaceName, onEmailPreview }: { settings?: EnrollmentSettings; onSave: (v: EnrollmentSettings) => void; busy: boolean; workspaceName?: string; onEmailPreview?: (body: { emailContent: EnrollmentSettings['email'] }) => Promise<EmailPreview> }) {
  const [draft, setDraft] = useState<EnrollmentSettings>(settings ?? { fields: [], email: { subject: '', message: '' } })
  const update = (id: string, change: Partial<EnrollmentField>) => setDraft(d => ({ ...d, fields: d.fields.map(f => f.id === id ? { ...f, ...change } : f) }))
  return <form className="rounded-lg border p-5 space-y-4" onSubmit={e => { e.preventDefault(); onSave(draft) }}>
    <h2 className="text-xl font-semibold">Workspace signup and invitation message</h2>
    <p>These extra fields are collected when someone accepts a new email invitation, alongside their regular profile setup. Responses stay in this workspace. Changes apply to future invitations; existing links keep their original form and message.</p>
    <p className="text-sm text-muted-foreground">Ask only for information needed by your organization. Do not request passwords, payment details or sensitive identity documents.</p>
    {draft.fields.map((f, index) => <fieldset className="rounded border p-3 space-y-3" key={f.id} disabled={busy}><legend>Field {index + 1}</legend>
      <div className="space-y-1.5"><Label>Type</Label><Select value={f.type} onValueChange={value => { const type = value as EnrollmentField['type']; update(f.id, { type, required: type === 'message' ? false : f.required, options: ['text', 'message'].includes(type) ? [] : f.options }) }}>
        <SelectTrigger aria-label={`Field ${index + 1} type`}><SelectValue /></SelectTrigger>
        <SelectContent>{FIELD_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="space-y-1.5"><Label htmlFor={`${f.id}-label`}>{f.type === 'message' ? 'Message' : 'Label'}</Label><Textarea id={`${f.id}-label`} required maxLength={200} value={f.label} onChange={e => update(f.id, { label: e.target.value })} /></div>
      {!['text', 'message'].includes(f.type) && <div className="space-y-1.5"><Label htmlFor={`${f.id}-options`}>Options · one per line (up to 30)</Label><Textarea id={`${f.id}-options`} required value={f.options.join('\n')} onChange={e => update(f.id, { options: e.target.value.split('\n') })} /></div>}
      {f.type !== 'message' && <div className="flex items-center gap-2"><Checkbox id={`${f.id}-required`} checked={f.required} onCheckedChange={value => update(f.id, { required: value === true })} /><Label htmlFor={`${f.id}-required`}>Required</Label></div>}
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={!index} onClick={() => setDraft(d => { const fields = [...d.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; return { ...d, fields } })}>Move up</Button><Button type="button" variant="outline" onClick={() => setDraft(d => ({ ...d, fields: d.fields.filter(row => row.id !== f.id) }))}>Remove</Button></div>
    </fieldset>)}
    <Button type="button" variant="outline" disabled={busy || draft.fields.length >= 20} onClick={() => setDraft(d => ({ ...d, fields: [...d.fields, { id: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`, type: 'text', label: '', required: false, options: [] }] }))}>Add field</Button>
    <div className="space-y-1.5"><Label htmlFor="enrollment-subject">Invitation subject (optional)</Label><Input id="enrollment-subject" maxLength={150} value={draft.email.subject} onChange={e => setDraft(d => ({ ...d, email: { ...d.email, subject: e.target.value } }))} /></div>
    <div className="space-y-1.5"><Label htmlFor="enrollment-message">Invitation message</Label><Textarea id="enrollment-message" rows={5} maxLength={5000} value={draft.email.message} onChange={e => setDraft(d => ({ ...d, email: { ...d.email, message: e.target.value } }))} placeholder="This is the email body the recipient reads." /></div>
    <p>This message is the email body. SpashtAI only adds the Accept invitation button and the expiry notice.</p>
    {onEmailPreview && <RecipientExperiencePreview key={JSON.stringify(draft)} workspaceName={workspaceName} fields={draft.fields} emailContent={draft.email} onEmailPreview={onEmailPreview} />}
    <Button disabled={busy}>Save signup and email settings</Button>
  </form>
}
