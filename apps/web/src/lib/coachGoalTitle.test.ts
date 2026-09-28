import { describe, expect, it } from 'vitest'
import { coachGoalTitleNeedsUpdate, suggestCoachGoalTitle } from './coachGoalTitle'

describe('suggestCoachGoalTitle', () => {
  it('names a snapshot request until a specific skill appears', () => {
    expect(
      suggestCoachGoalTitle({
        userMessages: ['Assess my skills'],
        focusAreas: ['snapshot'],
      }),
    ).toBe('Communication snapshot')
  })

  it('prefers the latest specific practice focus over the opening assessment', () => {
    expect(
      suggestCoachGoalTitle({
        userMessages: ['Assess my skills'],
        focusAreas: ['snapshot', 'structure'],
      }),
    ).toBe('Improve structure')
  })

  it('names an explicit skill from the first message', () => {
    expect(
      suggestCoachGoalTitle({
        userMessages: ['I want to reduce filler words'],
        focusAreas: [],
      }),
    ).toBe('Reduce filler words')
  })

  it('shortens an unnamed request so the goal is editable', () => {
    expect(
      suggestCoachGoalTitle({
        userMessages: ['Help me prepare my Q3 board update?'],
        focusAreas: [],
      }),
    ).toBe('Help me prepare my Q3 board')
  })

  it('does not invent a title before the user has said anything', () => {
    expect(suggestCoachGoalTitle({ userMessages: [], focusAreas: [] })).toBeNull()
  })
})

describe('coachGoalTitleNeedsUpdate', () => {
  it('fills an empty title and replaces only the generic snapshot name', () => {
    expect(coachGoalTitleNeedsUpdate(null, 'Improve structure')).toBe(true)
    expect(coachGoalTitleNeedsUpdate('Communication snapshot', 'Improve structure')).toBe(true)
    expect(coachGoalTitleNeedsUpdate('Board update', 'Improve structure')).toBe(false)
    expect(coachGoalTitleNeedsUpdate('Improve structure', 'Improve structure')).toBe(false)
  })
})
