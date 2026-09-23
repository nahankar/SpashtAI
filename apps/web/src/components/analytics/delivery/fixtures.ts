import type { DeliveryEvidenceState, DeliveryMoment } from './contract'

export const experimentalMoment: DeliveryMoment = {
  id: 'pause-1',
  clip: { startSeconds: 72.4, durationSeconds: 3.2, availability: 'available' },
  provenance: { audioInputSignature: 'server-signature-1', analyzerVersion: 'delivery-raw-v1' },
  capture: { agc: 'on', noiseSuppression: 'unknown' },
  captureFingerprint: 'agc:on|noise:unknown',
  evidence: {
    quality: 'verified',
    method: 'word_aligned_recording',
    measurement: { metric: 'pause_duration', value: 0.8, unit: 'seconds' },
  },
}

export const unavailableMoment: DeliveryMoment = {
  id: 'pitch-2',
  clip: { startSeconds: 98.1, durationSeconds: 2.5, availability: 'unavailable' },
  provenance: { audioInputSignature: 'server-signature-1', analyzerVersion: 'delivery-raw-v1' },
  capture: { agc: 'unknown', noiseSuppression: 'on' },
  captureFingerprint: 'agc:unknown|noise:on',
  evidence: { quality: 'insufficient', reason: 'recording_missing' },
}

export const pitchMoment: DeliveryMoment = {
  id: 'pitch-3',
  clip: { startSeconds: 120, durationSeconds: 4, availability: 'available' },
  provenance: { audioInputSignature: 'server-signature-1', analyzerVersion: 'delivery-raw-v1' },
  capture: { agc: 'off', noiseSuppression: 'off' },
  captureFingerprint: 'agc:off|noise:off',
  evidence: {
    quality: 'verified',
    method: 'validated_acoustic_extraction',
    measurement: { metric: 'mean_f0', value: 184.3, unit: 'Hz' },
  },
  calibration: { state: 'experimental' },
}

export const audioLevelMoment: DeliveryMoment = {
  id: 'level-4',
  clip: { startSeconds: 140, durationSeconds: 2, availability: 'available' },
  provenance: { audioInputSignature: 'server-signature-1', analyzerVersion: 'delivery-raw-v1' },
  capture: { agc: 'on', noiseSuppression: 'on' },
  captureFingerprint: 'agc:on|noise:on',
  evidence: {
    quality: 'verified',
    method: 'recorded_waveform',
    measurement: { metric: 'intensity', value: 62.5, unit: 'dB' },
  },
}

export const deliveryFixtures: Record<string, DeliveryEvidenceState> = {
  ready: { state: 'ready', moments: [experimentalMoment, unavailableMoment, pitchMoment, audioLevelMoment] },
  empty: { state: 'empty' },
  pending: { state: 'pending' },
  insufficient: { state: 'insufficient_evidence', reason: 'insufficient_voiced_signal' },
  unavailable: { state: 'unavailable', reason: 'Recording was not retained.' },
  error: { state: 'error', message: 'Evidence processing failed.' },
}
