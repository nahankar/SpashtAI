type ClipMedia = Pick<HTMLMediaElement, 'currentTime' | 'paused' | 'pause'>

export function isElevateRecordingReady(input: {
  sessionId: string | undefined
  audioSessionId: string | null
  audioUrl: string | null
  audioAvailable: boolean
  audioLoading: boolean
  duration: number
}): boolean {
  return Boolean(input.sessionId && input.audioSessionId === input.sessionId && input.audioUrl)
    && input.audioAvailable && !input.audioLoading
    && Number.isFinite(input.duration) && input.duration > 0
}

type DurationMedia = Pick<HTMLMediaElement,
  'currentTime' | 'duration' | 'addEventListener' | 'removeEventListener'>

/** Resolve indefinite WebM duration without publishing readiness during the probe. */
export function watchElevateRecordingDuration(
  media: DurationMedia,
  onReady: (duration: number) => void,
  onFailure: () => void,
  timeoutMs = 10_000,
): () => void {
  let disposed = false
  let probing = false
  const startTime = media.currentTime
  let timeout: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    disposed = true
    clearTimeout(timeout)
    media.removeEventListener('timeupdate', ready)
    media.removeEventListener('durationchange', ready)
  }
  const fail = () => {
    if (disposed) return
    cleanup()
    onFailure()
  }
  function ready() {
    if (disposed || !Number.isFinite(media.duration) || media.duration <= 0) return
    cleanup()
    try {
      if (probing) media.currentTime = startTime
    } catch {
      onFailure()
      return
    }
    onReady(media.duration)
  }
  ready()
  if (!disposed) {
    probing = true
    media.addEventListener('timeupdate', ready)
    media.addEventListener('durationchange', ready)
    timeout = setTimeout(fail, timeoutMs)
    try {
      media.currentTime = 1e7
    } catch {
      fail()
    }
  }
  return cleanup
}

/** Owns an exact recording interval, including any silence inside it. */
export class ElevateDeliveryClip {
  private selected: { media: ClipMedia; start: number; end: number } | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private onStop: (time: number) => void

  constructor(onStop: (time: number) => void) {
    this.onStop = onStop
  }

  select(media: ClipMedia, start: number, end: number) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new RangeError('Select a valid recording interval.')
    }
    media.pause()
    this.cancel()
    this.selected = { media, start, end }
    media.currentTime = start
  }

  hasSelection(media: ClipMedia) {
    return this.selected?.media === media
  }

  cancel() {
    this.stopWatching()
    this.selected = null
  }

  stopWatching() {
    clearTimeout(this.timer)
    this.timer = undefined
  }

  /** Returns true even on the stopping tick: callers must not skip a gap then. */
  sync(media: ClipMedia): boolean {
    const clip = this.selected
    if (!clip || clip.media !== media) return false
    if (media.currentTime >= clip.end) {
      media.pause()
      media.currentTime = clip.end
      this.cancel()
      this.onStop(clip.end)
    } else if (media.currentTime < clip.start) {
      media.currentTime = clip.start
    }
    return true
  }

  // Independent of skip intervals and RAF; real browser scheduling can still
  // be throttled. Always clamp the media clock as well as the displayed time.
  watch(media: ClipMedia) {
    this.stopWatching()
    if (!this.hasSelection(media) || media.paused) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.sync(media) && this.hasSelection(media)) this.watch(media)
    }, 50)
  }
}
