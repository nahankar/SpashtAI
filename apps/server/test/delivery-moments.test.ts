import { describe, expect, it } from 'vitest'
import {
  findDeliveryPauseMoments,
  unresolvedAudioState,
  validateTurnWordTiming,
} from '../src/analytics/deliveryMoments'
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
