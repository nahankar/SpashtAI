import { describe, expect, it } from 'vitest'
import { hasInsightItems, hintedSpeaker, rankSpeakerChoices, replayInsightsState, replayTranscriptMode } from './replayResultsView'

describe('Replay results view states', () => {
  it('derives confirmation/analyze/complete insight states', () => {
    expect(replayInsightsState('confirmation_required', false)).toBe('confirm_speaker')
    expect(replayInsightsState('confirmed', false)).toBe('ready_to_analyze')
    expect(replayInsightsState('confirmed', true)).toBe('show_insights')
    expect(replayInsightsState('confirmed', false, { assessmentGate: 'insufficient_speech' })).toBe('insufficient_speech')
    expect(replayInsightsState('confirmed', true, { hasFeedback: false, hasMoments: false })).toBe('insights_empty')
  })

  it('ranks a stored speaker hint without treating it as confirmation', () => {
    const speakers = [{ speaker: 'Bob' }, { speaker: 'Neelesh Ahankari' }]
    expect(rankSpeakerChoices(speakers, 'Neelesh').map(item => item.speaker)).toEqual(['Neelesh Ahankari', 'Bob'])
    expect(hintedSpeaker(speakers, 'Neelesh')).toBe('Neelesh Ahankari')
    expect(hintedSpeaker(speakers, 'Priya')).toBeNull()
  })

  it('prevents blank insight cards', () => {
    expect(hasInsightItems([])).toBe(false)
    expect(hasInsightItems(null)).toBe(false)
    expect(hasInsightItems([{ label: 'Ownership' }])).toBe(true)
  })

  it('uses turn-block transcript fallback when annotations are absent', () => {
    expect(replayTranscriptMode(2, 3)).toBe('annotated')
    expect(replayTranscriptMode(0, 3)).toBe('turn_blocks')
    expect(replayTranscriptMode(0, 0)).toBe('full_text')
  })
})
