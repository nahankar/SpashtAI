import { describe, expect, it } from 'vitest'
import { activityCreationPolicy, isPulseEligible, isStandaloneCommunication, resolveContextScope } from '../src/lib/activityPolicy'

describe('activity policies', () => {
  it('preserves personalized ordinary Elevate and isolates ordinary Replay', () => {
    expect(activityCreationPolicy(false, true)).toMatchObject({ purpose: 'COMMUNICATION', contextScope: 'COMMUNICATION_PROFILE' })
    expect(activityCreationPolicy(false, false)).toMatchObject({ purpose: 'COMMUNICATION', contextScope: 'SESSION_ONLY' })
    expect(activityCreationPolicy(true, true)).toMatchObject({ purpose: 'INTERVIEW', contextScope: 'JOURNEY' })
  })
  it('excludes standalone interviews without requiring a journey link', () => {
    expect(isStandaloneCommunication({ purpose: 'INTERVIEW' })).toBe(false)
    expect(isPulseEligible({ purpose: 'INTERVIEW' })).toBe(false)
    expect(isPulseEligible({ purpose: 'GOAL_PREPARATION' })).toBe(false)
    expect(isPulseEligible({})).toBe(false)
    expect(isPulseEligible({ purpose: 'COMMUNICATION', focusArea: 'snapshot' })).toBe(false)
  })
  it('never grants communication-profile memory to interview practice', () => {
    expect(resolveContextScope({ purpose: 'INTERVIEW', contextScope: 'COMMUNICATION_PROFILE' })).toBe('SESSION_ONLY')
    expect(resolveContextScope({ purpose: 'COMMUNICATION' })).toBe('SESSION_ONLY')
    expect(resolveContextScope({ purpose: 'INTERVIEW', preparationPractice: { id: 'p1' } })).toBe('JOURNEY')
  })
})
