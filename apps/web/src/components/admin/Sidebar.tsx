import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const links = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/users', label: 'Users', end: false },
  { to: '/admin/feedback', label: 'Feedback', end: false },
  { to: '/admin/analytics', label: 'Analytics', end: false },
  { to: '/admin/system', label: 'System', end: false },
  { to: '/admin/voice-backend', label: 'Voice Backend', end: false },
  { to: '/admin/features', label: 'Feature Flags', end: false },
  { to: '/admin/agent-prompts', label: 'Coach Prompts', end: false },
  { to: '/admin/tickers', label: 'Tickers', end: false },
  { to: '/admin/pricing', label: 'Pricing', end: false },
  { to: '/admin/legal', label: 'Legal', end: false },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </>
  )
}

export function Sidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="md:hidden flex items-center gap-2 border-b bg-card/50 px-4 py-2">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} aria-label="Open admin menu">
          <Menu className="h-4 w-4" />
          <span className="ml-2">Admin menu</span>
        </Button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-72 max-w-[85vw] border-r bg-card shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">Admin Panel</span>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <nav className="flex flex-col gap-1 p-3 overflow-y-auto flex-1">
              <NavLinks onNavigate={() => setOpen(false)} />
            </nav>
          </aside>
        </div>
      )}

      <aside className="hidden md:block w-56 shrink-0 border-r bg-card/50 min-h-[calc(100vh-65px)]">
        <nav className="flex flex-col gap-1 p-4">
          <div className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin Panel
          </div>
          <NavLinks />
        </nav>
      </aside>
    </>
  )
}
