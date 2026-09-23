export type DeliveryMetric = 'pause_duration' | 'mean_f0' | 'f0_spread' | 'intensity'

export type RawMeasurement =
  | { metric: 'pause_duration'; value: number; unit: 'seconds' }
  | { metric: 'mean_f0'; value: number; unit: 'Hz' }
  | { metric: 'f0_spread'; value: number; unit: 'Hz' }
  | { metric: 'intensity'; value: number; unit: 'dB' }

/** Opaque, server-issued signature of the complete audio input. */
export interface AudioProvenance {
  audioInputSignature: string
  analyzerVersion: string
}

export interface CaptureSettings {
  agc: 'on' | 'off' | 'unknown'
  noiseSuppression: 'on' | 'off' | 'unknown'
}

export type DeliveryEvidence =
  | {
      quality: 'verified'
      method: 'word_aligned_recording' | 'validated_acoustic_extraction' | 'recorded_waveform'
      measurement: RawMeasurement
    }
  | {
      quality: 'insufficient'
      reason: 'recording_missing' | 'alignment_missing' | 'insufficient_signal'
    }

export interface DeliveryMoment {
  id: string
  clip: {
    startSeconds: number
    durationSeconds: number
    availability: 'available' | 'unavailable'
  }
  provenance: AudioProvenance
  capture: CaptureSettings
  /** Prevents charts from joining measurements across changed capture processing. */
  captureFingerprint: string
  evidence: DeliveryEvidence
  calibration?: { state: 'experimental' }
}

export type DeliveryEvidenceState =
  | { state: 'ready'; moments: readonly DeliveryMoment[] }
  | { state: 'empty' }
  | { state: 'pending' }
  | { state: 'insufficient_evidence'; reason: string }
  | { state: 'unavailable'; reason: string }
  | { state: 'error'; message: string }

export interface HearEvidenceRequest {
  momentId: string
  startSeconds: number
  endSeconds: number
  includeGaps: true
}

export type HearEvidenceHandler = (request: HearEvidenceRequest) => void

export function getMomentDataError(moment: DeliveryMoment): string | null {
  if (!Number.isFinite(moment.clip.startSeconds) || moment.clip.startSeconds < 0 ||
      !Number.isFinite(moment.clip.durationSeconds) || moment.clip.durationSeconds <= 0 ||
      !Number.isFinite(moment.clip.startSeconds + moment.clip.durationSeconds)) {
    return 'Clip start and duration must be finite, nonnegative seconds with a positive duration.'
  }
  if (!moment.provenance.audioInputSignature.trim() || !moment.provenance.analyzerVersion.trim()) {
    return 'A current audio-input signature and analyzer version are required.'
  }
  if (!moment.captureFingerprint.trim()) {
    return 'Capture fingerprint is required.'
  }
  if (moment.evidence.quality === 'verified') {
    const { metric, value } = moment.evidence.measurement
    if (!Number.isFinite(value) ||
        (metric === 'pause_duration' && value < 0) ||
        (metric === 'mean_f0' && value <= 0) ||
        (metric === 'f0_spread' && value < 0)) {
      return 'Raw measurement is missing or outside its physical unit range.'
    }
  }
  return null
}

export function formatRecordingTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000)
  const minutes = Math.floor(milliseconds / 60_000)
  const remainder = milliseconds % 60_000
  const wholeSeconds = String(Math.floor(remainder / 1000)).padStart(2, '0')
  const fraction = String(remainder % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${minutes}:${wholeSeconds}${fraction ? `.${fraction}` : ''}`
}

export const metricLabels: Record<DeliveryMetric, string> = {
  pause_duration: 'Pause duration',
  mean_f0: 'Mean fundamental frequency',
  f0_spread: 'Fundamental-frequency spread',
  intensity: 'Recorded intensity',
}

export const evidenceMethods: Record<Extract<DeliveryEvidence, { quality: 'verified' }>['method'], string> = {
  word_aligned_recording: 'Word-aligned recording',
  validated_acoustic_extraction: 'Validated acoustic extraction',
  recorded_waveform: 'Recorded waveform',
}

export const insufficientReasons: Record<Extract<DeliveryEvidence, { quality: 'insufficient' }>['reason'], string> = {
  recording_missing: 'Recording segment missing',
  alignment_missing: 'Word alignment missing',
  insufficient_signal: 'Signal not usable for this measurement',
}

export function formatMeasurement(measurement: RawMeasurement): string {
  return `${measurement.value} ${measurement.unit}`
}
