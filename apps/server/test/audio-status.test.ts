import { describe, expect, it } from 'vitest'
import {
  hasRealProsody,
  mergeCommunicationSignals,
  mergeProcessingStatus,
  resolveAudioStatus,
  shouldRetryUploadStatus,
  shouldWritePulse,
} from '../src/analytics/audioStatus'

describe('Elevate audio status', () => {
  it('does not treat a wait timeout as unavailable', () => {
    expect(resolveAudioStatus({ hasReadableRecording: false, capture: 'pending' })).toBe('pending')
    expect(resolveAudioStatus({ hasReadableRecording: false, capture: 'uploaded' })).toBe('pending')
    expect(resolveAudioStatus({ hasReadableRecording: false })).toBe('pending')
  })

  it('uses failed vs unavailable only for terminal capture outcomes', () => {
    expect(resolveAudioStatus({ hasReadableRecording: false, capture: 'failed' })).toBe('failed')
    expect(resolveAudioStatus({ hasReadableRecording: false, capture: 'unavailable' })).toBe(
      'unavailable',
    )
    expect(resolveAudioStatus({ hasReadableRecording: true, capture: 'failed' })).toBe('available')
  })

  it('requires an actual prosody object, not a delivery score', () => {
    expect(hasRealProsody({ delivery: 7.2 })).toBe(false)
    expect(hasRealProsody({ scores: { delivery: 7.2 } })).toBe(false)
    expect(hasRealProsody({ prosody: { pitchVariation: 6.1 } })).toBe(true)
    expect(hasRealProsody({ prosody: {} })).toBe(false)
    expect(hasRealProsody({ prosody: { pitchVariation: '6.1' } })).toBe(false)
    expect(hasRealProsody({ prosody: { pitchVariation: Number.NaN } })).toBe(false)
    expect(hasRealProsody({ prosody: { pauseCount: 0 } })).toBe(true)
  })

  it('does not let a no-audio run overwrite real prosody', () => {
    const merged = mergeCommunicationSignals(
      { fillers: { rate: 0.1 }, prosody: { voiceQuality: 8 } },
      { fillers: { rate: 0.2 } },
    )
    expect(merged.prosody).toEqual({ voiceQuality: 8 })
    expect(merged.fillers).toEqual({ rate: 0.2 })
    expect(
      mergeCommunicationSignals({ fillers: { rate: 0.1 } }, { fillers: { rate: 0.2 }, prosody: {} }),
    ).toEqual({ fillers: { rate: 0.2 } })
  })

  it('does not write Pulse when skipped, already saved, or not requested', () => {
    expect(
      shouldWritePulse({
        autoTrackPulse: true,
        progressPulseStatus: 'skipped',
        existingPulseRows: 0,
      }),
    ).toBe(false)
    expect(
      shouldWritePulse({
        autoTrackPulse: true,
        progressPulseStatus: null,
        existingPulseRows: 3,
      }),
    ).toBe(false)
    expect(
      shouldWritePulse({
        autoTrackPulse: false,
        progressPulseStatus: null,
        existingPulseRows: 0,
      }),
    ).toBe(false)
    expect(
      shouldWritePulse({
        autoTrackPulse: true,
        progressPulseStatus: null,
        existingPulseRows: 0,
      }),
    ).toBe(true)
  })

  it('does not let a later no-audio analyze downgrade available audio', () => {
    expect(
      mergeProcessingStatus(
        { audioStatus: 'available', audio_processed: true },
        { audioStatus: 'pending', audioProcessed: false },
      ),
    ).toMatchObject({ audioStatus: 'available', audio_processed: true })
    expect(
      mergeProcessingStatus(
        { audioStatus: 'available', audio_processed: true },
        { audioStatus: 'failed', audioProcessed: false },
      ),
    ).toMatchObject({ audioStatus: 'available', audio_processed: true })
    expect(
      mergeProcessingStatus(
        { audioStatus: 'available', audio_processed: true },
        { audioStatus: 'unavailable', audioProcessed: false },
      ),
    ).toMatchObject({ audioStatus: 'available', audio_processed: true })
  })

  it('keeps failed upload text-only until a recording appears', () => {
    expect(
      mergeProcessingStatus({}, { audioStatus: 'failed', audioProcessed: false }),
    ).toMatchObject({ audioStatus: 'failed', audio_processed: false })
    expect(hasRealProsody({ fillers: { rate: 0.04 } })).toBe(false)
  })

  it('retries only network-class upload failures', () => {
    expect(shouldRetryUploadStatus(500)).toBe(true)
    expect(shouldRetryUploadStatus(429)).toBe(true)
    expect(shouldRetryUploadStatus(400)).toBe(false)
    expect(shouldRetryUploadStatus(413)).toBe(false)
    expect(shouldRetryUploadStatus(401)).toBe(false)
    expect(shouldRetryUploadStatus(403)).toBe(false)
  })
})
