import { useEffect } from 'react'
import {
  AudioWaveform,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Info,
  PauseCircle,
  Play,
  Volume2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DeliveryEvidenceSummary,
  getMomentDataError,
  type DeliveryEvidenceState,
  type DeliveryMoment as AcousticDeliveryMoment,
} from './delivery'
import {
  hasVerifiedObservations,
  MEASUREMENT_CONFIDENCE_NOTE,
  overviewReasonCopy,
  playbackNoticeCopy,
  useDeliveryMoments,
  type DeliveryMoment,
  type DeliveryMomentResponse,
  type PlayDeliveryMoment,
} from './deliveryMomentsData'

export type { DeliveryMoment, DeliveryMomentResponse, PlayDeliveryMoment } from './deliveryMomentsData'

function formatTime(seconds: number) {
  const value = Math.max(0, Math.floor(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

export interface FeaturedVoiceMoment {
  kind: 'pitch' | 'loudness'
  label: string
  value: string
  description: string
  moment: AcousticDeliveryMoment
}

function featuredVoiceMoments(evidence: DeliveryEvidenceState | undefined): FeaturedVoiceMoment[] {
  if (evidence?.state !== 'ready') return []
  const verified = evidence.moments.filter(
    (moment) =>
      getMomentDataError(moment) === null &&
      moment.evidence.quality === 'verified' &&
      moment.clip.availability === 'available',
  )
  const highest = (metric: 'f0_spread' | 'mean_f0' | 'intensity') =>
    verified
      .filter(
        (moment) =>
          moment.evidence.quality === 'verified' &&
          moment.evidence.measurement.metric === metric,
      )
      .sort((left, right) => {
        const leftValue = left.evidence.quality === 'verified' ? left.evidence.measurement.value : 0
        const rightValue = right.evidence.quality === 'verified' ? right.evidence.measurement.value : 0
        return rightValue - leftValue
      })[0]

  const pitch = highest('f0_spread') ?? highest('mean_f0')
  const loudness = highest('intensity')
  const items: FeaturedVoiceMoment[] = []
  if (pitch?.evidence.quality === 'verified') {
    const spread = pitch.evidence.measurement.metric === 'f0_spread'
    items.push({
      kind: 'pitch',
      label: spread ? 'Largest measured pitch range' : 'Pitch measurement',
      value: `${pitch.evidence.measurement.value.toFixed(1)} Hz`,
      description: spread
        ? 'This clip had the widest fundamental-frequency spread in this recording.'
        : 'This clip contains a verified fundamental-frequency measurement.',
      moment: pitch,
    })
  }
  if (loudness?.evidence.quality === 'verified') {
    items.push({
      kind: 'loudness',
      label: 'Highest recorded level',
      value: `${loudness.evidence.measurement.value.toFixed(1)} dB`,
      description: 'This clip had the highest measured intensity in this recording.',
      moment: loudness,
    })
  }
  return items
}

export function VoiceMomentCard({
  item,
  onPlayMoment,
}: {
  item: FeaturedVoiceMoment
  onPlayMoment?: PlayDeliveryMoment
}) {
  const Icon = item.kind === 'pitch' ? AudioWaveform : Volume2
  const start = item.moment.clip.startSeconds
  const end = start + item.moment.clip.durationSeconds
  const time = formatTime(start)
  return (
    <li className="rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge className="bg-sky-700">
          <Icon className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          {item.kind === 'pitch' ? 'Pitch' : 'Loudness'}
        </Badge>
        <span className="text-xs tabular-nums text-muted-foreground">{time} · {item.value}</span>
      </div>
      <p className="mt-2 text-sm font-medium">{item.label}</p>
      <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Experimental recording measurement; microphone processing can affect comparisons.
      </p>
      {onPlayMoment && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-8"
          aria-label={`Hear ${item.kind} moment at ${time}`}
          onClick={() => onPlayMoment(start, end, true)}
        >
          <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Hear this moment · {time}
        </Button>
      )}
    </li>
  )
}

function ExperimentalObservations({
  evidence,
  onPlayMoment,
}: {
  evidence: DeliveryEvidenceState
  onPlayMoment?: PlayDeliveryMoment
}) {
  return (
    <details className="group mt-2 rounded-md border border-dashed px-3 py-2 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" aria-hidden="true" />
        Experimental recording measurements
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{MEASUREMENT_CONFIDENCE_NOTE}</p>
      <div className="mt-3">
        <DeliveryEvidenceSummary
          data={evidence}
          onHearEvidence={onPlayMoment
            ? ({ startSeconds, endSeconds, includeGaps }) =>
              onPlayMoment(startSeconds, endSeconds, includeGaps)
            : undefined}
        />
      </div>
    </details>
  )
}

/** Presentational Playback view: evidence and action, compact when empty. */
export function DeliveryMomentsPlaybackView({
  data,
  pendingTimedOut = false,
  onPlayMoment,
}: {
  data: DeliveryMomentResponse
  pendingTimedOut?: boolean
  onPlayMoment?: PlayDeliveryMoment
}) {
  if (!data.status.enabled) return null
  const evidence = data.deliveryEvidence
  const showObservations = evidence?.state === 'ready' && evidence.moments.length > 0
  const voiceMoments = featuredVoiceMoments(evidence)

  if (data.moments.length === 0 && voiceMoments.length === 0) {
    return (
      <section className="mb-4" aria-label="Delivery moments">
        <p role="status" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <PauseCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{playbackNoticeCopy(data, pendingTimedOut)}</span>
        </p>
        {showObservations && <ExperimentalObservations evidence={evidence} onPlayMoment={onPlayMoment} />}
      </section>
    )
  }

  return (
    <section className="mb-4 space-y-2" aria-label="Delivery moments">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
        <AudioWaveform className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Delivery moments</span>
        <Badge variant="outline" className="border-emerald-300 text-emerald-800">
          Verified recording evidence
        </Badge>
        <span>
          {data.moments.length} pause{data.moments.length === 1 ? '' : 's'}
          {voiceMoments.length > 0 && ` · ${voiceMoments.length} voice moment${voiceMoments.length === 1 ? '' : 's'}`}
          {data.moments.length > 0 && ' — pauses are also marked on the timeline'}
        </span>
      </div>
      <ul className="grid gap-3 md:grid-cols-2">
        {data.moments.map((moment) => {
          const strength = moment.polarity === 'strength'
          const time = formatTime(moment.clipStartSec)
          return (
            <li
              key={moment.id}
              className={`rounded-lg border p-3 ${
                strength ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <Badge className={strength ? 'bg-emerald-700' : 'bg-amber-700'}>
                  {strength ? 'Well-placed pause' : 'Try next'}
                </Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {time} · {moment.pauseSeconds.toFixed(1)}s pause
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
                  aria-label={`Hear this moment at ${time}`}
                  onClick={() => onPlayMoment(moment.clipStartSec, moment.clipEndSec, true)}
                >
                  <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Hear this moment · {time}
                </Button>
              )}
            </li>
          )
        })}
        {voiceMoments.map((item) => (
          <VoiceMomentCard key={`${item.kind}:${item.moment.id}`} item={item} onPlayMoment={onPlayMoment} />
        ))}
      </ul>
      {showObservations && <ExperimentalObservations evidence={evidence} onPlayMoment={onPlayMoment} />}
    </section>
  )
}

/**
 * Playback container. Verified pause moments are actionable and playable;
 * experimental acoustic observations stay collapsed and are never coaching.
 */
export function DeliveryMoments({
  sessionId,
  onPlayMoment,
  onMomentsChange,
}: {
  sessionId: string
  onPlayMoment?: PlayDeliveryMoment
  /** Receives verified moments so the host can mark them on its timeline. */
  onMomentsChange?: (moments: DeliveryMoment[]) => void
}) {
  const { data, pendingTimedOut } = useDeliveryMoments(sessionId)

  useEffect(() => {
    onMomentsChange?.(data?.status.enabled ? data.moments : [])
  }, [data, onMomentsChange])

  if (!data) return null
  return (
    <DeliveryMomentsPlaybackView
      data={data}
      pendingTimedOut={pendingTimedOut}
      onPlayMoment={onPlayMoment}
    />
  )
}

function StatusLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : CircleDashed
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={`mt-0.5 h-4 w-4 shrink-0 ${ok ? 'text-emerald-700' : 'text-muted-foreground'}`}
        aria-hidden="true"
      />
      <span>{children}</span>
    </li>
  )
}

/** Presentational Session Analytics summary: status and explanation, no evidence list. */
export function DeliveryEvidenceOverviewView({
  data,
  pendingTimedOut = false,
  measurementsAvailable,
  onOpenPlayback,
}: {
  data: DeliveryMomentResponse | null
  pendingTimedOut?: boolean
  measurementsAvailable: boolean
  onOpenPlayback?: () => void
}) {
  const enabled = Boolean(data?.status.enabled)
  const momentCount = enabled ? (data?.moments.length ?? 0) : 0
  const recordingMeasured = measurementsAvailable || hasVerifiedObservations(data?.deliveryEvidence)

  return (
    <section aria-label="Delivery evidence summary" className="space-y-3 text-sm">
      <ul className="space-y-2">
        <StatusLine ok={recordingMeasured}>
          {recordingMeasured
            ? 'Recording measurements are available.'
            : 'Recording measurements are not available for this session.'}
        </StatusLine>
        {enabled && data && (
          <StatusLine ok={momentCount > 0}>
            {momentCount > 0
              ? `${momentCount} verified delivery moment${momentCount === 1 ? '' : 's'} — word-aligned pauses you can hear in Playback.`
              : overviewReasonCopy(data, pendingTimedOut)}
          </StatusLine>
        )}
      </ul>
      {enabled && momentCount > 0 && onOpenPlayback && (
        <Button variant="outline" size="sm" className="h-8" onClick={onOpenPlayback}>
          <Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Open in Playback
        </Button>
      )}
      <details className="group text-xs text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center gap-1 font-medium hover:text-foreground">
          <Info className="h-3.5 w-3.5" aria-hidden="true" /> Why this matters
        </summary>
        <div className="mt-2 space-y-2 leading-snug">
          <p>
            A delivery moment points to a specific pause you can listen to. We only show one when the
            timing of each word has been checked against your recording, so a moment is never guessed
            from silence alone — a silent stretch could otherwise be the coach speaking, a network gap,
            or the edge of a recording segment.
          </p>
          <p>
            Recording measurements such as pitch and harmonicity are raw acoustic values. Your
            microphone and browser audio processing change them, so they are shown for reference only
            and are not used as coaching yet.
          </p>
        </div>
      </details>
    </section>
  )
}

export function DeliveryEvidenceOverview({
  sessionId,
  measurementsAvailable,
  onOpenPlayback,
}: {
  sessionId: string
  measurementsAvailable: boolean
  onOpenPlayback?: () => void
}) {
  const { data, pendingTimedOut } = useDeliveryMoments(sessionId)
  return (
    <DeliveryEvidenceOverviewView
      data={data}
      pendingTimedOut={pendingTimedOut}
      measurementsAvailable={measurementsAvailable}
      onOpenPlayback={onOpenPlayback}
    />
  )
}
