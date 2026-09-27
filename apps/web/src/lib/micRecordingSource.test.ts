import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMicRecordingSource } from './micRecordingSource'

function track(readyState: MediaStreamTrackState = 'live') {
  return { readyState } as MediaStreamTrack
}

function fakeContext(state: AudioContextState = 'running') {
  const destination = { stream: { id: 'recording-stream' } }
  const nodes: Array<{ track: MediaStreamTrack; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }> = []
  const context = {
    state,
    resume: vi.fn(async () => { context.state = 'running' }),
    close: vi.fn(async () => undefined),
    createMediaStreamDestination: vi.fn(() => destination),
    createMediaStreamSource: vi.fn((stream: { tracks: MediaStreamTrack[] }) => {
      const node = { track: stream.tracks[0], connect: vi.fn(), disconnect: vi.fn() }
      nodes.push(node)
      return node
    }),
  }
  return { context, destination, nodes }
}

describe('mic recording source', () => {
  beforeEach(() => {
    vi.stubGlobal('MediaStream', class { tracks: MediaStreamTrack[]; constructor(tracks: MediaStreamTrack[]) { this.tracks = tracks } })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('keeps one recording stream while the microphone track is replaced', async () => {
    const { context, destination, nodes } = fakeContext()
    const source = await createMicRecordingSource(() => context as unknown as AudioContext)
    const first = track()
    const replacement = track()

    source!.follow(first)
    source!.follow(first)
    source!.follow(replacement)

    expect(source!.stream).toBe(destination.stream)
    expect(nodes.map((node) => node.track)).toEqual([first, replacement])
    expect(nodes[0].disconnect).toHaveBeenCalledOnce()
    expect(nodes[1].connect).toHaveBeenCalledWith(destination)
  })

  it('detaches an ended track and records silence until a live one appears', async () => {
    const { context, nodes } = fakeContext()
    const source = await createMicRecordingSource(() => context as unknown as AudioContext)
    const mic = track()
    source!.follow(mic)
    ;(mic as { readyState: MediaStreamTrackState }).readyState = 'ended'

    source!.follow(mic)
    source!.follow(undefined)

    expect(nodes).toHaveLength(1)
    expect(nodes[0].disconnect).toHaveBeenCalledOnce()
  })

  it('resumes a suspended context and closes it once', async () => {
    const { context } = fakeContext('suspended')
    const source = await createMicRecordingSource(() => context as unknown as AudioContext)

    expect(context.resume).toHaveBeenCalledOnce()
    source!.close()
    source!.close()
    expect(context.close).toHaveBeenCalledOnce()
  })

  it('returns null when audio cannot run so the caller records the track directly', async () => {
    const { context } = fakeContext('suspended')
    context.resume.mockImplementation(async () => undefined)

    expect(await createMicRecordingSource(() => context as unknown as AudioContext)).toBeNull()
    expect(context.close).toHaveBeenCalledOnce()
  })
})
