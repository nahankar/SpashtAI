import { describe, expect, it } from 'vitest'
import {
  deliveryEvidenceQuality,
  isDeliverySignatureCurrent,
  mergeAdvancedProcessingStatus,
  planDeliverySignatureUpdate,
  resolveEffectiveDeliverySignature,
  selectAcceptedDeliveryMetrics,
  selectPreferredDeliveryMetrics,
} from '../src/routes/advanced-metrics'

describe('advanced delivery evidence selection', () => {
  it('never infers a delivery signature for an unsigned agent result', () => {
    // An internal credential authenticates the sender, not the audio snapshot
    // used by an asynchronous delivery-analysis job.
    expect(resolveEffectiveDeliverySignature(null)).toBeNull()
    expect(resolveEffectiveDeliverySignature('segments-a')).toBe('segments-a')
  })

  it('clears processed state when stale delivery is removed without current prosody', () => {
    expect(
      mergeAdvancedProcessingStatus({
        previous: {
          audio_processed: true,
          deliveryAudioInputSignature: 'segments-a',
        },
        incoming: { audio_processed: true },
        deliveryPresent: true,
        deliveryUpdatePlan: 'clear',
        effectiveSignature: 'segments-a',
        currentProsodyRemains: false,
      }),
    ).toMatchObject({
      audio_processed: false,
      delivery_metrics_stale: true,
      deliveryAudioInputSignature: null,
    })
  })

  it('preserves aligned delivery metrics against a prosody-only fallback', () => {
    const aligned = {
      speech_rate: 132,
      articulation_rate: 154,
      timing_origin: 'forced_alignment',
      evidence_quality: 2,
    }
    const fallback = {
      speech_rate: 0,
      articulation_rate: 0,
      pitch_variation: 5.2,
      timing_origin: 'prosody_only',
      evidence_quality: 1,
    }
    expect(selectPreferredDeliveryMetrics(aligned, fallback)).toBe(aligned)
  })

  it('allows equal or stronger evidence to replace the existing block', () => {
    const forced = { evidence_quality: 2, timing_origin: 'forced_alignment' }
    const timestamped = {
      evidence_quality: 3,
      timing_origin: 'validated_word_timestamps',
    }
    expect(selectPreferredDeliveryMetrics(forced, timestamped)).toBe(timestamped)
    expect(deliveryEvidenceQuality({ speech_rate: 120 })).toBe(2)
  })

  it('retains broader alignment coverage when evidence quality is equal', () => {
    const broad = { evidence_quality: 2, aligned_word_count: 80 }
    const narrow = { evidence_quality: 2, aligned_word_count: 1 }
    expect(selectPreferredDeliveryMetrics(broad, narrow)).toBe(broad)
    expect(selectPreferredDeliveryMetrics(narrow, broad)).toBe(broad)
  })

  it('rejects delayed delivery evidence from a different audio input', () => {
    expect(isDeliverySignatureCurrent('segments-a', 'segments-b')).toBe(false)
    expect(isDeliverySignatureCurrent(null, 'segments-b')).toBe(false)
    expect(isDeliverySignatureCurrent('segments-b', 'segments-b')).toBe(true)
    expect(
      planDeliverySignatureUpdate({
        suppliedSignature: 'segments-a',
        currentSignature: 'segments-b',
        existingSignature: 'segments-a',
      }),
    ).toBe('clear')
    expect(
      planDeliverySignatureUpdate({
        suppliedSignature: 'segments-a',
        currentSignature: 'segments-b',
        existingSignature: 'segments-b',
      }),
    ).toBe('preserve')
  })

  it('never certifies richer superseded delivery data as the current result', () => {
    const staleButRicher = {
      evidence_quality: 3,
      aligned_word_count: 400,
      timing_origin: 'validated_word_timestamps',
    }
    const currentButWeaker = {
      evidence_quality: 1,
      aligned_word_count: 0,
      timing_origin: 'prosody_only',
    }

    expect(
      selectAcceptedDeliveryMetrics({
        existing: staleButRicher,
        existingSignature: 'segments-a',
        currentSignature: 'segments-b',
        incoming: currentButWeaker,
      }),
    ).toBe(currentButWeaker)
  })

  it('still prefers the stronger result when both describe the current audio', () => {
    const richer = { evidence_quality: 3, aligned_word_count: 400 }
    const weaker = { evidence_quality: 1, aligned_word_count: 0 }

    expect(
      selectAcceptedDeliveryMetrics({
        existing: richer,
        existingSignature: 'segments-b',
        currentSignature: 'segments-b',
        incoming: weaker,
      }),
    ).toBe(richer)
  })
})
