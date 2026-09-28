import { describe, expect, it } from 'vitest'
import { shouldReturnToElevateList } from './elevateNavigation'

const idle = {
  hasLiveConnection: false,
  paused: false,
  joining: false,
  leaving: false,
}

describe('Elevate header navigation', () => {
  it('returns to the session list when a completed results URL is cleared', () => {
    expect(shouldReturnToElevateList({
      ...idle,
      previousSessionId: 'session-1',
      nextSessionId: null,
    })).toBe(true)
  })

  it('keeps a live, paused, or starting session when its URL has no session id', () => {
    expect(shouldReturnToElevateList({
      ...idle,
      previousSessionId: 'session-1',
      nextSessionId: null,
      hasLiveConnection: true,
    })).toBe(false)
    expect(shouldReturnToElevateList({
      ...idle,
      previousSessionId: 'session-1',
      nextSessionId: null,
      paused: true,
    })).toBe(false)
    expect(shouldReturnToElevateList({
      ...idle,
      previousSessionId: null,
      nextSessionId: null,
    })).toBe(false)
  })
})
