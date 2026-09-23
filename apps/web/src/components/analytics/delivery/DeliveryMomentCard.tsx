import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  evidenceMethods,
  formatMeasurement,
  formatRecordingTime,
  getMomentDataError,
  insufficientReasons,
  metricLabels,
  type DeliveryMoment,
  type HearEvidenceHandler,
} from './contract'

export interface DeliveryMomentCardProps {
  moment: DeliveryMoment
  onHearEvidence?: HearEvidenceHandler
}

export function DeliveryMomentCard({ moment, onHearEvidence }: DeliveryMomentCardProps) {
  const error = getMomentDataError(moment)
  if (error) {
    return (
      <article className="rounded-lg border border-destructive bg-card p-4 text-card-foreground">
        <p role="alert">Delivery moment {moment.id} cannot be displayed: {error}</p>
      </article>
    )
  }

  const verified = moment.evidence.quality === 'verified'
  const canPlay = verified && moment.clip.availability === 'available' && Boolean(onHearEvidence)

  return (
    <article className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          Moment at {formatRecordingTime(moment.clip.startSeconds)}
        </h3>
        <span className="text-sm tabular-nums">
          Clip duration: {moment.clip.durationSeconds} seconds
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
        <span className={`rounded border px-2 py-1 ${verified
          ? 'border-border bg-muted text-foreground'
          : 'border-amber-700 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-100'}`}>
          {verified ? 'Verified observation' : 'Insufficient evidence'}
        </span>
        {verified && (
          <span className="rounded border border-border bg-muted px-2 py-1 text-foreground">
            Experimental · uncalibrated
          </span>
        )}
      </div>

      {moment.evidence.quality === 'verified' ? (
        <div className="mt-3 space-y-1 text-sm">
          <p>Raw observation: {metricLabels[moment.evidence.measurement.metric]}: {formatMeasurement(moment.evidence.measurement)}</p>
          <p>Evidence quality: verified — {evidenceMethods[moment.evidence.method]}</p>
          <p>Measurement only; no calibrated interpretation is available.</p>
        </div>
      ) : (
        <div className="mt-3 space-y-1 text-sm">
          <p>Raw observation: unavailable</p>
          <p>Evidence quality: insufficient — {insufficientReasons[moment.evidence.reason]}</p>
        </div>
      )}

      <div className="mt-3 space-y-1 text-sm">
        <p>Audio input signature: {moment.provenance.audioInputSignature}; analyzer: {moment.provenance.analyzerVersion}</p>
        <p>Browser-reported capture processing: AGC {moment.capture.agc}; noise suppression {moment.capture.noiseSuppression}.</p>
        <p className="text-muted-foreground">
          AGC can change recorded levels; noise suppression can remove signal detail.
          Unknown settings limit comparisons between recordings.
        </p>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-4"
        disabled={!canPlay}
        aria-label={`Hear evidence for moment at ${formatRecordingTime(moment.clip.startSeconds)}`}
        onClick={() => onHearEvidence?.({
          momentId: moment.id,
          startSeconds: moment.clip.startSeconds,
          endSeconds: moment.clip.startSeconds + moment.clip.durationSeconds,
          includeGaps: true,
        })}
      >
        <Play aria-hidden="true" className="mr-2 h-4 w-4" />
        Hear evidence
      </Button>
      {!canPlay && (
        <p className="mt-2 text-sm text-muted-foreground">
          {moment.clip.availability === 'unavailable'
            ? 'Recording clip unavailable; playback disabled.'
            : !verified
              ? 'Playback disabled until the observation is verified.'
              : 'Playback is unavailable in this view.'}
        </p>
      )}
    </article>
  )
}
