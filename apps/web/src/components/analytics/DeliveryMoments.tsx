import { useEffect, useState } from 'react'
import { PauseCircle, Play, ShieldCheck } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getAuthHeaders } from '@/lib/api-client'
import {
  DeliveryEvidenceSummary,
  type DeliveryEvidenceState,
} from './delivery'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
const MAX_PENDING_POLLS = 15

interface DeliveryMoment {
  id: string
  kind: 'sentence_boundary_pause' | 'mid_thought_pause'
  polarity: 'strength' | 'opportunity'
  clipStartSec: number
  clipEndSec: number
  pauseSeconds: number
  confidence: number
  observation: string
  interpretation: string
  retry: string
}

interface DeliveryMomentResponse {
  status: {
    enabled: boolean
    state: 'available' | 'pending' | 'suppressed'
    reason: string | null
    validTurnCount: number
    momentCount: number
  }
  moments: DeliveryMoment[]
  deliveryEvidence?: DeliveryEvidenceState
}

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

function unavailableCopy(reason: string | null) {
  switch (reason) {
    case 'complete_recording_required':
      return 'Delivery moments will appear once every recording segment is available.'
    case 'complete_recording_unavailable':
      return 'Delivery moments are unavailable because this session is missing one or more recording segments.'
    case 'committed_user_turns_required':
      return 'Delivery moments will appear after the completed turns are saved.'
    case 'validated_word_alignment_required':
      return 'This recording does not yet have verified word-level alignment. We do not infer pause quality from generic silence detection alone.'
    case 'no_notable_pause':
      return 'Verified alignment was available, but no pause met the conservative evidence threshold.'
    default:
      return 'Delivery moments are not enabled for this environment.'
  }
}

/**
 * Shows verified pause-placement evidence plus raw, explicitly experimental
 * acoustic observations. It intentionally withholds personality, vocal-health,
 * tone, and pitch/energy coaching until those interpretations are calibrated
 * against human-labelled recordings.
 */
export function DeliveryMoments({
  sessionId,
  onPlayMoment,
  compact = false,
}: {
  sessionId: string
  onPlayMoment?: (startSeconds: number, endSeconds: number, includeGaps?: true) => void
  compact?: boolean
}) {
  const [data, setData] = useState<DeliveryMomentResponse | null>(null)
  const [pendingTimedOut, setPendingTimedOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    let retry: number | undefined
    let pendingPolls = 0
    setPendingTimedOut(false)
    const load = () => {
      fetch(`${API_BASE_URL}/sessions/${sessionId}/delivery-moments`, {
        headers: getAuthHeaders(),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((value) => {
          if (cancelled || !value) return
          const next = value as DeliveryMomentResponse
          setData(next)
          // A completed session can receive its final turn/upload just after
          // Results opens. Poll only while evidence is explicitly pending, and
          // cap the client loop so a broken upload cannot spin indefinitely.
          if (next.status.state === 'pending') {
            pendingPolls += 1
            if (pendingPolls < MAX_PENDING_POLLS) retry = window.setTimeout(load, 4_000)
            else setPendingTimedOut(true)
          }
        })
        .catch(() => {
          /* Delivery evidence is additive; replay and analytics must still load. */
        })
    }
    load()
    return () => {
      cancelled = true
      if (retry != null) window.clearTimeout(retry)
    }
  }, [sessionId])

  if (!data || !data.status.enabled) return null
  const hasMoments = data.moments.length > 0
  const content = hasMoments ? (
    <div className="grid gap-3 md:grid-cols-2">
      {data.moments.map((moment) => {
        const strength = moment.polarity === 'strength'
        return (
          <div
            key={moment.id}
            className={`rounded-lg border p-3 ${
              strength ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <Badge
                className={strength ? 'bg-emerald-600' : 'bg-amber-600'}
              >
                {strength ? 'Strength' : 'Try next'}
              </Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {moment.pauseSeconds.toFixed(1)}s pause
              </span>
            </div>
            <p className="mt-2 text-sm font-medium">{moment.observation}</p>
            <p className="mt-1 text-sm text-muted-foreground">{moment.interpretation}</p>
            <p className="mt-2 text-sm">{moment.retry}</p>
            {onPlayMoment && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 h-8"
                onClick={() => onPlayMoment(moment.clipStartSec, moment.clipEndSec, true)}
              >
                <Play className="mr-1.5 h-3.5 w-3.5" /> Hear evidence · {formatTime(moment.clipStartSec)}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  ) : (
    <div className="rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground">
      {pendingTimedOut && data.status.state === 'pending'
        ? 'Delivery evidence is still being prepared. Automatic checking stopped; reload this page after the recording has finished saving.'
        : unavailableCopy(data.status.reason)}
    </div>
  )

  const rawEvidence = data.deliveryEvidence && (
    <div className="mt-5 border-t pt-4">
      <DeliveryEvidenceSummary
        data={data.deliveryEvidence}
        onHearEvidence={onPlayMoment
          ? ({ startSeconds, endSeconds, includeGaps }) =>
            onPlayMoment(startSeconds, endSeconds, includeGaps)
          : undefined}
      />
    </div>
  )
  const verifiedPauses = (
    <section aria-label="Verified pause moments">
      <p className="mb-2 text-xs text-muted-foreground">
        Verified, word-aligned pauses — limited pause-placement coaching.
      </p>
      {content}
    </section>
  )

  if (compact) {
    return (
      <section className="mb-4" aria-label="Delivery moments">
        <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <PauseCircle className="h-3.5 w-3.5" />
          <span>Delivery moments — measured pauses with aligned audio evidence</span>
        </div>
        {verifiedPauses}
        {rawEvidence}
      </section>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <PauseCircle className="h-5 w-5" /> Delivery moments
        </CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          Specific moments from your recording, shown only when audio and transcript alignment are verified.
        </p>
      </CardHeader>
      <CardContent>
        {verifiedPauses}
        {rawEvidence}
        <div className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Pause placement is interpreted conservatively. Pitch and energy observations are experimental measurements; tone, personality, and vocal-health interpretations remain withheld until calibrated against human-labelled recordings.
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
