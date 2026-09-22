export type AudioStatus = 'pending' | 'available' | 'unavailable' | 'failed'

export type AudioCaptureReport = AudioStatus | 'uploaded'

const PROSODY_FIELDS = [
  'pitchVariation',
  'energyStability',
  'voiceQuality',
  'pauseCount',
  'meanPauseDuration',
] as const

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True when a prosody payload has at least one finite acoustic measurement. */
export function isUsableProsody(prosody: unknown): boolean {
  if (!prosody || typeof prosody !== 'object') return false
  const p = prosody as Record<string, unknown>
  return PROSODY_FIELDS.some((field) => isFiniteNumber(p[field]))
}

export function hasRealProsody(signals: unknown): boolean {
  if (!signals || typeof signals !== 'object') return false
  return isUsableProsody((signals as { prosody?: unknown }).prosody)
}

export function resolveAudioStatus(input: {
  hasReadableRecording: boolean
  capture?: string | null
}): AudioStatus {
  if (input.hasReadableRecording) return 'available'
  if (input.capture === 'failed') return 'failed'
  if (input.capture === 'unavailable') return 'unavailable'
  return 'pending'
}

export function mergeCommunicationSignals(existing: unknown, incoming: Record<string, unknown>) {
  const next = { ...incoming }
  if (!isUsableProsody(next.prosody)) {
    delete next.prosody
  }
  if (hasRealProsody(existing) && !hasRealProsody(next)) {
    return {
      ...next,
      prosody: (existing as { prosody: unknown }).prosody,
    }
  }
  return next
}

export function mergeCommunicationSignalsPreferExistingProsody(
  existing: unknown,
  incoming: Record<string, unknown>,
) {
  const next = { ...incoming }
  if (hasRealProsody(existing)) delete next.prosody
  return mergeCommunicationSignals(existing, next)
}

export function mergeCommunicationSignalsForAudioInput(input: {
  existing: unknown
  incoming: Record<string, unknown>
  existingSignature: unknown
  currentSignature: string
  incomingSignature?: string | null
}) {
  const incoming = { ...input.incoming }
  const incomingMatches = input.incomingSignature === input.currentSignature
  if (!incomingMatches) delete incoming.prosody
  const existingMatches =
    input.existingSignature === input.currentSignature &&
    hasRealProsody(input.existing)
  const signals = existingMatches
    ? mergeCommunicationSignalsPreferExistingProsody(input.existing, incoming)
    : mergeCommunicationSignals(undefined, incoming)
  return {
    signals,
    audioProcessed:
      (incomingMatches || existingMatches) && hasRealProsody(signals),
  }
}

export function mergeProcessingStatus(
  existing: unknown,
  next: { audioStatus: AudioStatus; audioProcessed: boolean },
) {
  const prev = existing && typeof existing === 'object' ? (existing as Record<string, unknown>) : {}
  const previousStatus = prev.audioStatus
  const previouslyAvailable =
    previousStatus === 'available' || prev.audio_processed === true || next.audioProcessed
  const audioStatus = previouslyAvailable ? 'available' : next.audioStatus
  return {
    ...prev,
    audioStatus,
    audio_processed: prev.audio_processed === true || next.audioProcessed,
  }
}

/** Browser upload retries: network/5xx/429/408 only. 4xx client errors are terminal. */
export function shouldRetryUploadStatus(status: number): boolean {
  if (status >= 500) return true
  return status === 408 || status === 429
}

export function shouldWritePulse(input: {
  autoTrackPulse: boolean
  progressPulseStatus: string | null | undefined
  existingPulseRows: number
}): boolean {
  if (!input.autoTrackPulse) return false
  if (input.progressPulseStatus === 'skipped') return false
  if (input.existingPulseRows > 0) return false
  return true
}
