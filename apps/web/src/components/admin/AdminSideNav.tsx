import { useState, type ComponentType } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface AdminSideLink {
  to: string
  label: string
  end?: boolean
  icon: ComponentType<{ className?: string }>
}

export interface AdminSideGroup {
  label: string
  links: AdminSideLink[]
}

export function AdminSideNav({ title, groups }: { title: string; groups: AdminSideGroup[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div className="flex items-center gap-2 border-b bg-card/50 px-4 py-2 md:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label={`Open ${title} menu`}>
          <Menu className="h-4 w-4" />
          <span className="ml-2">{title} menu</span>
        </Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r bg-card shadow-xl">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">{title}</span>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close menu">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              <NavGroups groups={groups} onNavigate={() => setOpen(false)} />
            </nav>
          </aside>
        </div>
      )}

      <aside className="hidden min-h-[calc(100vh-65px)] w-64 shrink-0 border-r bg-card/50 md:block">
        <nav className="flex flex-col gap-1 p-4">
          <div className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
          <NavGroups groups={groups} />
        </nav>
      </aside>
    </>
  )
}

function NavGroups({ groups, onNavigate }: { groups: AdminSideGroup[]; onNavigate?: () => void }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{group.label}</p>
          <div className="flex flex-col gap-1">
            {group.links.map((link) => {
              const Icon = link.icon
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{link.label}</span>
                </NavLink>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
