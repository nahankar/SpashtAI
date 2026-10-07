import { describe, expect, it, vi } from 'vitest'
import { fixture, recorder } from './test-fixtures'
async function joined() { const f = fixture(); await f.controller.resume('existing'); f.calls.length = 0; return f }
describe('shared pause and disconnect behavior', () => {
  it('abandons a pending pause when Leave ends the segment first (intentional change)', async () => {
    const f = await joined(); const capture = recorder('pending'); let resolve!: (value: { ok: boolean; audioCapture: 'uploaded' }) => void
    vi.mocked(capture.waitForFinalization).mockReturnValue(new Promise(r => { resolve = r }))
    const pause = f.controller.pause(capture)
    await vi.waitFor(() => expect(capture.waitForFinalization).toHaveBeenCalledOnce())
    vi.mocked(capture.finalize).mockResolvedValue({ ok: true, audioCapture: 'uploaded' })
    await f.controller.leave(capture, (await import('./adapters/elevate')).elevateAdapter(f.api, f.config))
    const segmentCloses = () => f.calls.filter(c => c.method === 'PATCH').length
    expect(segmentCloses()).toBe(1)
    resolve({ ok: true, audioCapture: 'uploaded' }); await pause
    // The pause must not close the already-closed segment again or re-enter a paused state.
    expect(segmentCloses()).toBe(1)
    expect(f.controller.getSnapshot()).toMatchObject({ sessionId: null, isSessionPaused: false, pauseReason: null, isPausing: false })
  })
  it('closes successful recording before releasing the room', async () => {
    const f = await joined(); const capture = recorder(); const room = f.controller.getSnapshot().roomName
    const listener = vi.fn(); f.controller.subscribe(listener)
    await f.controller.pause(capture)
    expect(capture.finalize).toHaveBeenCalledOnce()
    expect(f.calls[0].body).toEqual({ audioStatus: 'available', endedAt: '2026-10-07T00:00:00.000Z' })
    expect(f.controller.getSnapshot()).toMatchObject({ sessionId: 'existing', token: null, pauseReason: 'intentional', isSessionPaused: true })
    expect(room).not.toBe(''); expect(listener).toHaveBeenCalled()
  })
  it('waits for a pending upload and keeps the room while it settles', async () => {
    const f = await joined(); const capture = recorder('pending'); let resolve!: (value: { ok: boolean; audioCapture: 'uploaded' }) => void
    vi.mocked(capture.waitForFinalization).mockReturnValue(new Promise(r => { resolve = r }))
    const pause = f.controller.pause(capture)
    await vi.waitFor(() => expect(capture.waitForFinalization).toHaveBeenCalledOnce())
    expect(f.controller.getSnapshot().token).not.toBeNull(); expect(f.calls).toHaveLength(0)
    expect(f.effects.toast).toHaveBeenCalledWith('info', 'Saving this part before pausing…')
    resolve({ ok: true, audioCapture: 'uploaded' }); await pause
    expect(f.calls[0].body.audioStatus).toBe('available')
  })
  it.each(['retry', 'without', 'continue'])('supports failed recording recovery: %s', async action => {
    const f = await joined(); const capture = recorder('failed')
    await f.controller.pause(capture)
    expect(f.controller.getSnapshot()).toMatchObject({ pauseAudioFailure: 'failed', isSessionPaused: false })
    const previousRoom = f.controller.getSnapshot().roomName
    if (action === 'retry') await f.controller.retryPauseUpload(capture)
    if (action === 'without') await f.controller.pauseWithoutReplayAudio()
    if (action === 'continue') await f.controller.continueInNewSegment()
    expect(f.calls[0].body.audioStatus).toBe(action === 'retry' ? 'available' : 'failed')
    if (action === 'continue') {
      expect(f.calls.map(c => c.method)).toEqual(['PATCH', 'POST', 'GET'])
      expect(f.controller.getSnapshot().roomName).not.toBe(previousRoom)
    } else expect(f.controller.getSnapshot().isSessionPaused).toBe(true)
  })
  it('makes unexpected disconnect resumable and handles the segment once', async () => {
    const f = await joined(); const binding = f.controller.getSnapshot(); const capture = recorder('failed')
    await f.controller.onDisconnected(capture, binding)
    await f.controller.onDisconnected(capture, binding)
    expect(capture.finalize).toHaveBeenCalledOnce(); expect(f.calls).toHaveLength(1)
    expect(f.controller.getSnapshot()).toMatchObject({ sessionId: 'existing', pauseReason: 'disconnected', token: null })
    expect(f.effects.clearMessages).not.toHaveBeenCalled()
  })
  it('ignores intentional and stale disconnects after resume', async () => {
    const f = await joined(); const old = f.controller.getSnapshot(); const capture = recorder()
    await f.controller.pause(capture)
    await f.controller.resume('existing')
    const current = f.controller.getSnapshot()
    await f.controller.onDisconnected(capture, old)
    expect(f.controller.getSnapshot()).toEqual(current)
    expect(capture.finalize).toHaveBeenCalledOnce()
  })
  it('keeps the pause failure panel when the segment close fails', async () => {
    const f = await joined(); f.fetcher.mockRejectedValueOnce(new Error('closure failed'))
    await f.controller.pause(recorder())
    expect(f.controller.getSnapshot()).toMatchObject({ pauseAudioFailure: 'failed', isPausing: false })
    expect(f.controller.getSnapshot().token).not.toBeNull()
  })
})
