import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleFallbackDispatch } from './useFallbackDispatch'
import { fixture } from './test-fixtures'
afterEach(() => vi.useRealTimers())
describe('fallback dispatch', () => {
  it('waits 15 seconds and sends persisted room identifiers with current auth', async () => {
    vi.useFakeTimers(); const f = fixture(); const accepted = vi.fn()
    scheduleFallbackDispatch(f.api, { roomName: 'room', sessionId: 'session', segmentId: 'segment' }, accepted)
    await vi.advanceTimersByTimeAsync(14999); expect(f.fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(f.calls[0]).toMatchObject({ path: '/livekit/dispatch', method: 'POST', body: { room: 'room', sessionId: 'session', segmentId: 'segment' } })
    expect(accepted).toHaveBeenCalledOnce()
  })
  it('cancels a pending dispatch when the room or assistant state changes', async () => {
    vi.useFakeTimers(); const f = fixture()
    const cancel = scheduleFallbackDispatch(f.api, { roomName: 'old', sessionId: 'session', segmentId: 'segment' }, vi.fn())
    cancel(); await vi.advanceTimersByTimeAsync(15000)
    expect(f.fetcher).not.toHaveBeenCalled()
  })
})
