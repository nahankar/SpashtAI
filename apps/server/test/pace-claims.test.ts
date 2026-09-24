import { describe, expect, it } from 'vitest'
import {
  guardPaceClaims,
  hasPaceClaim,
  isPersistedPaceAvailable,
  PACE_UNSCORED_NOTE,
} from '../src/analytics/paceClaims'
import { buildCoachingPrompt } from '../src/analytics/coachingPrompt'

const insights = {
  topStrength: 'You kept a confident and clear communication style.',
  primaryImprovement: 'Focusing on pacing will make your messages even more effective.',
  actionableAdvice:
    'Aim for 120–140 WPM by pausing after each key point. Lead with your main idea first.',
  practiceExercise: 'Record a 60-second answer and slow down on the opening line.',
  overallNarrative:
    'Great session! Your structure was clear. Speaking a bit fast at times made some points harder to follow.',
  practicePlan: [
    { title: 'Pace ladder', description: 'Read at 120 WPM.', focusSkill: 'Pacing' },
    { title: 'One idea per sentence', description: 'Split long sentences.', focusSkill: 'Clarity' },
  ],
}

describe('pace claim guard', () => {
  it('removes pace advice and adds a neutral note when pace is unavailable', () => {
    const guarded = guardPaceClaims(insights, false) as Record<string, unknown>

    expect(guarded.topStrength).toBe(insights.topStrength)
    expect(guarded.primaryImprovement).toBeUndefined()
    expect(guarded.actionableAdvice).toBe('Lead with your main idea first.')
    expect(guarded.practiceExercise).toBeUndefined()
    expect(guarded.overallNarrative).toBe('Great session! Your structure was clear.')
    expect(guarded.practicePlan).toEqual([insights.practicePlan[1]])
    expect(guarded.paceNote).toBe(PACE_UNSCORED_NOTE)
    expect(JSON.stringify(guarded)).not.toMatch(/WPM|pacing|slow down/i)
  })

  it('leaves insights untouched when pace is verified', () => {
    expect(guardPaceClaims(insights, true)).toBe(insights)
  })

  it('does not add a note when nothing mentions pace', () => {
    const clean = { topStrength: 'Clear structure.', primaryImprovement: 'Use fewer fillers.' }
    expect(guardPaceClaims(clean, false)).toEqual(clean)
  })

  it('does not treat unrelated words as pace claims', () => {
    expect(hasPaceClaim('Give your audience space to respond.')).toBe(false)
    expect(hasPaceClaim('Replace fillers with short pauses.')).toBe(false)
    expect(hasPaceClaim('You were speaking too fast.')).toBe(true)
  })

  it('matches the web pace availability contract', () => {
    expect(
      isPersistedPaceAvailable({
        pace: { status: 'available', source: 'word_timestamps', confidence: 'high' },
      }),
    ).toBe(true)
    expect(
      isPersistedPaceAvailable({
        pace: { status: 'available', source: 'validated_turn_audio', confidence: 'low' },
      }),
    ).toBe(false)
    expect(isPersistedPaceAvailable({ pace: { status: 'insufficient_evidence' } })).toBe(false)
    expect(isPersistedPaceAvailable(null)).toBe(false)
  })
})

describe('coaching prompt pace instructions', () => {
  const baseSignals = {
    speechRate: { wpm: 0, status: 'insufficient_evidence', source: null, confidence: 'low' },
    fillers: { count: 1, rate: 0.01 },
    hedging: { count: 0, phrases: [] },
    sentenceComplexity: { avgLength: 12, readability: 60 },
    vocabDiversity: { ratio: 0.5 },
    interactionSignals: { questionsAsked: 0 },
    talkListenBalance: { userRatio: 0.5 },
    ideaStructure: { markerCount: 1 },
    topicCoherence: { avgSimilarity: 0.5 },
  }

  it('forbids pace advice when pace is unverified, even with a pacing focus', () => {
    const prompt = buildCoachingPrompt(
      {
        skillScores: {},
        signals: baseSignals,
        focusArea: 'Pacing',
        totalMessages: 10,
        durationSec: 300,
      } as never,
      { includeAudioInstructions: true },
    )
    expect(prompt).toContain('Pace was NOT verified')
    expect(prompt).toContain('do not comment on pace')
    expect(prompt).not.toContain('Listen for delivery: pacing')
  })

  it('keeps pace guidance available when pace is verified', () => {
    const prompt = buildCoachingPrompt(
      {
        skillScores: {},
        signals: {
          ...baseSignals,
          speechRate: { wpm: 140, status: 'available', source: 'word_timestamps', confidence: 'high' },
        },
        focusArea: 'Pacing',
        totalMessages: 10,
        durationSec: 300,
      } as never,
      { includeAudioInstructions: true },
    )
    expect(prompt).not.toContain('Pace was NOT verified')
    expect(prompt).toContain('Listen for delivery: pacing')
  })
})
