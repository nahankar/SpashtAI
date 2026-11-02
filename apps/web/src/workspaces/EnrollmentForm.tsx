import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RecipientExperiencePreview, type EmailPreview } from './RecipientExperiencePreview'
import type { EnrollmentField, EnrollmentSettings } from './EnrollmentFields'
export { EnrollmentFields } from './EnrollmentFields'
export type { EnrollmentField, EnrollmentSettings, EnrollmentResponses } from './EnrollmentFields'
const inputClass = 'w-full min-w-0 rounded-md border px-3 py-2 bg-background'
export function EnrollmentSettingsEditor({ settings, onSave, busy, workspaceName, onEmailPreview }: { settings?: EnrollmentSettings; onSave: (v: EnrollmentSettings) => void; busy: boolean; workspaceName?: string; onEmailPreview?: (body: { emailContent: EnrollmentSettings['email'] }) => Promise<EmailPreview> }) {
  const [draft, setDraft] = useState<EnrollmentSettings>(settings ?? { fields: [], email: { subject: '', message: '' } })
  const update = (id: string, change: Partial<EnrollmentField>) => setDraft(d => ({ ...d, fields: d.fields.map(f => f.id === id ? { ...f, ...change } : f) }))
  return <form className="rounded-lg border p-5 space-y-4" onSubmit={e => { e.preventDefault(); onSave(draft) }}>
    <h2 className="text-xl font-semibold">Workspace signup and invitation message</h2>
    <p>These extra fields are collected when someone accepts a new email invitation, alongside their regular profile setup. Responses stay in this workspace. Changes apply to future invitations; existing links keep their original form and message.</p>
    <p className="text-sm text-muted-foreground">Ask only for information needed by your organization. Do not request passwords, payment details or sensitive identity documents.</p>
    {draft.fields.map((f, index) => <fieldset className="rounded border p-3 space-y-3" key={f.id} disabled={busy}><legend>Field {index + 1}</legend>
      <label className="block">Type<select className={inputClass} value={f.type} onChange={e => { const type = e.target.value as EnrollmentField['type']; update(f.id, { type, required: type === 'message' ? false : f.required, options: ['text', 'message'].includes(type) ? [] : f.options }) }}><option value="text">Text field</option><option value="dropdown">Dropdown</option><option value="radio">Radio buttons</option><option value="checkbox">Checkboxes</option><option value="message">Plain text message</option></select></label>
      <label className="block">{f.type === 'message' ? 'Message' : 'Label'}<textarea required maxLength={200} className={inputClass} value={f.label} onChange={e => update(f.id, { label: e.target.value })} /></label>
      {!['text', 'message'].includes(f.type) && <label className="block">Options · one per line (up to 30)<textarea required className={inputClass} value={f.options.join('\n')} onChange={e => update(f.id, { options: e.target.value.split('\n') })} /></label>}
      {f.type !== 'message' && <label className="flex gap-2"><input type="checkbox" checked={f.required} onChange={e => update(f.id, { required: e.target.checked })} />Required</label>}
      <div className="flex gap-2"><Button type="button" variant="outline" disabled={!index} onClick={() => setDraft(d => { const fields = [...d.fields]; [fields[index - 1], fields[index]] = [fields[index], fields[index - 1]]; return { ...d, fields } })}>Move up</Button><Button type="button" variant="outline" onClick={() => setDraft(d => ({ ...d, fields: d.fields.filter(row => row.id !== f.id) }))}>Remove</Button></div>
    </fieldset>)}
    <Button type="button" variant="outline" disabled={busy || draft.fields.length >= 20} onClick={() => setDraft(d => ({ ...d, fields: [...d.fields, { id: `field_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`, type: 'text', label: '', required: false, options: [] }] }))}>Add field</Button>
    <label className="block">Invitation subject (optional)<input className={inputClass} maxLength={150} value={draft.email.subject} onChange={e => setDraft(d => ({ ...d, email: { ...d.email, subject: e.target.value } }))} /></label>
    <label className="block">Invitation message (optional)<textarea rows={5} className={inputClass} maxLength={5000} value={draft.email.message} onChange={e => setDraft(d => ({ ...d, email: { ...d.email, message: e.target.value } }))} /></label>
    <p>Plain text only. The workspace identity, acceptance link, expiry and sign-in instructions are always included.</p>
    {onEmailPreview && <RecipientExperiencePreview key={JSON.stringify(draft)} workspaceName={workspaceName} fields={draft.fields} emailContent={draft.email} onEmailPreview={onEmailPreview} />}
    <Button disabled={busy}>Save signup and email settings</Button>
  </form>
}
