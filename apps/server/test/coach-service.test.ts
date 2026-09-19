import { describe, expect, it } from 'vitest'
import type { CoachContext } from '../src/coach/context'
import { extractJsonObject } from '../src/coach/bedrock'
import { parseCoachResponse } from '../src/coach/service'

const context: CoachContext = {
  pulse: [{ skill: 'pacing', score: 5.4, delta: -0.4, sessions: 2 }],
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
  })
})
