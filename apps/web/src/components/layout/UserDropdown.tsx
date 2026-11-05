import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'
import { ThemeToggle } from './ThemeToggle'

export function UserDropdown({ className }: { className?: string } = {}) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!user) return null

  const displayLabel =
    user.firstName && user.firstName.toLowerCase() !== 'admin'
      ? user.firstName
      : user.email.split('@')[0]

  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={event => { if (event.key === 'Escape') setOpen(false) }}>
      <button
        aria-expanded={open}
        aria-label={`${displayLabel} account menu`}
        onClick={() => setOpen((v) => !v)}
        className="text-muted-foreground text-xs truncate max-w-[150px] hover:text-foreground transition-colors cursor-pointer"
      >
        {displayLabel}
      </button>
      {open && (
        <div
          onMouseLeave={() => setOpen(false)}
          className="absolute right-0 top-full mt-5 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md z-50"
        >
          <ThemeToggle className="px-2 pb-2 pt-1.5" />
          <div className="my-1 h-px bg-border" role="separator" />
          <button
            onClick={() => { setOpen(false); logout() }}
            className="flex w-full items-center rounded-sm px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

