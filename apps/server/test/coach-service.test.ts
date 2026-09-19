import { describe, expect, it } from 'vitest'
import type { CoachContext } from '../src/coach/context'
import { extractJsonObject } from '../src/coach/bedrock'
import { parseCoachResponse } from '../src/coach/service'

const context: CoachContext = {
  pulse: {
    windowDays: 30,
    measurementCount: 2,
    skills: [{ skill: 'pacing', score: 5.4, delta: -0.4, measurements: 2 }],
  },
  preparation: {
    id: 'prep-known',
    title: 'Google interview',
    company: 'Google',
    role: 'Engineer',
    interviewDate: null,
    nextStage: {
      id: 'stage-known',
      name: 'HR',
      type: 'HR_SCREEN',
      scheduledAt: null,
    },
  },
  lastElevate: null,
  lastReplay: null,
}

describe('Coach model response validation', () => {
  it('extracts JSON from fenced model output', () => {
    expect(extractJsonObject('```json\n{"reply":"Ready"}\n```')).toEqual({ reply: 'Ready' })
  })

  it('accepts a valid baseline recommendation', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'Your filler rate is already healthy. Let’s assess the broader picture.',
        goalTitle: null,
        clarify: null,
        recommend: {
          module: 'elevate',
          label: 'Start baseline',
          reason: 'This will measure clarity, pace, confidence, and fillers together.',
          brief: {
            focusArea: 'snapshot',
            scenario: 'Run a broad communication baseline.',
            durationSec: 180,
            preparationId: null,
            stageId: null,
          },
        },
      }),
      context,
    )

    expect(response?.recommend?.brief.focusArea).toBe('snapshot')
    expect(response?.recommend?.module).toBe('elevate')
  })

  it('rejects hallucinated preparation identifiers', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'Let’s practise for the HR round.',
        goalTitle: null,
        clarify: null,
        recommend: {
          module: 'elevate',
          label: 'Start practice',
          reason: 'The HR round is next.',
          brief: {
            focusArea: 'confidence',
            scenario: 'Answer an HR motivation question.',
            durationSec: 300,
            preparationId: 'prep-invented',
            stageId: 'stage-invented',
          },
        },
      }),
      context,
    )

    expect(response?.recommend?.brief.preparationId).toBeNull()
    expect(response?.recommend?.brief.stageId).toBeNull()
  })

  it('never exposes a recommendation beside a clarification', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'One detail will change the drill.',
        goalTitle: null,
        clarify: { question: 'Who is the audience?', options: ['Investors', 'Customers'] },
        recommend: {
          module: 'elevate',
          label: 'Start practice',
          reason: 'Practise now.',
          brief: {},
        },
      }),
      context,
    )

    expect(response?.clarify?.question).toBe('Who is the audience?')
    expect(response?.recommend).toBeNull()
    expect(response?.evidence).toBeNull()
  })

  it('attaches a server-owned Pulse scorecard for an explicit scores question', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'Here is your current Pulse.',
        goalTitle: null,
        clarify: null,
        recommend: {
          module: 'elevate',
          label: 'Practise pacing in Elevate',
          reason: 'Pacing is the most useful focus.',
          brief: { focusArea: 'pacing' },
        },
        evidence: 'scores',
      }),
      {
        ...context,
        pulse: {
          windowDays: 30,
          measurementCount: 4,
          skills: [
            { skill: 'clarity', score: 8.1, delta: 0.4, measurements: 3 },
            { skill: 'pacing', score: 5.4, delta: -0.4, measurements: 2 },
          ],
        },
      },
      'What are my scores?',
    )

    expect(response?.evidence).toMatchObject({
      mode: 'scores',
      measurementCount: 4,
      windowDays: 30,
      highlight: { kind: 'strongest', skill: 'clarity' },
      opportunity: { skill: 'pacing' },
    })
    expect(response?.evidence?.skills.map((skill) => skill.skill)).toEqual([
      'clarity',
      'pacing',
    ])
  })

  it('drops a duration promise from a practice label, since Elevate is not time-boxed', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'Pacing is the most useful focus.',
        goalTitle: null,
        clarify: null,
        recommend: {
          module: 'elevate',
          label: 'Start 3-minute pacing drill',
          reason: 'Pacing is your weakest tracked skill.',
          brief: { focusArea: 'pacing' },
        },
      }),
      context,
    )

    expect(response?.recommend?.label).toBe('Practise pacing in Elevate')
  })

  it('keeps a duration on the snapshot, which really is three fixed questions', () => {
    const response = parseCoachResponse(
      JSON.stringify({
        reply: 'Let’s measure the broader picture first.',
        goalTitle: null,
        clarify: null,
        recommend: {
          module: 'elevate',
          label: 'Start 3-minute snapshot',
          reason: 'A baseline covers every skill at once.',
          brief: { focusArea: 'snapshot', durationSec: 180 },
        },
      }),
      context,
    )

    expect(response?.recommend?.label).toBe('Start 3-minute snapshot')
  })
})
