import type { Clip } from './evidence-contract'

function waitFor(media: HTMLMediaElement, event: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); media.removeEventListener(event, done); media.removeEventListener('error', error); signal.removeEventListener('abort', aborted) }
    const done = () => { cleanup(); resolve() }
    const error = () => { cleanup(); reject(new Error('The recording could not be played.')) }
    const aborted = () => { cleanup(); reject(new DOMException('Playback cancelled', 'AbortError')) }
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Recording readiness timed out. Please retry.')) }, 15000)
    media.addEventListener(event, done, { once: true }); media.addEventListener('error', error, { once: true }); signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}

const activePlayback = new WeakMap<HTMLMediaElement, AbortController>()

/** No skip-gaps. Only the current operation may seek or pause shared media. */
export async function playReplayClip(media: HTMLMediaElement, clip: Clip, signal: AbortSignal, onEnd: () => void): Promise<void> {
  if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start) throw new Error('Invalid evidence clip')
  if (signal.aborted) return
  activePlayback.get(media)?.abort()
  const operation = new AbortController()
  activePlayback.set(media, operation)
  const ownsMedia = () => activePlayback.get(media) === operation
  const abort = () => operation.abort()
  signal.addEventListener('abort', abort, { once: true })
  let stopped = false
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    if (stopped) return
    stopped = true; clearInterval(timer)
    if (ownsMedia()) media.pause()
    media.removeEventListener('timeupdate', check); media.removeEventListener('ended', stop); media.removeEventListener('error', stop)
    document.removeEventListener('visibilitychange', visibility); signal.removeEventListener('abort', abort)
    operation.signal.removeEventListener('abort', stop)
    onEnd()
  }
  const check = () => {
    if (!ownsMedia() || stopped) return
    if (media.currentTime >= clip.end || media.currentTime < clip.start - .05) {
      stop()
      if (ownsMedia() && media.currentTime > clip.end) media.currentTime = clip.end
    }
  }
  const visibility = () => { if (document.hidden) stop() }
  operation.signal.addEventListener('abort', stop, { once: true })
  try {
    media.pause()
    if (media.readyState < 1) await waitFor(media, 'loadedmetadata', operation.signal)
    if (operation.signal.aborted || !ownsMedia()) return
    if (!Number.isFinite(media.duration) || clip.end > media.duration + .02) throw new Error('Clip does not match this recording')
    media.currentTime = clip.start
    if (media.seeking) await waitFor(media, 'seeked', operation.signal)
    if (operation.signal.aborted || !ownsMedia()) return
    media.addEventListener('timeupdate', check); media.addEventListener('ended', stop); media.addEventListener('error', stop)
    document.addEventListener('visibilitychange', visibility)
    timer = setInterval(check, 25)
    if (document.hidden) { stop(); return }
    await media.play()
    // A superseded play() promise may settle after a newer clip has started.
    if (stopped && ownsMedia()) media.pause()
  } catch (error) {
    stop()
    if (!operation.signal.aborted) throw error
  }
}
