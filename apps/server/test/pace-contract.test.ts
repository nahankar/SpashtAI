import { describe, expect, it } from 'vitest'
import {
  assessPaceEvidence,
  measuredTurnVariability,
  selectPreferredPaceAssessment,
  selectBestPaceEvidence,
} from '../src/analytics/pace'
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

  it('reconciles a weighted post-Leave aggregate from persisted measured turns', () => {
    const result = selectBestPaceEvidence(
      null,
      [
        {
          role: 'user',
          metrics: {
            word_count: 20,
            speaking_seconds: 8.1,
            wpm: 147.8,
            pace_source: 'validated_turn_audio',
          },
        },
        {
          role: 'user',
          metrics: {
            word_count: 64,
            speaking_seconds: 36.3,
            wpm: 105.6,
            pace_source: 'word_timestamps',
          },
        },
        {
          role: 'user',
          metrics: {
            word_count: 3,
            speaking_seconds: 3.1,
            wpm: 58.3,
            pace_source: 'word_timestamps',
          },
        },
      ],
      87,
    )

    expect(result.status).toBe('available')
    expect(result.origin).toBe('reconciled_committed_turns')
    expect(result.source).toBe('validated_turn_audio')
    expect(result.confidence).toBe('medium')
    expect(result.samples).toBe(2)
    expect(result.totalWords).toBe(84)
    expect(result.wpm).toBeCloseTo(113.51, 2)
    expect(result.excludedMicroTurnCount).toBe(1)
    expect(result.sourceComposition).toEqual({
      wordTimestampSamples: 1,
      validatedTurnAudioSamples: 1,
    })
  })

  it('keeps a short fast burst diagnostic but does not count it as a headline sample', () => {
    const result = selectBestPaceEvidence(
      null,
      [
        {
          role: 'user',
          metrics: {
            word_count: 8,
            speaking_seconds: 1.57,
            wpm: 305.7,
            pace_source: 'word_timestamps',
          },
        },
        {
          role: 'user',
          metrics: {
            word_count: 20,
            speaking_seconds: 10,
            wpm: 120,
            pace_source: 'word_timestamps',
          },
        },
      ],
      28,
    )

    expect(result.status).toBe('insufficient_evidence')
    expect(result.wpm).toBeNull()
    expect(result.samples).toBe(1)
    expect(result.totalWords).toBe(20)
    expect(result.observedSamples).toBe(2)
    expect(result.observedWords).toBe(28)
    expect(result.excludedShortDurationCount).toBe(1)
  })

  it('keeps higher-confidence live evidence over the reconstructed candidate', () => {
    const result = selectBestPaceEvidence(
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
      [
        {
          role: 'user',
          metrics: {
            word_count: 100,
            speaking_seconds: 60,
            wpm: 100,
            pace_source: 'validated_turn_audio',
          },
        },
        {
          role: 'user',
          metrics: {
            word_count: 20,
            speaking_seconds: 10,
            wpm: 120,
            pace_source: 'validated_turn_audio',
          },
        },
      ],
      100,
    )

    expect(result.source).toBe('word_timestamps')
    expect(result.confidence).toBe('high')
    expect(result.wpm).toBe(120)
  })

  it('preserves available persisted pace against a delayed empty payload', () => {
    const persisted = assessPaceEvidence(
      {
        source: 'validated_turn_audio',
        status: 'available',
        totalWords: 100,
        speakingSeconds: 50,
        samples: 3,
        estimatedSamples: 0,
      },
      100,
    )
    const incoming = assessPaceEvidence(
      {
        source: null,
        status: 'insufficient_evidence',
        totalWords: 0,
        speakingSeconds: 0,
        samples: 0,
      },
      100,
    )

    const selected = selectPreferredPaceAssessment(persisted, incoming)
    expect(selected.status).toBe('available')
    expect(selected.wpm).toBe(120)
    expect(selected.totalWords).toBe(100)
  })
})
