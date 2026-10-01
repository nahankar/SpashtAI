import { useId, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { setSessionRetained, type RetainResult } from '@/lib/sessionRetain'

export function AutoCompleteNotice({ count, scope }: { count: number; scope: 'elevate' | 'interview' }) {
  const kind = scope === 'elevate' ? 'Elevate session' : 'interview practice'
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Unfinished sessions are automatically completed after 24 hours without activity.
      </p>
      {count > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            You can retain one {kind} at a time. To keep one open, tick{' '}
            <span className="font-medium">Retain</span>.
          </p>
        </div>
      )}
    </div>
  )
}

export function RetainCheckbox({
  sessionId,
  retained,
  onChange,
}: {
  sessionId: string
  retained: boolean
  onChange: (result: RetainResult) => void
}) {
  const id = useId()
  const [saving, setSaving] = useState(false)

  async function toggle(next: boolean) {
    setSaving(true)
    try {
      const result = await setSessionRetained(sessionId, next)
      onChange(result)
      if (next) {
        toast.success(
          result.releasedSessionIds.length
            ? 'Session retained. Your previously retained session of this type is no longer retained.'
            : 'Session retained. It will not be auto-completed.',
        )
      } else {
        toast.success('Session no longer retained. It will auto-complete after 24 hours without activity.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update retain setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <label
      htmlFor={id}
      className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
      title="Retained sessions are not auto-completed. One Elevate session and one interview practice can be retained at a time."
    >
      <input
        id={id}
        type="checkbox"
        className="h-4 w-4 accent-primary"
        checked={retained}
        disabled={saving}
        onChange={(event) => void toggle(event.target.checked)}
      />
      Retain
    </label>
  )
}
