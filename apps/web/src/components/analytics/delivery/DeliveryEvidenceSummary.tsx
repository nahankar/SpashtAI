import { DeliveryMomentCard } from './DeliveryMomentCard'
import { DeliveryTrendChart } from './DeliveryTrendChart'
import { getMomentDataError, type DeliveryEvidenceState, type DeliveryMetric, type HearEvidenceHandler } from './contract'

export interface DeliveryEvidenceSummaryProps {
  data: DeliveryEvidenceState
  onHearEvidence?: HearEvidenceHandler
  trendMetric?: DeliveryMetric
}

export function DeliveryEvidenceSummary({
  data,
  onHearEvidence,
  trendMetric,
}: DeliveryEvidenceSummaryProps) {
  let content: React.ReactNode

  if (data.state === 'pending') {
    content = <p role="status">Delivery evidence is being prepared. No observations are available yet.</p>
  } else if (data.state === 'insufficient_evidence') {
    const explanation = data.reason === 'insufficient_voiced_signal'
      ? 'The recording is complete, but there is too little usable voiced signal for acoustic measurements.'
      : data.reason === 'validated_turn_audio_timing_unavailable'
        ? 'The recording is complete, but verified turn audio timing is unavailable.'
        : data.reason === 'verified_measurements_unavailable'
          ? 'No measurements met the verified evidence requirements.'
        : `Verified acoustic measurements are unavailable (${data.reason}).`
    content = <p role="status">Insufficient delivery evidence: {explanation}</p>
  } else if (data.state === 'unavailable') {
    content = <p role="status">Delivery evidence unavailable: {data.reason === 'audio_signature_mismatch'
      ? 'The extracted evidence does not match the current recording.'
      : data.reason}</p>
  } else if (data.state === 'error') {
    content = <p role="alert">Delivery evidence could not be loaded: {data.message}</p>
  } else if (data.state === 'empty' || data.moments.length === 0) {
    content = <p>No delivery moments were found in this recording.</p>
  } else {
    const validMoments = data.moments.filter((moment) => getMomentDataError(moment) === null)
    const invalidCount = data.moments.length - validMoments.length
    const verified = validMoments.filter((moment) => moment.evidence.quality === 'verified')
    const selectedMetric = trendMetric ?? validMoments.flatMap((moment) =>
      moment.evidence.quality === 'verified' ? [moment.evidence.measurement.metric] : [],
    )[0]

    content = (
      <div className="space-y-4">
        <p className="text-sm">
          {verified.length} verified observation{verified.length === 1 ? '' : 's'};{' '}
          {validMoments.length - verified.length} with insufficient evidence;{' '}
          {verified.length} experimental and uncalibrated.
        </p>
        {invalidCount > 0 && (
          <p role="alert">{invalidCount} delivery moment{invalidCount === 1 ? '' : 's'} {invalidCount === 1 ? 'contains' : 'contain'} invalid data.</p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {data.moments.map((moment) => (
            <DeliveryMomentCard
              key={moment.id}
              moment={moment}
              onHearEvidence={onHearEvidence}
            />
          ))}
        </div>
        {selectedMetric && (() => {
          const fingerprints = new Set(validMoments
            .filter((moment) => moment.evidence.quality === 'verified' && moment.evidence.measurement.metric === selectedMetric)
            .map((moment) => moment.captureFingerprint))
          const missingAcousticCapture = selectedMetric !== 'pause_duration' &&
            validMoments.some((moment) =>
              moment.evidence.quality === 'verified' &&
              moment.evidence.measurement.metric === selectedMetric &&
              (moment.capture.agc === 'unknown' || moment.capture.noiseSuppression === 'unknown'),
            )
          return missingAcousticCapture
            ? <p className="text-sm text-muted-foreground">Trend unavailable: capture processing is not documented for every clip.</p>
            : fingerprints.size <= 1
            ? <DeliveryTrendChart moments={validMoments} metric={selectedMetric} />
            : <p className="text-sm text-muted-foreground">Trend unavailable: capture processing changed during this recording.</p>
        })()}
      </div>
    )
  }

  return (
    <section aria-label="Delivery evidence" className="space-y-3 text-foreground">
      <h2 className="text-lg font-semibold">Experimental delivery observations</h2>
      {content}
    </section>
  )
}
