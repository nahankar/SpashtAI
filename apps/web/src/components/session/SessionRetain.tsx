import { useId, useState } from 'react'
import { Clock } from 'lucide-react'
import { toast } from 'sonner'
import { setSessionRetained, type RetainResult } from '@/lib/sessionRetain'

export function AutoCompleteNotice({ count, scope }: { count: number; scope: 'elevate' | 'interview' }) {
  if (count <= 0) return null
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        {count === 1 ? '1 session is' : `${count} sessions are`} in progress. Unfinished sessions are
        automatically completed after 24 hours without activity. To keep one open, tick{' '}
        <span className="font-medium">Retain</span>. You can retain one{' '}
        {scope === 'elevate' ? 'Elevate session' : 'interview practice'} at a time.
      </p>
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
