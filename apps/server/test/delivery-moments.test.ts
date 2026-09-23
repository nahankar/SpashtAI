import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractDeliveryEvidence,
  findDeliveryPauseMoments,
  toDeliveryEvidenceDisplay,
  unresolvedAudioState,
  validateTurnWordTiming,
} from '../src/analytics/deliveryMoments'
import {
  appliedCaptureSettings,
  captureSettingsForDelivery,
  captureFingerprint,
  parseRecordingCaptureSettings,
} from '../src/analytics/deliveryCapture'
import { distributeWords } from '../src/lib/audioAlignment'
import { hasObservedWordTiming } from '../src/routes/turns'

const baseTurn = {
  id: 'turn-1',
  turnIndex: 1,
  segmentId: 'segment-1',
  role: 'user',
  text: 'First we define the outcome. Then we explain the delivery plan clearly.',
  audioStart: 0,
  audioEnd: 8,
}

describe('delivery evidence moments', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('preserves inadequate voiced signal without claiming the recording is incomplete', () => {
    expect(toDeliveryEvidenceDisplay({
      state: 'insufficient_evidence',
      reason: null,
      observations: [{
        turn_id: 'turn-1',
        evidence_state: 'insufficient_evidence',
      }],
    }, 'current')).toEqual({
      state: 'insufficient_evidence',
      reason: 'insufficient_voiced_signal',
    })
    expect(toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 0,
        clip_end_sec: 2,
        audio_input_signature: 'current',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'insufficient_evidence',
        raw_features: { measurement_basis: 'verified_word_spans' },
      }],
    }, 'current')).toMatchObject({
      state: 'ready',
      moments: [{ evidence: { quality: 'insufficient', reason: 'insufficient_signal' } }],
    })
    expect(toDeliveryEvidenceDisplay({ state: 'nonsense', observations: [] }, 'current'))
      .toMatchObject({ state: 'error' })
  })

  it('persists browser-reported capture without mistaking requested settings for applied settings', () => {
    const raw = {
      autoGainControl: { requested: true, applied: false, supported: true },
      noiseSuppression: { requested: true, supported: false },
      echoCancellation: { requested: false, applied: false, supported: true },
      voiceIsolation: { requested: true, applied: true, supported: true },
    }
    const parsed = parseRecordingCaptureSettings(JSON.stringify(raw))
    expect(parsed).toEqual(raw)
    expect(appliedCaptureSettings(parsed)).toEqual({
      automaticGainControl: false,
      noiseSuppression: null,
      echoCancellation: false,
      voiceIsolation: true,
    })
    expect(captureFingerprint(parsed)).toContain('autoGainControl:false:true:true')
    expect(() => parseRecordingCaptureSettings('{"autoGainControl":"on"}')).toThrow()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(captureSettingsForDelivery('legacy-segment', { autoGainControl: 'on' }))
      .toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('legacy-segment; treating capture as unknown'),
    )
    warn.mockRestore()

    const display = toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 0,
        clip_end_sec: 2,
        audio_input_signature: 'current',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'available',
        capture_caveats: ['automatic_gain_control_enabled'],
        raw_features: { measurement_basis: 'verified_word_spans', mean_f0_hz: 180 },
      }],
    }, 'current', new Map([['turn-1', parsed]]))
    expect(display).toMatchObject({
      state: 'ready',
      moments: [{ capture: { agc: 'off', noiseSuppression: 'unknown' } }],
    })
  })

  it('reanalyzes changed accepted alignment or capture even when audio signature is unchanged', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          state: 'available',
          observations: [{
            turn_id: 'turn-1',
            clip_start_sec: 0,
            clip_end_sec: 4,
            audio_input_signature: 'current',
            analyzer_version: 'delivery-raw-v1',
            evidence_state: 'available',
            raw_features: { measurement_basis: 'verified_word_spans', mean_f0_hz: 180 },
          }],
        }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const words = Array.from({ length: 8 }, (_, index) => ({
      w: `word${index}`,
      start: index * 0.4,
      end: index * 0.4 + 0.2,
      timingOrigin: 'actual',
    }))
    const turn = {
      id: 'turn-1',
      segmentId: 'segment-1',
      turnIndex: 0,
      role: 'user',
      text: words.map((word) => word.w).join(' '),
      audioStart: 0,
      audioEnd: 4,
      words,
    }
    const segment = { segmentId: 'segment-1', segmentIndex: 0, replayOffsetSec: 0, durationSec: 4 }
    const input = {
      sessionId: `cache-test-${Date.now()}`,
      audioPath: '/tmp/test.wav',
      inputSignature: 'current',
      turns: [turn],
      segments: [segment],
      capturesBySegment: new Map([['segment-1', null]]),
    }
    await extractDeliveryEvidence(input)
    await extractDeliveryEvidence(input)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await extractDeliveryEvidence({
      ...input,
      turns: [{ ...turn, words: words.map((word, index) =>
        index === 1 ? { ...word, end: word.end + 0.05 } : word) }],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await extractDeliveryEvidence({
      ...input,
      capturesBySegment: new Map([['segment-1', parseRecordingCaptureSettings(JSON.stringify({
        autoGainControl: { requested: true, applied: true, supported: true },
        noiseSuppression: { requested: false, applied: false, supported: true },
        echoCancellation: { requested: false, applied: false, supported: true },
        voiceIsolation: { requested: false, applied: false, supported: true },
      }))]]),
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const sent = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(sent.segments[0].capture).toEqual({
      automaticGainControl: true,
      noiseSuppression: false,
      echoCancellation: false,
      voiceIsolation: false,
    })
  })

  it('adapts only current-signature raw measurements into experimental display evidence', () => {
    const display = toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 1,
        clip_end_sec: 4,
        audio_input_signature: 'current',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'available',
        capture_caveats: ['automatic_gain_control_enabled'],
        raw_features: {
          measurement_basis: 'verified_word_spans',
          mean_f0_hz: 180,
          f0_spread_hz: 22,
          intensity_mean_db: 63,
          pause_intervals: [{ start_sec: 2, end_sec: 2.8, duration_sec: 0.8 }],
        },
      }],
    }, 'current')
    expect(display).toMatchObject({ state: 'ready' })
    if (display.state !== 'ready') throw new Error('expected raw display moments')
    expect(display.moments).toHaveLength(4)
    expect(display.moments[0]).toMatchObject({
      provenance: { audioInputSignature: 'current', analyzerVersion: 'delivery-raw-v1' },
      calibration: { state: 'experimental' },
      capture: { agc: 'on', noiseSuppression: 'unknown' },
    })

    expect(display.moments.find((item) => item.evidence.measurement.metric === 'pause_duration'))
      .toMatchObject({ clip: { startSeconds: 1.2, durationSeconds: 2.4 } })
  })

  it('retains measured zero Hz spread and clips pause playback to the available recording', () => {
    const display = toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 1,
        clip_end_sec: 3,
        audio_input_signature: 'current',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'available',
        raw_features: {
          measurement_basis: 'verified_word_spans',
          f0_spread_hz: 0,
          pause_intervals: [{ start_sec: 2.7, end_sec: 2.9, duration_sec: 0.2 }],
        },
      }],
    }, 'current')
    expect(display).toMatchObject({
      state: 'ready',
      moments: [
        { evidence: { measurement: { metric: 'f0_spread', value: 0 } } },
        { clip: { startSeconds: 1.9, durationSeconds: 1.1 } },
      ],
    })
  })

  it('rejects raw delivery observations from another audio input', () => {
    const display = toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 0,
        clip_end_sec: 2,
        audio_input_signature: 'stale',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'available',
        raw_features: { measurement_basis: 'verified_word_spans', mean_f0_hz: 180 },
      }],
    }, 'current')
    expect(display).toEqual({ state: 'unavailable', reason: 'audio_signature_mismatch' })
  })

  it('refuses raw measurements without verified-word-span provenance', () => {
    const display = toDeliveryEvidenceDisplay({
      state: 'available',
      observations: [{
        turn_id: 'turn-1',
        clip_start_sec: 0,
        clip_end_sec: 2,
        audio_input_signature: 'current',
        analyzer_version: 'delivery-raw-v1',
        evidence_state: 'available',
        raw_features: { mean_f0_hz: 180 },
      }],
    }, 'current')
    expect(display).toEqual({
      state: 'insufficient_evidence',
      reason: 'verified_measurements_unavailable',
    })
  })

  it('creates a playable strength only from actual, sentence-bounded word timing', () => {
    const turn = {
      ...baseTurn,
      words: [
        { w: 'First', start: 0, end: 0.2, timingOrigin: 'actual' },
        { w: 'we', start: 0.22, end: 0.35, timingOrigin: 'actual' },
        { w: 'define', start: 0.37, end: 0.7, timingOrigin: 'actual' },
        { w: 'the', start: 0.72, end: 0.82, timingOrigin: 'actual' },
        { w: 'outcome.', start: 0.84, end: 1.2, timingOrigin: 'actual' },
        { w: 'Then', start: 2.0, end: 2.2, timingOrigin: 'actual' },
        { w: 'we', start: 2.22, end: 2.35, timingOrigin: 'actual' },
        { w: 'explain', start: 2.37, end: 2.65, timingOrigin: 'actual' },
        { w: 'the', start: 2.67, end: 2.77, timingOrigin: 'actual' },
        { w: 'delivery', start: 2.79, end: 3.1, timingOrigin: 'actual' },
        { w: 'plan', start: 3.12, end: 3.3, timingOrigin: 'actual' },
        { w: 'clearly.', start: 3.32, end: 3.7, timingOrigin: 'actual' },
      ],
    }
    const moments = findDeliveryPauseMoments([turn], new Map([['segment-1', 10]]), 20)
    expect(moments).toHaveLength(1)
    expect(moments[0]).toMatchObject({
      kind: 'sentence_boundary_pause',
      polarity: 'strength',
      startSec: 11.2,
      endSec: 12,
    })
  })

  it('fails closed for synthetic karaoke timing', () => {
    const turn = {
      ...baseTurn,
      words: Array.from({ length: 12 }, (_, index) => ({
        w: index === 4 ? 'outcome.' : `word${index}`,
        start: index * 0.4,
        end: index * 0.4 + 0.2,
        timingOrigin: 'synthetic',
      })),
    }
    expect(validateTurnWordTiming(turn)).toBeNull()
    expect(findDeliveryPauseMoments([turn])).toEqual([])
  })

  it('does not turn an unbounded silence count into a delivery claim', () => {
    const turn = {
      ...baseTurn,
      words: [
        { w: 'First', start: 0, end: 0.2, timingOrigin: 'actual' },
        { w: 'we', start: 0.22, end: 0.35, timingOrigin: 'actual' },
        { w: 'define', start: 0.37, end: 0.7, timingOrigin: 'actual' },
        { w: 'the', start: 0.72, end: 0.82, timingOrigin: 'actual' },
        { w: 'outcome', start: 0.84, end: 1.2, timingOrigin: 'actual' },
        { w: 'Then', start: 5.5, end: 5.7, timingOrigin: 'actual' },
        { w: 'we', start: 5.72, end: 5.85, timingOrigin: 'actual' },
        { w: 'explain', start: 5.87, end: 6.15, timingOrigin: 'actual' },
        { w: 'the', start: 6.17, end: 6.27, timingOrigin: 'actual' },
        { w: 'delivery', start: 6.29, end: 6.6, timingOrigin: 'actual' },
        { w: 'plan', start: 6.62, end: 6.8, timingOrigin: 'actual' },
        { w: 'clearly.', start: 6.82, end: 7.2, timingOrigin: 'actual' },
      ],
    }
    expect(findDeliveryPauseMoments([turn])).toEqual([])
  })

  it('does not call a clause-boundary pause an interruption', () => {
    const turn = {
      ...baseTurn,
      text: 'First we define the outcome, then we explain the delivery plan clearly.',
      words: [
        { w: 'First', start: 0, end: 0.2, timingOrigin: 'actual' },
        { w: 'we', start: 0.22, end: 0.35, timingOrigin: 'actual' },
        { w: 'define', start: 0.37, end: 0.7, timingOrigin: 'actual' },
        { w: 'the', start: 0.72, end: 0.82, timingOrigin: 'actual' },
        { w: 'outcome,', start: 0.84, end: 1.2, timingOrigin: 'actual' },
        { w: 'then', start: 2.4, end: 2.6, timingOrigin: 'actual' },
        { w: 'we', start: 2.62, end: 2.75, timingOrigin: 'actual' },
        { w: 'explain', start: 2.77, end: 3.05, timingOrigin: 'actual' },
        { w: 'the', start: 3.07, end: 3.17, timingOrigin: 'actual' },
        { w: 'delivery', start: 3.19, end: 3.5, timingOrigin: 'actual' },
        { w: 'plan', start: 3.52, end: 3.7, timingOrigin: 'actual' },
        { w: 'clearly.', start: 3.72, end: 4.1, timingOrigin: 'actual' },
      ],
    }
    expect(findDeliveryPauseMoments([turn])).toEqual([])
  })

  it('rejects word timing outside its resolved audio segment', () => {
    const turn = {
      ...baseTurn,
      words: [
        { w: 'First', start: 0, end: 0.2, timingOrigin: 'actual' },
        { w: 'we', start: 0.22, end: 0.35, timingOrigin: 'actual' },
        { w: 'define', start: 0.37, end: 0.7, timingOrigin: 'actual' },
        { w: 'the', start: 0.72, end: 0.82, timingOrigin: 'actual' },
        { w: 'outcome.', start: 0.84, end: 1.2, timingOrigin: 'actual' },
        { w: 'Then', start: 2.0, end: 2.2, timingOrigin: 'actual' },
        { w: 'we', start: 2.22, end: 2.35, timingOrigin: 'actual' },
        { w: 'explain', start: 2.37, end: 2.65, timingOrigin: 'actual' },
        { w: 'the', start: 2.67, end: 2.77, timingOrigin: 'actual' },
        { w: 'delivery', start: 2.79, end: 3.1, timingOrigin: 'actual' },
        { w: 'plan', start: 3.12, end: 3.3, timingOrigin: 'actual' },
        { w: 'clearly.', start: 3.32, end: 3.7, timingOrigin: 'actual' },
      ],
    }
    expect(
      findDeliveryPauseMoments(
        [turn],
        new Map([['segment-1', 0]]),
        4,
        new Map([['segment-1', 3]]),
      ),
    ).toEqual([])
  })

  it('does not preserve actual provenance when Replay redistributes words', () => {
    expect(
      distributeWords(
        [{ w: 'First', start: 0, end: 0.1, timingOrigin: 'actual' }],
        2,
        3,
      ),
    ).toEqual([{ w: 'First', start: 2, end: 3, timingOrigin: 'synthetic' }])
  })

  it('accepts compatible observed-timing provenance without accepting synthetic timing', () => {
    expect(
      hasObservedWordTiming([
        { w: 'one', start: 0, end: 0.2, timing_origin: 'forced_alignment' },
      ]),
    ).toBe(true)
    expect(
      hasObservedWordTiming([
        { w: 'one', start: 0, end: 0.2, timingOrigin: 'synthetic' },
      ]),
    ).toBe(false)
    expect(
      hasObservedWordTiming([
        { w: 'one', start: '0', end: '0.2', timingOrigin: 'actual' },
      ]),
    ).toBe(false)
  })

  it('only reports pending while an audio segment is genuinely in flight', () => {
    expect(unresolvedAudioState([{ audioStatus: 'pending' }])).toBe('pending')
    expect(
      unresolvedAudioState([
        { audioStatus: 'available' },
        { audioStatus: 'unavailable' },
      ]),
    ).toBe('suppressed')
  })
})
