import { useState } from 'react'
import { Button } from '@/components/ui/button'
export interface EnrollmentField { id: string; type: 'text' | 'dropdown' | 'radio' | 'checkbox' | 'message'; label: string; required: boolean; options: string[] }
export interface EnrollmentSettings { fields: EnrollmentField[]; email: { subject: string; message: string } }
export type EnrollmentResponses = Record<string, string | string[]>
const inputClass = 'w-full min-w-0 rounded-md border px-3 py-2 bg-background'
export function EnrollmentFields({ fields, values, onChange }: { fields: EnrollmentField[]; values: EnrollmentResponses; onChange: (v: EnrollmentResponses) => void }) {
  return <div className="space-y-4">{fields.map(f => {
    const value = values[f.id]
    const title = `${f.label}${f.required ? ' *' : ''}`
    const set = (v: string | string[]) => onChange({ ...values, [f.id]: v })
    if (f.type === 'message') return <p key={f.id} className="whitespace-pre-wrap rounded bg-muted p-3">{f.label}</p>
    if (f.type === 'text') return <label className="block" key={f.id}>{title}<input className={inputClass} required={f.required} maxLength={1000} value={typeof value === 'string' ? value : ''} onChange={e => set(e.target.value)} /></label>
    if (f.type === 'dropdown') return <label className="block" key={f.id}>{title}<select className={inputClass} required={f.required} value={typeof value === 'string' ? value : ''} onChange={e => set(e.target.value)}><option value="">Choose…</option>{f.options.map(o => <option key={o}>{o}</option>)}</select></label>
    const checked = Array.isArray(value) ? value : []
    return <fieldset key={f.id} className="space-y-2"><legend>{title}</legend>{f.options.map((o, i) => <label className="flex gap-2 items-center" key={o}><input type={f.type === 'radio' ? 'radio' : 'checkbox'} name={`enrollment-${f.id}`} required={f.required && (f.type === 'radio' || (!checked.length && i === 0))} checked={f.type === 'radio' ? value === o : checked.includes(o)} onChange={e => set(f.type === 'radio' ? o : e.target.checked ? [...checked, o] : checked.filter(v => v !== o))} />{o}</label>)}</fieldset>
  })}</div>
}
export function EnrollmentSettingsEditor({ settings, onSave, busy }: { settings?: EnrollmentSettings; onSave: (v: EnrollmentSettings) => void; busy: boolean }) {
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
    <details><summary>Message preview</summary><div className="whitespace-pre-wrap border rounded p-3"><strong>{draft.email.subject || 'Default invitation subject'}</strong><p>{draft.email.message || 'Default invitation message'}</p><p>[Accept invitation link and sign-in instructions]</p></div></details>
    <Button disabled={busy}>Save signup and email settings</Button>
  </form>
}
