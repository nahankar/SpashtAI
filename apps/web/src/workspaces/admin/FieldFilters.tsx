import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu'
import { useWorkspaceData } from '../shell/context'
import { ErrorAlert } from './parts'

interface Field { id: string; label: string; options: string[] }
export function FieldFilters() {
  const [params, setParams] = useSearchParams()
  const { data, error, loading } = useWorkspaceData<Field[]>('/api/workspaces/current/admin/field-filters')
  const selected = params.getAll('field')
  function toggle(value: string, on: boolean) {
    const next = new URLSearchParams(params)
    next.delete('field')
    const values = on ? [...new Set([...selected, value])] : selected.filter(v => v !== value)
    values.forEach(v => next.append('field', v))
    setParams(next, { replace: true })
  }
  return <>
    <ErrorAlert error={error} />
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading custom filters...</p>}
    {data?.map(field => <div key={field.id} className="flex flex-col items-start gap-1.5">
      <Label htmlFor={`custom-filter-${field.id}`}>{field.label}</Label>
      <DropdownMenu><DropdownMenuTrigger asChild><Button id={`custom-filter-${field.id}`} variant="outline" aria-label={`${field.label} filter`}>
        {selected.filter(v => v.startsWith(`${field.id}:`)).length || 'All'} {field.label}
      </Button></DropdownMenuTrigger>
        <DropdownMenuContent className="max-h-80 overflow-y-auto max-w-sm">
          {[...field.options.map(value => ({ value, label: value })), { value: '__none__', label: 'No answer' }].map(({ value, label }) => {
            const key = `${field.id}:${value}`, checked = selected.includes(key)
            return <DropdownMenuCheckboxItem key={key} checked={checked} disabled={!checked && selected.length >= 10}
              onSelect={event => event.preventDefault()} onCheckedChange={on => toggle(key, on === true)}>{label}</DropdownMenuCheckboxItem>
          })}
          <p className="p-2 text-xs text-muted-foreground">Any selected option in this field; all selected fields must match. Up to 10 choices.</p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>)}
    {selected.length > 0 && <Button variant="ghost" onClick={() => { const next = new URLSearchParams(params); next.delete('field'); setParams(next, { replace: true }) }}>Clear custom filters</Button>}
  </>
}
