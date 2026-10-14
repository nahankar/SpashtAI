import { describe, expect, it } from 'vitest'
import { EngagementClock, IDLE_AFTER_MS } from './engagementClock'

describe('engagement clock', () => {
  it('counts visible active time and excludes a hidden tab', () => {
    let now = 0
    const clock = new EngagementClock(() => now)
    now = 10_000
    clock.setHidden(true, now)
    now = 25_000
    clock.setHidden(false, now)
    now = 30_000
    expect(clock.flush(now)).toBe(15_000)
  })

  it('stops 60 seconds after the last activity', () => {
    let now = 0
    const clock = new EngagementClock(() => now)
    clock.markActivity(1_000)
    now = 1_000 + IDLE_AFTER_MS + 30_000
    expect(clock.flush(now)).toBe(1_000 + IDLE_AFTER_MS)
  })

  it('starts a new interval after a route change flush', () => {
    let now = 0
    const clock = new EngagementClock(() => now)
    now = 5_000
    expect(clock.flush(now)).toBe(5_000)
    now = 8_000
    expect(clock.flush(now)).toBe(3_000)
  })
})
