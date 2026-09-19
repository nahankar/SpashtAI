import { describe, expect, it } from 'vitest'
import {
  buildPulseEvidence,
  isPulseProgressQuestion,
  isPulseScoreQuestion,
  resolvePulseEvidenceMode,
  summarisePulseSkills,
} from '../src/coach/pulseEvidence'

const skills = [
  { skill: 'clarity', score: 8.1, delta: 0.4, measurements: 3 },
  { skill: 'confidence', score: 7.4, delta: 0.1, measurements: 2 },
  { skill: 'engagement', score: 5.6, delta: 0, measurements: 2 },
]

describe('Coach Pulse evidence grammar', () => {
  it('calls a skill strongest only with comparative measurements and a real gap', () => {
    expect(summarisePulseSkills(skills).highlight).toEqual({
      kind: 'strongest',
      skill: 'clarity',
    })
    expect(
      summarisePulseSkills([
        { skill: 'clarity', score: 8.1, delta: null, measurements: 1 },
        { skill: 'engagement', score: 5.6, delta: null, measurements: 1 },
      ]).highlight,
    ).toEqual({ kind: 'highest', skill: 'clarity' })
  })

  it('uses tracked measurements, not session language, and hides one-point trends', () => {
    const evidence = buildPulseEvidence(skills, { windowDays: 30, measurementCount: 4 }, 'scores')
    expect(evidence).toMatchObject({
      mode: 'scores',
      windowDays: 30,
      measurementCount: 4,
      highlight: { kind: 'strongest', skill: 'clarity' },
      opportunity: { skill: 'engagement' },
    })
    expect(evidence?.skills.find((skill) => skill.skill === 'clarity')?.trend).toBe('up')
    expect(evidence?.skills.find((skill) => skill.skill === 'confidence')?.trend).toBe('steady')
    expect(
      buildPulseEvidence(
        [{ skill: 'engagement', score: 5.6, delta: null, measurements: 1 }],
        { windowDays: 30, measurementCount: 1 },
        'scores',
      )?.skills[0].trend,
    ).toBe('latest')
  })

  it('keeps how-am-I-doing evidence to the skills that justify the advice', () => {
    const evidence = buildPulseEvidence(
      skills,
      { windowDays: 30, measurementCount: 4 },
      'relevant',
      'engagement',
    )
    expect(evidence?.skills.map((skill) => skill.skill)).toEqual([
      'clarity',
      'engagement',
    ])
  })

  it('attaches a full scorecard only for explicit score questions', () => {
    expect(isPulseScoreQuestion('What are my scores?')).toBe(true)
    expect(isPulseProgressQuestion('How am I doing overall?')).toBe(true)
    expect(isPulseScoreQuestion('How am I doing overall?')).toBe(false)
    expect(
      resolvePulseEvidenceMode({
        message: 'I have a presentation tomorrow',
        llmMode: null,
        hasClarification: false,
      }),
    ).toBeNull()
    expect(
      resolvePulseEvidenceMode({
        message: 'How am I doing?',
        llmMode: 'scores',
        hasClarification: true,
      }),
    ).toBeNull()
    expect(
      resolvePulseEvidenceMode({
        message: 'I have a presentation tomorrow',
        llmMode: 'relevant',
        hasClarification: false,
      }),
    ).toBe('relevant')
  })
})
