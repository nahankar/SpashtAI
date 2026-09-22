import { describe, expect, it } from 'vitest'
import { assessPaceEvidence, measuredTurnVariability } from '../src/analytics/pace'
import { calculateWeightedOverallScore } from '../src/analytics/skillScores'

describe('authoritative pace contract', () => {
  it('accepts complete measured turn evidence and calculates weighted WPM', () => {
    const result = assessPaceEvidence(
      {
        source: 'validated_turn_audio',
        status: 'available',
        totalWords: 342,
        speakingSeconds: 195.1,
        samples: 9,
        estimatedSamples: 0,
      },
      342,
    )

    expect(result.status).toBe('available')
    expect(result.confidence).toBe('medium')
    expect(result.wpm).toBeCloseTo(105.18, 2)
  })

  it('rejects a merged silence span with no labelled timing source', () => {
    const result = assessPaceEvidence(
      {
        status: 'available',
        totalWords: 342,
        speakingSeconds: 360.457,
        samples: 1,
        estimatedSamples: 0,
      },
      342,
    )

    expect(result.status).toBe('insufficient_evidence')
    expect(result.wpm).toBeNull()
  })

  it('rejects estimated samples and incomplete timestamp coverage', () => {
    expect(
      assessPaceEvidence(
        {
          source: 'validated_turn_audio',
          status: 'available',
          totalWords: 100,
          speakingSeconds: 50,
          samples: 3,
          estimatedSamples: 1,
        },
        100,
      ).wpm,
    ).toBeNull()

    expect(
      assessPaceEvidence(
        {
          source: 'word_timestamps',
          status: 'available',
          totalWords: 50,
          speakingSeconds: 25,
          samples: 3,
          estimatedSamples: 0,
        },
        100,
      ).wpm,
    ).toBeNull()
  })

  it('excludes unavailable pacing from the weighted communication score', () => {
    const score = calculateWeightedOverallScore({
      clarity: 8,
      conciseness: 8,
      confidence: 8,
      structure: 8,
      engagement: 8,
      pacing: null,
      delivery: null,
      emotionalControl: null,
    })

    expect(score).toBe(8)
  })

  it('excludes micro-turns and estimated timings from pace variability', () => {
    const variability = measuredTurnVariability([
      {
        role: 'user',
        metrics: {
          word_count: 3,
          wpm: 257,
          speaking_seconds: 0.7,
          pace_source: 'validated_turn_audio',
        },
      },
      {
        role: 'user',
        metrics: {
          word_count: 100,
          wpm: 100,
          speaking_seconds: 60,
          pace_source: 'validated_turn_audio',
        },
      },
      {
        role: 'user',
        metrics: {
          word_count: 100,
          wpm: 120,
          speaking_seconds: 50,
          pace_source: 'word_timestamps',
        },
      },
      {
        role: 'user',
        metrics: {
          word_count: 100,
          wpm: 150,
          speaking_seconds: 40,
          pace_source: 'estimated',
        },
      },
    ])

    expect(variability).toBeCloseTo(0.0909, 3)
  })

  it('requires validated timestamp evidence for high-confidence pace', () => {
    const valid = assessPaceEvidence(
      {
        source: 'word_timestamps',
        status: 'available',
        totalWords: 100,
        speakingSeconds: 50,
        samples: 3,
        estimatedSamples: 0,
        timestampedWordCount: 100,
        transcriptWordCount: 100,
        invalidTimestampCount: 0,
        outOfOrderTimestampCount: 0,
      },
      100,
    )
    expect(valid.status).toBe('available')
    expect(valid.confidence).toBe('high')

    const invalid = assessPaceEvidence(
      {
        ...valid,
        status: 'available',
        invalidTimestampCount: 1,
      },
      100,
    )
    expect(invalid.status).toBe('insufficient_evidence')
    expect(invalid.wpm).toBeNull()
  })
})
