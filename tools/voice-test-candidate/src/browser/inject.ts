/**
 * Test-browser instrumentation, installed with `context.addInitScript` before any application code runs.
 *
 * 1. Virtual microphone: `navigator.mediaDevices.getUserMedia({audio})` returns a clone of a WebAudio
 *    MediaStreamDestination track. Node pushes synthesized WAV utterances into it on demand (`__vtcPlay`).
 *    The application receives real audio samples through its normal capture path (LiveKit publish and
 *    SessionRecorder) and keeps full control of the track (enable/disable/stop).
 * 2. Microphone monitor: every track handed to the application is tapped, so the evidence shows what the
 *    app's own track carried — including silence while the app had it disabled.
 * 3. Incoming audio: every remote audio track received by any RTCPeerConnection is tapped and streamed to
 *    Node as 16-bit PCM. This is SpashtAI's spoken output as received by the browser.
 *
 * The function is serialized into the page: it must not reference anything outside its own body.
 */
export interface InjectConfig {
  sampleRate: number
  bufferSize: number
}

export function instrumentPage(cfg: InjectConfig): void {
  const w = window as unknown as Record<string, any>
  if (w.__vtc) return
  const now = () => performance.timeOrigin + performance.now()
  const emit = (type: string, data: Record<string, unknown> = {}) => {
    try { void w.__vtcEvent?.({ type, epochMs: now(), ...data }) } catch { /* binding not ready */ }
  }
  const contexts = new Set<AudioContext>()
  const resumeAll = () => contexts.forEach(c => { if (c.state === 'suspended') c.resume().catch(() => undefined) })
  for (const t of ['pointerdown', 'keydown', 'click']) window.addEventListener(t, resumeAll, true)

  let micCtx: AudioContext | null = null
  let micDest: MediaStreamAudioDestinationNode | null = null
  let capCtx: AudioContext | null = null
  const micTracks: MediaStreamTrack[] = []
  // One utterance may arrive as several chunks (sentence-by-sentence synthesis); they are scheduled back to back.
  const playing = new Map<string, { nodes: Set<AudioBufferSourceNode>; stopped: boolean; closed: boolean; nextTime: number; underruns: number; startEpoch: number }>()
  const taps = new Map<string, { close: () => void; kind: string; trackId: string }>()

  function ensureMic() {
    if (!micCtx) {
      micCtx = new AudioContext({ sampleRate: cfg.sampleRate })
      micDest = micCtx.createMediaStreamDestination()
      contexts.add(micCtx)
    }
    return { ctx: micCtx, dest: micDest! }
  }
  function ensureCapture() {
    if (!capCtx) { capCtx = new AudioContext({ sampleRate: cfg.sampleRate }); contexts.add(capCtx) }
    if (capCtx.state === 'suspended') capCtx.resume().catch(() => undefined)
    return capCtx
  }
  function micState() {
    return micTracks.map(t => ({ id: t.id, enabled: t.enabled, readyState: t.readyState, muted: t.muted }))
  }

  function toBase64(input: Float32Array): string {
    const i16 = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const v = Math.max(-1, Math.min(1, input[i]))
      i16[i] = v < 0 ? v * 32768 : v * 32767
    }
    const bytes = new Uint8Array(i16.buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)))
    return btoa(bin)
  }

  function tap(track: MediaStreamTrack, kind: 'incoming' | 'mic') {
    const key = `${kind}:${track.id}`
    if (taps.has(key)) return
    const ctx = ensureCapture()
    const stream = new MediaStream([track])
    let keepAlive: HTMLAudioElement | null = null
    if (kind === 'incoming') {
      // Chrome only pulls remote WebRTC audio into WebAudio while a media element consumes the stream.
      keepAlive = new Audio(); keepAlive.muted = true; keepAlive.srcObject = stream
      keepAlive.play().catch(() => undefined)
    }
    const source = ctx.createMediaStreamSource(stream)
    const proc = ctx.createScriptProcessor(cfg.bufferSize, 1, 1)
    const sink = ctx.createGain(); sink.gain.value = 0
    source.connect(proc); proc.connect(sink); sink.connect(ctx.destination)
    let seq = 0
    proc.onaudioprocess = ev => {
      const data = ev.inputBuffer.getChannelData(0)
      try {
        void w.__vtcAudio?.({ kind, trackId: track.id, seq: seq++, sampleRate: ctx.sampleRate, frames: data.length,
          epochMs: now(), enabled: track.enabled, b64: toBase64(data) })
      } catch { /* binding not ready */ }
    }
    const close = () => {
      try { proc.onaudioprocess = null; source.disconnect(); proc.disconnect(); sink.disconnect() } catch { /* already closed */ }
      if (keepAlive) { keepAlive.pause(); keepAlive.srcObject = null }
      taps.delete(key)
      emit('track_untapped', { kind, trackId: track.id })
    }
    taps.set(key, { close, kind, trackId: track.id })
    track.addEventListener('ended', close)
    emit('track_tapped', { kind, trackId: track.id, ctxState: ctx.state, readyState: track.readyState, label: track.label })
  }

  const md = navigator.mediaDevices
  if (md && md.getUserMedia) {
    const original = md.getUserMedia.bind(md)
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      if (!constraints?.audio) return original(constraints)
      const { ctx, dest } = ensureMic()
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined)
      const track = dest.stream.getAudioTracks()[0].clone()
      micTracks.push(track)
      track.addEventListener('ended', () => emit('mic_track_ended', { trackId: track.id }))
      const stream = new MediaStream([track])
      if (constraints.video) {
        const video = await original({ video: constraints.video })
        video.getVideoTracks().forEach(t => stream.addTrack(t))
      }
      emit('mic_track_created', { trackId: track.id, ctxState: ctx.state, constraints: JSON.stringify(constraints.audio) })
      tap(track, 'mic')
      return stream
    }
  }

  const OriginalPC = window.RTCPeerConnection
  if (OriginalPC) {
    const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof RTCPeerConnection>) {
      const pc = new OriginalPC(...args)
      pc.addEventListener('track', (e: RTCTrackEvent) => { if (e.track.kind === 'audio') tap(e.track, 'incoming') })
      return pc
    } as unknown as typeof RTCPeerConnection
    Wrapped.prototype = OriginalPC.prototype
    Object.setPrototypeOf(Wrapped, OriginalPC)
    w.RTCPeerConnection = Wrapped
  }

  w.__vtc = {
    /** Starts utterance `id`, or appends a chunk to it. `last` closes it; mic_play_end fires when audio runs out. */
    async play(id: string, b64: string, last = true) {
      const { ctx, dest } = ensureMic()
      if (ctx.state !== 'running') await ctx.resume().catch(() => undefined)
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const buffer = await ctx.decodeAudioData(bytes.buffer)
      let entry = playing.get(id)
      const fresh = !entry
      if (!entry) {
        entry = { nodes: new Set(), stopped: false, closed: false, nextTime: ctx.currentTime + 0.05, underruns: 0, startEpoch: now() + 50 }
        playing.set(id, entry)
      } else if (entry.stopped) return { startEpoch: entry.startEpoch, durationMs: 0, ctxState: ctx.state, mic: micState() }
      const e = entry
      if (!fresh && e.nextTime < ctx.currentTime + 0.01) { e.underruns++; e.nextTime = ctx.currentTime + 0.02 }
      const node = ctx.createBufferSource()
      node.buffer = buffer
      node.connect(dest)
      e.nodes.add(node)
      e.closed = last
      node.onended = () => {
        e.nodes.delete(node); node.disconnect()
        if ((e.closed || e.stopped) && e.nodes.size === 0 && playing.get(id) === e) {
          playing.delete(id)
          emit('mic_play_end', { id, stopped: e.stopped, underruns: e.underruns, mic: micState() })
        }
      }
      node.start(e.nextTime)
      e.nextTime += buffer.duration
      return { startEpoch: e.startEpoch, durationMs: buffer.duration * 1000, ctxState: ctx.state, mic: micState() }
    },
    close(id: string) {
      const e = playing.get(id)
      if (!e) return
      e.closed = true
      if (e.nodes.size === 0) { playing.delete(id); emit('mic_play_end', { id, stopped: e.stopped, underruns: e.underruns, mic: micState() }) }
    },
    stop(id?: string) {
      for (const [key, e] of playing) if (!id || key === id) {
        e.stopped = true
        for (const node of [...e.nodes]) { try { node.stop() } catch { /* not started */ } }
        if (e.nodes.size === 0) { playing.delete(key); emit('mic_play_end', { id: key, stopped: true, underruns: e.underruns, mic: micState() }) }
      }
    },
    state() {
      return {
        contexts: [...contexts].map(c => c.state),
        mic: micState(),
        taps: [...taps.values()].map(t => ({ kind: t.kind, trackId: t.trackId })),
        playing: [...playing.keys()],
        mediaElements: [...document.querySelectorAll('audio,video')].map(e => ({ paused: (e as HTMLMediaElement).paused, muted: (e as HTMLMediaElement).muted })),
      }
    },
    release() {
      this.stop()
      for (const t of [...taps.values()]) t.close()
      for (const c of contexts) c.close().catch(() => undefined)
    },
  }
  emit('instrumented', { href: location.pathname })
}
