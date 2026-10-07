import { useId } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from '@/contexts/ThemeContext'
import { THEME_OPTIONS, type ThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'

const ICONS: Record<ThemePreference, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }

/** Appearance control used in the profile menu (desktop and mobile). */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme()
  const labelId = useId()
  return (
    <div className={cn('space-y-1.5', className)}>
      <p id={labelId} className="px-1 text-xs font-medium text-muted-foreground">Appearance</p>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-3 gap-1 rounded-md border p-0.5">
        {THEME_OPTIONS.map(({ value, label }) => {
          const Icon = ICONS[value]
          const selected = preference === value
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(value)}
              className={cn(
                'flex items-center justify-center gap-1 rounded-sm px-1.5 py-1 text-xs transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
