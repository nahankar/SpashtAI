import { describe, expect, it } from 'vitest'
import { MAX_ENGAGEMENT_MS, sanitizeProductEvent } from '../src/analytics/productEvents'

describe('product event contract', () => {
  it('keeps request latency separate from active time and clamps both', () => {
    const event = sanitizeProductEvent({
      feature: 'app',
      action: 'page_exit',
      duration: 999_999,
      engagementMs: MAX_ENGAGEMENT_MS + 50_000,
      path: '/replay/abc?secret=1',
      outcome: 'completed',
      eventId: 'event-12345678',
      metadata: { path: '/replay/abc', transcript: 'secret words', count: 2 },
    }, 'client')
    expect(typeof event).not.toBe('string')
    if (typeof event === 'string') return
    expect(event.duration).toBe(120_000)
    expect(event.engagementMs).toBe(MAX_ENGAGEMENT_MS)
    expect(event.path).toBe('/replay/abc')
    expect(event.metadata).toEqual({ path: '/replay/abc', count: 2 })
    expect(event.schemaVersion).toBe(2)
  })

  it('rejects client attempts to forge server-only milestones', () => {
    expect(sanitizeProductEvent({ feature: 'replay', action: 'process_completed' }, 'client')).toBe('Invalid feature or action')
  })

  it('accepts the existing server milestone names', () => {
    const event = sanitizeProductEvent({ feature: 'interviews', action: 'practice_start', sessionId: 'session_123' }, 'server')
    expect(typeof event).not.toBe('string')
  })

  it('drops privileged-looking content and invalid outcomes', () => {
    const event = sanitizeProductEvent({
      feature: 'feedback',
      action: 'submitted',
      outcome: 'leaked',
      metadata: { body: 'a long complaint', type: 'ISSUE' },
    }, 'server')
    if (typeof event === 'string') throw new Error(event)
    expect(event.outcome).toBeNull()
    expect(event.metadata).toEqual({ type: 'ISSUE' })
    expect(event.schemaVersion).toBe(1)
  })
})
