import { describe, expect, it } from 'vitest'
import { isReadOnlySession, liveResultLocation } from './navigation'

describe('page session policies', () => {
  it('only resumes an unfinished session owned by the viewer', () => {
    expect(isReadOnlySession({ userId: 'owner', endedAt: null }, 'owner')).toBe(false)
    expect(isReadOnlySession({ userId: 'owner', endedAt: '2026-10-07' }, 'owner')).toBe(true)
    expect(isReadOnlySession({ userId: 'other', endedAt: null }, 'admin')).toBe(true)
    // Preserve the legacy behavior while viewer identity is unresolved.
    expect(isReadOnlySession({ userId: 'owner' }, undefined)).toBe(false)
  })
  it('opens ordinary and Snapshot results at the same Elevate URL', () => {
    expect(liveResultLocation('session', { launchedFromCoach: false })).toBe('/elevate?session=session')
  })
  it('keeps journey and optional stage association in results', () => {
    expect(liveResultLocation('session', { launchedFromCoach: false, preparationId: 'journey' })).toBe('/elevate?session=session&preparationId=journey')
    expect(liveResultLocation('session', { launchedFromCoach: false, preparationId: 'journey', stageId: 'stage' })).toBe('/elevate?session=session&preparationId=journey&stageId=stage')
  })
  it('returns Coach launches to Coach, preserving optional thread and URL escaping', () => {
    expect(liveResultLocation('session', { launchedFromCoach: true })).toBe('/coach?elevateResult=session')
    expect(liveResultLocation('session', { launchedFromCoach: true, originCoachThreadId: 'a&b' })).toBe('/coach?elevateResult=session&thread=a%26b')
  })
})
