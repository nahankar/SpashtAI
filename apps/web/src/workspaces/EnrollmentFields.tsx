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
