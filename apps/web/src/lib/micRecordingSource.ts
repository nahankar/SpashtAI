/**
 * A recording input that outlives any single microphone track. LiveKit stops
 * and replaces its mic track when the input device changes; a MediaRecorder on
 * that track ends early while the session (and its wall clock) keeps running.
 * Routing through Web Audio keeps one continuous timeline: a missing, muted or
 * replaced track records as silence until the next live track is followed.
 */
export interface MicRecordingSource {
  stream: MediaStream
  follow: (track: MediaStreamTrack | undefined) => void
  close: () => void
}

type AudioGraph = Pick<
  AudioContext,
  'createMediaStreamSource' | 'createMediaStreamDestination' | 'resume' | 'close' | 'state'
>

export async function createMicRecordingSource(
  createContext: () => AudioGraph = () => new AudioContext(),
): Promise<MicRecordingSource | null> {
  let context: AudioGraph
  try {
    context = createContext()
  } catch {
    return null
  }
  if (context.state === 'suspended') await context.resume().catch(() => undefined)
  // A suspended graph produces no samples, which would record nothing at all.
  if (context.state !== 'running') {
    void context.close().catch(() => undefined)
    return null
  }

  const destination = context.createMediaStreamDestination()
  let current: MediaStreamTrack | undefined
  let node: MediaStreamAudioSourceNode | undefined
  let closed = false

  const detach = () => {
    node?.disconnect()
    node = undefined
    current = undefined
  }

  return {
    stream: destination.stream,
    follow(track) {
      if (closed) return
      const live = track?.readyState === 'live' ? track : undefined
      if (live === current) return
      detach()
      if (!live) return
      node = context.createMediaStreamSource(new MediaStream([live]))
      node.connect(destination)
      current = live
    },
    close() {
      if (closed) return
      closed = true
      detach()
      void context.close().catch(() => undefined)
    },
  }
}
