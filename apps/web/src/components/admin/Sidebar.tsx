import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  ClipboardList,
  DollarSign,
  Flag,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  MessageSquareText,
  Mic2,
  Scale,
  Users,
  X,
  Menu,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const groups = [
  {
    label: 'Overview',
    links: [
      { to: '/admin', label: 'Dashboard', end: true, icon: LayoutDashboard },
      { to: '/admin/users', label: 'Users', end: false, icon: Users },
      { to: '/admin/feedback', label: 'Feedback', end: false, icon: MessageSquareText },
    ],
  },
  {
    label: 'Analytics',
    links: [
      { to: '/admin/analytics', label: 'Feature Usage', end: true, icon: BarChart3 },
      { to: '/admin/progress-pulse', label: 'Progress Pulse', end: false, icon: Activity },
      { to: '/admin/analytics/explorer', label: 'AI Analytics', end: true, icon: BrainCircuit },
      { to: '/admin/ux-analytics', label: 'UX Analytics', end: false, icon: Gauge },
    ],
  },
  {
    label: 'System',
    links: [
      { to: '/admin/system', label: 'Health', end: false, icon: HeartPulse },
      { to: '/admin/voice-backend', label: 'Voice Backend', end: false, icon: Mic2 },
      { to: '/admin/features', label: 'Feature Flags', end: false, icon: Flag },
      { to: '/admin/agent-prompts', label: 'Coach Prompts', end: false, icon: Bot },
      { to: '/admin/interview-bank', label: 'Interview Question Bank', end: false, icon: ClipboardList },
      { to: '/admin/tickers', label: 'Tickers', end: false, icon: Building2 },
    ],
  },
  {
    label: 'Administration',
    links: [
      { to: '/admin/pricing', label: 'Pricing', end: false, icon: DollarSign },
      { to: '/admin/legal', label: 'Legal', end: false, icon: Scale },
    ],
  },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.label} className="mb-4 last:mb-0">
          <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            {group.label}
          </p>
          <div className="flex flex-col gap-1">
            {group.links.map((link) => {
              const Icon = link.icon
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )
                  }
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

      <aside className="hidden md:block w-64 shrink-0 border-r bg-card/50 min-h-[calc(100vh-65px)]">
        <nav className="flex flex-col gap-1 p-4">
          <div className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Admin Panel
          </div>
          <NavLinks />
        </nav>
      </aside>
    </>
  )
}
