import { describe, expect, it } from 'vitest'
import { PRACTICE_DIFFICULTIES, STANDARD_DURATIONS, durationLabel } from './interview-practice'

describe('interview practice setup defaults', () => {
  it('starts with every supported difficulty selected', () => {
    expect(PRACTICE_DIFFICULTIES).toEqual(['Simple', 'Medium', 'Complex', 'Very Complex'])
  })
  it('labels no time limit without implying unlimited questions', () => {
    expect(durationLabel(null, 8)).toBe('No time limit (up to 8 questions)')
    expect(durationLabel(30, 8)).toBe('30 minutes')
    expect(STANDARD_DURATIONS).toEqual({ plan: 'standard', allowed: [5, 10, 15], default: 10 })
  })
})
