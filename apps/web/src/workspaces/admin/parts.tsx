import { useState, type ReactNode } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PULSE_SKILL_BLOCKS } from '@/lib/pulse-skills'
import { useWorkspaceData } from '../shell/context'
import { PERIODS, PRODUCTS, type AnalyticsFilters } from '../shell/model'

const ALL = 'all'

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3">
    <div className="min-w-0"><h1 className="text-2xl font-bold tracking-tight">{title}</h1>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}</div>
    {actions}
  </div>
}

export function StatCard({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <Card><CardHeader className="pb-2"><CardDescription>{label}</CardDescription><CardTitle className="text-3xl tabular-nums">{value}</CardTitle></CardHeader>
    {hint && <CardContent className="pt-0 text-xs text-muted-foreground">{hint}</CardContent>}</Card>
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{label}…</div>
}

export function ErrorAlert({ error }: { error: string }) {
  if (!error) return null
  return <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>
}

export interface MemberOption { id: string; name: string; email: string; role: string; state: string }

/** Member picker backed by server search, so large workspaces never load every member into the browser. */
export function MemberSelect({ value, onChange, label = 'Learner', allLabel = 'All learners' }: { value?: string; onChange: (id?: string) => void; label?: string; allLabel?: string }) {
  const [q, setQ] = useState('')
  const query = new URLSearchParams(q.trim() ? { q: q.trim() } : {}).toString()
  const { data } = useWorkspaceData<{ items: MemberOption[] }>(`/api/workspaces/current/members${query ? `?${query}` : ''}`)
  const items = data?.items ?? []
  return <div className="space-y-1.5 min-w-[14rem]">
    <Label>{label}</Label>
    <div className="flex gap-2">
      <Input aria-label={`Search ${label.toLowerCase()}`} placeholder="Search name or email" value={q} onChange={e => setQ(e.target.value)} className="w-40" />
      <Select value={value ?? ALL} onValueChange={v => onChange(v === ALL ? undefined : v)}>
        <SelectTrigger aria-label={label} className="w-56"><SelectValue placeholder={allLabel} /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {items.map(m => <SelectItem key={m.id} value={m.id}>{m.name || m.email}</SelectItem>)}
          {value && !items.some(m => m.id === value) && <SelectItem value={value}>Selected learner</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  </div>
}

export function FilterBar({ filters, onChange, product = true, skill = false, learner = true, products = PRODUCTS }: {
  filters: AnalyticsFilters; onChange: (next: AnalyticsFilters) => void; product?: boolean; skill?: boolean; learner?: boolean
  products?: ReadonlyArray<{ id: string; label: string }>
}) {
  return <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-card p-4" aria-label="Report filters">
    <div className="space-y-1.5"><Label>Period</Label>
      <Select value={String(filters.days)} onValueChange={v => onChange({ ...filters, days: Number(v) })}>
        <SelectTrigger aria-label="Period" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>{PERIODS.map(d => <SelectItem key={d} value={String(d)}>Last {d} days</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {product && <div className="space-y-1.5"><Label>Product</Label>
      <Select value={filters.product ?? ALL} onValueChange={v => onChange({ ...filters, product: v === ALL ? undefined : v })}>
        <SelectTrigger aria-label="Product" className="w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All products</SelectItem>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>}
    {skill && <div className="space-y-1.5"><Label>Skill</Label>
      <Select value={filters.skill ?? ALL} onValueChange={v => onChange({ ...filters, skill: v === ALL ? undefined : v })}>
        <SelectTrigger aria-label="Skill" className="w-44"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value={ALL}>All skills</SelectItem>{PULSE_SKILL_BLOCKS.map(s => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}</SelectContent>
      </Select>
    </div>}
    {learner && <MemberSelect value={filters.learner} onChange={id => onChange({ ...filters, learner: id })} />}
  </div>
}
