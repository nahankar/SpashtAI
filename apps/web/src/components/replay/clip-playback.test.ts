import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { playReplayClip } from './clip-playback'

class Media extends EventTarget {
  currentTime = 0
  duration = 10
  readyState = 1
  seeking = false
  paused = true
  play = vi.fn(async () => { this.paused = false })
  pause = vi.fn(() => { this.paused = true })
}
describe('Replay bounded clip controller', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false })) })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
  it('seeks exact start, retains mid-clip gaps and stops within 25ms of end', async () => {
    const media = new Media(), end = vi.fn(), abort = new AbortController()
    await playReplayClip(media as unknown as HTMLMediaElement, { start: 1.25, end: 4.5 }, abort.signal, end)
    expect(media.currentTime).toBe(1.25)
    media.currentTime = 2.5 // a gap in the recording: no seek correction
    await vi.advanceTimersByTimeAsync(50)
    expect(media.currentTime).toBe(2.5); expect(media.paused).toBe(false)
    media.currentTime = 4.51
    await vi.advanceTimersByTimeAsync(25)
    expect(media.paused).toBe(true); expect(media.currentTime).toBe(4.5); expect(end).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('aborts on navigation/unmount and cannot continue another session', async () => {
    const media = new Media(), abort = new AbortController()
    await playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 5 }, abort.signal, vi.fn())
    abort.abort()
    expect(media.paused).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('propagates blocked autoplay and removes active listeners/timer', async () => {
    const media = new Media()
    media.play.mockRejectedValue(new Error('Autoplay blocked'))
    await expect(playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 5 }, new AbortController().signal, vi.fn())).rejects.toThrow('Autoplay blocked')
    expect(media.paused).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('waits for media readiness and seek completion', async () => {
    const media = new Media(), abort = new AbortController()
    media.readyState = 0; media.seeking = true
    const playing = playReplayClip(media as unknown as HTMLMediaElement, { start: 2, end: 5 }, abort.signal, vi.fn())
    expect(media.play).not.toHaveBeenCalled()
    media.readyState = 1; media.dispatchEvent(new Event('loadedmetadata')); await Promise.resolve()
    expect(media.play).not.toHaveBeenCalled()
    media.seeking = false; media.dispatchEvent(new Event('seeked')); await playing
    expect(media.currentTime).toBe(2); expect(media.play).toHaveBeenCalledOnce(); abort.abort()
  })
  it('rejects clips outside this media and stops on a hidden page', async () => {
    const media = new Media()
    await expect(playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 11 }, new AbortController().signal, vi.fn())).rejects.toThrow('does not match')
    await playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 5 }, new AbortController().signal, vi.fn())
    Object.defineProperty(document, 'hidden', { value: true }); document.dispatchEvent(new Event('visibilitychange'))
    expect(media.paused).toBe(true)
  })
  it('does not start after loading if the page became hidden', async () => {
    const media = new Media()
    Object.defineProperty(document, 'hidden', { value: true })
    await playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 5 }, new AbortController().signal, vi.fn())
    expect(media.play).not.toHaveBeenCalled()
    expect(media.paused).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['resolve', 'reject'])('does not let a superseded play promise %s interrupt a new clip', async outcome => {
    const media = new Media(), oldEnd = vi.fn(), next = new AbortController()
    let settle!: () => void
    media.play.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      settle = outcome === 'resolve' ? resolve : () => reject(new Error('Old playback cancelled'))
    }))
    const first = playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 2 }, new AbortController().signal, oldEnd)
    await playReplayClip(media as unknown as HTMLMediaElement, { start: 4, end: 8 }, next.signal, vi.fn())
    settle(); await first
    expect(media.paused).toBe(false)
    expect(media.currentTime).toBe(4)
    expect(oldEnd).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    next.abort(); expect(vi.getTimerCount()).toBe(0)
  })
  it('supersedes a metadata wait without allowing an obsolete seek', async () => {
    const media = new Media(), next = new AbortController()
    media.readyState = 0
    const first = playReplayClip(media as unknown as HTMLMediaElement, { start: 0, end: 2 }, new AbortController().signal, vi.fn())
    const second = playReplayClip(media as unknown as HTMLMediaElement, { start: 4, end: 8 }, next.signal, vi.fn())
    media.readyState = 1; media.dispatchEvent(new Event('loadedmetadata'))
    await Promise.all([first, second])
    expect(media.currentTime).toBe(4); expect(media.play).toHaveBeenCalledOnce()
    next.abort(); expect(vi.getTimerCount()).toBe(0)
  })
})
