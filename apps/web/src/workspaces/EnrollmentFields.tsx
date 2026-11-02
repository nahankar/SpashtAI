import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
export interface EnrollmentField { id: string; type: 'text' | 'dropdown' | 'radio' | 'checkbox' | 'message'; label: string; required: boolean; options: string[] }
export interface EnrollmentSettings { fields: EnrollmentField[]; email: { subject: string; message: string } }
export type EnrollmentResponses = Record<string, string | string[]>
export function EnrollmentFields({ fields, values, onChange }: { fields: EnrollmentField[]; values: EnrollmentResponses; onChange: (v: EnrollmentResponses) => void }) {
  return <div className="space-y-4">{fields.map(f => {
    const value = values[f.id]
    const title = `${f.label}${f.required ? ' *' : ''}`
    const id = `enrollment-${f.id}`
    const set = (v: string | string[]) => onChange({ ...values, [f.id]: v })
    if (f.type === 'message') return <p key={f.id} className="whitespace-pre-wrap rounded bg-muted p-3">{f.label}</p>
    if (f.type === 'text') return <div className="space-y-1.5" key={f.id}><Label htmlFor={id}>{title}</Label><Input id={id} required={f.required} maxLength={1000} value={typeof value === 'string' ? value : ''} onChange={e => set(e.target.value)} /></div>
    if (f.type === 'dropdown') return <div className="space-y-1.5" key={f.id}><Label htmlFor={id}>{title}</Label>
      <Select name={id} required={f.required} value={typeof value === 'string' && value ? value : undefined} onValueChange={set}>
        <SelectTrigger id={id} aria-label={f.label}><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>{f.options.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
      </Select></div>
    if (f.type === 'radio') return <fieldset key={f.id} className="space-y-2"><legend>{title}</legend>
      <RadioGroup name={id} required={f.required} value={typeof value === 'string' ? value : ''} onValueChange={set}>
        {f.options.map((o, i) => <div className="flex items-center gap-2" key={o}><RadioGroupItem id={`${id}-${i}`} value={o} /><Label htmlFor={`${id}-${i}`} className="font-normal">{o}</Label></div>)}
      </RadioGroup></fieldset>
    const checked = Array.isArray(value) ? value : []
    // Required as a group: only the first box is required, and only until one choice is made.
    return <fieldset key={f.id} className="space-y-2"><legend>{title}</legend>{f.options.map((o, i) => <div className="flex items-center gap-2" key={o}>
      <Checkbox id={`${id}-${i}`} name={id} value={o} required={f.required && !checked.length && i === 0} checked={checked.includes(o)}
        onCheckedChange={on => set(on === true ? [...checked, o] : checked.filter(v => v !== o))} />
      <Label htmlFor={`${id}-${i}`} className="font-normal">{o}</Label></div>)}</fieldset>
  })}</div>
}
