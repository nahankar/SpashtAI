import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ElevateDeliveryClip, isElevateRecordingReady, watchElevateRecordingDuration,
} from './elevateDeliveryClip'

function media() {
  return {
    currentTime: 0,
    paused: true,
    pause: vi.fn(function (this: { paused: boolean }) { this.paused = true }),
    play: vi.fn(async function (this: { paused: boolean }) { this.paused = false }),
  }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('Elevate recording readiness', () => {
  const ready = {
    sessionId: 'session', audioSessionId: 'session', audioUrl: '/audio',
    audioAvailable: true, audioLoading: false, duration: 10,
  }
  it('only enables evidence for the current loaded recording', () => {
    expect(isElevateRecordingReady(ready)).toBe(true)
    for (const pending of [
      { audioSessionId: 'previous-session' }, { audioUrl: null },
      { audioLoading: true }, { audioAvailable: false },
      { duration: Infinity }, { duration: NaN }, { duration: 0 },
      { sessionId: undefined },
    ]) expect(isElevateRecordingReady({ ...ready, ...pending })).toBe(false)
  })

  class MetadataAudio extends EventTarget {
    duration = Infinity
    currentTime = 0
  }

  it('waits for finite WebM duration and cannot overwrite a subsequent evidence seek', () => {
    vi.useFakeTimers()
    const audio = new MetadataAudio()
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const stop = watchElevateRecordingDuration(audio, onReady, onFailure)
    expect(audio.currentTime).toBe(1e7)
    audio.dispatchEvent(new Event('timeupdate'))
    expect(onReady).not.toHaveBeenCalled()
    audio.duration = 10
    audio.dispatchEvent(new Event('durationchange'))
    expect(audio.currentTime).toBe(0)
    expect(onReady).toHaveBeenCalledExactlyOnceWith(10)
    audio.currentTime = 4
    audio.dispatchEvent(new Event('timeupdate'))
    expect(audio.currentTime).toBe(4)
    expect(onFailure).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })

  it('uses available duration without an end probe or seek', () => {
    const audio = new MetadataAudio()
    audio.duration = 12
    audio.currentTime = 3
    const onReady = vi.fn()
    const stop = watchElevateRecordingDuration(audio, onReady, vi.fn())
    expect(onReady).toHaveBeenCalledExactlyOnceWith(12)
    expect(audio.currentTime).toBe(3)
    stop()
  })

  it('times out unknown metadata and does not publish after source cancellation', async () => {
    vi.useFakeTimers()
    const audio = new MetadataAudio()
    const onReady = vi.fn()
    const onFailure = vi.fn()
    const stop = watchElevateRecordingDuration(audio, onReady, onFailure, 100)
    await vi.advanceTimersByTimeAsync(100)
    expect(onFailure).toHaveBeenCalledOnce()
    audio.duration = 10
    audio.dispatchEvent(new Event('durationchange'))
    expect(onReady).not.toHaveBeenCalled()
    stop()
    audio.duration = Infinity
    const cancel = watchElevateRecordingDuration(audio, onReady, onFailure, 100)
    cancel()
    audio.duration = 10
    audio.dispatchEvent(new Event('durationchange'))
    await vi.advanceTimersByTimeAsync(100)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(onReady).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('surfaces a rejected duration-probe seek instead of hanging', () => {
    vi.useFakeTimers()
    const audio = new MetadataAudio()
    Object.defineProperty(audio, 'currentTime', {
      get: () => 0,
      set: () => { throw new Error('Media is not seekable') },
    })
    const onFailure = vi.fn()
    const stop = watchElevateRecordingDuration(audio, vi.fn(), onFailure)
    expect(onFailure).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    stop()
  })
})

describe('Elevate exact delivery clip playback', () => {
  it('seeks to the exact start, preserves silence, and clamps the actual stop time', async () => {
    const audio = media()
    const onStop = vi.fn()
    const clip = new ElevateDeliveryClip(onStop)
    clip.select(audio, 83.2, 88.4)
    expect(audio.currentTime).toBe(83.2)
    await audio.play()
    for (const time of [83.2, 84, 85.5, 87, 88.399]) {
      audio.currentTime = time
      expect(clip.sync(audio)).toBe(true)
      expect(audio.currentTime).toBe(time)
      expect(audio.paused).toBe(false)
      expect(clip.hasSelection(audio)).toBe(true)
    }
    audio.currentTime = 88.412
    expect(clip.sync(audio)).toBe(true)
    expect(audio.paused).toBe(true)
    expect(audio.currentTime).toBe(88.4)
    expect(clip.hasSelection(audio)).toBe(false)
    expect(onStop).toHaveBeenCalledExactlyOnceWith(88.4)
  })

  it('retains the selected clip until pause, so RAF cannot release it before timeupdate', async () => {
    const audio = media()
    const clip = new ElevateDeliveryClip(vi.fn())
    const skipGap = vi.fn()
    clip.select(audio, 10, 12)
    await audio.play()
    audio.pause.mockImplementation(() => {
      expect(clip.hasSelection(audio)).toBe(true)
      audio.paused = true
    })
    audio.currentTime = 12.001
    // Same priority as the production RAF and timeupdate handlers.
    const tick = () => {
      if (!clip.sync(audio) && !audio.paused) skipGap()
    }
    tick()
    tick()
    expect(audio.currentTime).toBe(12)
    expect(audio.pause).toHaveBeenCalledTimes(2)
    expect(skipGap).not.toHaveBeenCalled()
  })

  it.each([
    { skipGaps: true, intervals: [[1, 2], [7, 8]], rate: 1 },
    { skipGaps: false, intervals: [[1, 2], [7, 8]], rate: 1.5 },
    { skipGaps: true, intervals: [], rate: 2 },
    { skipGaps: false, intervals: [], rate: 0.75 },
  ])('stops within 250ms with sparse media events: %j (synthetic clock)', async ({ skipGaps, intervals, rate }) => {
    vi.useFakeTimers()
    const audio = media()
    const stopped = vi.fn()
    const skip = vi.fn()
    const clip = new ElevateDeliveryClip(stopped)
    const end = 5.137
    clip.select(audio, 3, end)
    await audio.play()
    let clockAtPause = 0
    audio.pause.mockImplementation(() => {
      clockAtPause = audio.currentTime
      audio.paused = true
    })
    const clock = setInterval(() => {
      if (!audio.paused) audio.currentTime += 0.01 * rate
    }, 10)
    // Deliberately slower than the required bound; the clip watchdog must win
    // without relying on either RAF or normal timeupdate event frequency.
    const timeupdate = setInterval(() => {
      if (!clip.sync(audio) && !audio.paused && skipGaps && intervals.length) skip()
    }, 1000)
    clip.watch(audio)
    await vi.advanceTimersByTimeAsync(5000)
    expect(clockAtPause - end).toBeGreaterThanOrEqual(0)
    expect(clockAtPause - end).toBeLessThanOrEqual(0.25)
    expect(audio.currentTime).toBe(end)
    expect(audio.paused).toBe(true)
    expect(stopped).toHaveBeenCalledExactlyOnceWith(end)
    expect(skip).not.toHaveBeenCalled()
    clearInterval(clock)
    clearInterval(timeupdate)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps blocked autoplay queued, including silence, until Play is retried', async () => {
    const audio = media()
    const clip = new ElevateDeliveryClip(vi.fn())
    clip.select(audio, 2, 5)
    audio.play.mockRejectedValueOnce(new Error('Autoplay blocked'))
    await expect(audio.play()).rejects.toThrow('Autoplay blocked')
    expect(clip.sync(audio)).toBe(true)
    expect(clip.hasSelection(audio)).toBe(true)
    expect(audio.currentTime).toBe(2)
    await audio.play()
    audio.currentTime = 3.8
    expect(clip.sync(audio)).toBe(true)
    expect(audio.currentTime).toBe(3.8)
    audio.pause()
    clip.stopWatching()
    expect(clip.hasSelection(audio)).toBe(true)
    await audio.play()
    audio.currentTime = 5
    clip.sync(audio)
    expect(audio.paused).toBe(true)
  })

  it('manual seek cancels a blocked or playing clip instead of restarting it', async () => {
    vi.useFakeTimers()
    const audio = media()
    const stopped = vi.fn()
    const clip = new ElevateDeliveryClip(stopped)
    clip.select(audio, 2, 5)
    audio.play.mockRejectedValueOnce(new Error('Autoplay blocked'))
    await expect(audio.play()).rejects.toThrow()
    clip.cancel()
    audio.currentTime = 8
    expect(clip.sync(audio)).toBe(false)
    await audio.play()
    expect(audio.currentTime).toBe(8)
    clip.select(audio, 1, 3)
    await audio.play()
    clip.watch(audio)
    clip.cancel()
    audio.currentTime = 7
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.currentTime).toBe(7)
    expect(stopped).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('isolates media sources and cancels scheduled work on session reset or unmount', async () => {
    vi.useFakeTimers()
    const first = media()
    const next = media()
    const stopped = vi.fn()
    const clip = new ElevateDeliveryClip(stopped)
    clip.select(first, 1, 2)
    await first.play()
    clip.watch(first)
    expect(clip.sync(next)).toBe(false)
    first.pause()
    clip.cancel()
    clip.select(next, 7, 9)
    first.currentTime = 10
    expect(clip.sync(first)).toBe(false)
    expect(next.currentTime).toBe(7)
    clip.cancel()
    await vi.advanceTimersByTimeAsync(1000)
    expect(stopped).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([[2, 2], [5, 2], [-1, 2], [NaN, 2], [1, Infinity]])(
    'rejects invalid bounds %s to %s rather than starting unbounded playback', (start, end) => {
      const audio = media()
      const clip = new ElevateDeliveryClip(vi.fn())
      expect(() => clip.select(audio, start, end)).toThrow(RangeError)
      expect(clip.hasSelection(audio)).toBe(false)
      expect(audio.play).not.toHaveBeenCalled()
    },
  )
})
