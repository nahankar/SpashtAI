import { useEffect, useRef, useState } from 'react'

type Option = { value: string; label: string }
type Props = { label: string; options: Option[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }

export function MultiSelect({ label, options, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const all = options.length > 0 && options.every(o => value.includes(o.value))
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter(x => x !== v) : options.map(o => o.value).filter(x => x === v || value.includes(x)))
  const picked = options.filter(o => value.includes(o.value))
  const summary = !picked.length ? `Select ${label.toLowerCase()}` : all ? 'All' : picked.length <= 2 ? picked.map(o => o.label).join(', ') : `${picked.length} selected`
  return <div className="relative space-y-1 text-sm" ref={root}>
    <span id={`ms-${label}`}>{label}</span>
    <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={`ms-${label}`} disabled={disabled} onClick={() => setOpen(o => !o)}
      className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left disabled:opacity-50">
      <span className="truncate">{summary}</span><span aria-hidden className="ml-2 text-xs">▾</span>
    </button>
    {open && <div role="listbox" aria-multiselectable className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-background p-1 shadow-md">
      {!options.length && <p className="px-2 py-1.5 text-muted-foreground">No options available yet</p>}
      {options.length > 0 && <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 font-medium hover:bg-muted">
        <input type="checkbox" checked={all} onChange={() => onChange(all ? [] : options.map(o => o.value))} />Select all
      </label>}
      {options.map(o => <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-muted">
        <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />{o.label}
      </label>)}
    </div>}
  </div>
}
