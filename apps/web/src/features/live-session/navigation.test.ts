import { describe, expect, it } from 'vitest'
import { isReadOnlySession, liveResultLocation, resumeLaunchLocation } from './navigation'

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
  describe('refresh during journey practice', () => {
    const params = new URLSearchParams('newSession=true&preparationId=journey&stageId=stage&coach=1&thread=t1')
    const active = { id: 'session_1', userId: 'u1', endedAt: null, preparationPractice: { preparationId: 'journey', stageId: 'stage' } }

    it('resumes the owner\'s unfinished practice for the same journey, keeping other launch params', () => {
      const url = resumeLaunchLocation(active, { viewerId: 'u1', preparationId: 'journey', params })
      const resumed = new URLSearchParams(url!.split('?')[1])
      expect(resumed.get('session')).toBe('session_1')
      expect(resumed.get('newSession')).toBeNull()
      expect(resumed.get('preparationId')).toBe('journey')
      expect(resumed.get('stageId')).toBe('stage')
      expect(resumed.get('thread')).toBe('t1')
    })

    it.each([
      ['ended', { ...active, endedAt: '2026-10-07T00:00:00Z' }, 'u1', 'journey'],
      ['discarded', { ...active, discardedAt: '2026-10-07T00:00:00Z' }, 'u1', 'journey'],
      ['another user', active, 'admin', 'journey'],
      ['another journey', active, 'u1', 'other'],
      ['standalone', { ...active, preparationPractice: null }, 'u1', 'journey'],
      ['missing', null, 'u1', 'journey'],
    ])('starts fresh when the active session is %s', (_label, session, viewerId, preparationId) => {
      expect(resumeLaunchLocation(session, { viewerId, preparationId, params })).toBeNull()
    })
  })
})

