import { useEffect, useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import {
  formatRelDate,
  parseSessionPickerValue,
  sessionPickerValue,
  type FeedbackSessionModule,
} from '@/lib/feedback-session'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface ElevateOption {
  id: string
  sessionName?: string | null
  module: string
  startedAt: string
  durationSec?: number | null
}

interface ReplayOption {
  id: string
  sessionName?: string | null
  meetingType: string
  createdAt: string
  status: string
}

interface FeedbackSessionPickerProps {
  value: string
  onChange: (value: string) => void
  initialModule?: FeedbackSessionModule | null
  initialSessionId?: string | null
}

function elevateLabel(s: ElevateOption): string {
  const name =
    s.sessionName?.trim() ||
    `${s.module.charAt(0).toUpperCase()}${s.module.slice(1)} Session`
  const dur =
    s.durationSec != null
      ? ` · ${Math.floor(s.durationSec / 60)}m ${s.durationSec % 60}s`
      : ''
  return `${name} · ${formatRelDate(s.startedAt)}${dur}`
}

function replayLabel(s: ReplayOption): string {
  const name = s.sessionName?.trim() || s.meetingType
  return `${name} · ${formatRelDate(s.createdAt)} · ${s.status}`
}

export function FeedbackSessionPicker({
  value,
  onChange,
  initialModule,
  initialSessionId,
}: FeedbackSessionPickerProps) {
  const [loading, setLoading] = useState(true)
  const [elevateSessions, setElevateSessions] = useState<ElevateOption[]>([])
  const [replaySessions, setReplaySessions] = useState<ReplayOption[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const headers = getAuthHeaders()
        const [elevateRes, replayRes] = await Promise.all([
          fetch(`${API}/sessions`, { headers }),
          fetch(`${API}/api/replay/sessions`, { headers }),
        ])
        if (cancelled) return
        if (elevateRes.ok) {
          const data = await elevateRes.json()
          setElevateSessions(data.sessions || [])
        }
        if (replayRes.ok) {
          const data = await replayRes.json()
          setReplaySessions(data.sessions || [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (value || !initialModule || !initialSessionId) return
    onChange(sessionPickerValue(initialModule, initialSessionId))
  }, [value, initialModule, initialSessionId, onChange])

  const selected = useMemo(() => parseSessionPickerValue(value), [value])

  const hasSessions = elevateSessions.length > 0 || replaySessions.length > 0

  return (
    <div className="space-y-1">
      <Label htmlFor="fb-session">Related session (optional)</Label>
      <p className="text-xs text-muted-foreground">
        Link a past Elevate or Replay session so we can find the right logs and recording.
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your sessions…
        </div>
      ) : !hasSessions ? (
        <p className="text-sm text-muted-foreground py-1">No past sessions found.</p>
      ) : (
        <select
          id="fb-session"
          className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">None — general feedback</option>
          {elevateSessions.length > 0 && (
            <optgroup label="Elevate & practice">
              {elevateSessions.map((s) => (
                <option key={s.id} value={sessionPickerValue('elevate', s.id)}>
                  {elevateLabel(s)}
                </option>
              ))}
            </optgroup>
          )}
          {replaySessions.length > 0 && (
            <optgroup label="Replay">
              {replaySessions.map((s) => (
                <option key={s.id} value={sessionPickerValue('replay', s.id)}>
                  {replayLabel(s)}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      )}
      {selected && (
        <p className="text-xs font-mono text-muted-foreground break-all pt-1">
          Session ID: {selected.sessionId}
        </p>
      )}
    </div>
  )
}
