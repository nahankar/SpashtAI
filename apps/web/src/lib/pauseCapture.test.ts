import { describe, expect, it, vi } from 'vitest'
import { blobFromRecordingChunks, createRecordingStopGate } from '@/hooks/useAudioRecording'
import { pauseAfterSealingRecording, settleRecordingBeforePause } from './pauseCapture'

describe('Pause recording settlement', () => {
  it('seals the current segment before muting the microphone', async () => {
    const order: string[] = []
    const muted = await pauseAfterSealingRecording({
      sealRecording: async () => { order.push('seal') },
      muteMicrophone: async () => { order.push('mute') },
      settlePause: async () => { order.push('pause') },
    })

    expect(muted).toBe(true)
    expect(order).toEqual(['seal', 'mute', 'pause'])
  })

  it('still pauses when mute fails after the segment is sealed', async () => {
    const order: string[] = []
    const muted = await pauseAfterSealingRecording({
      sealRecording: async () => { order.push('seal') },
      muteMicrophone: async () => { throw new Error('mute failed') },
      settlePause: async () => { order.push('pause') },
    })

    expect(muted).toBe(false)
    expect(order).toEqual(['seal', 'pause'])
  })

  it('keeps buffered audio when the recorder has already stopped', () => {
    const blob = blobFromRecordingChunks([
      new Blob(['hello'], { type: 'audio/webm' }),
      new Blob([], { type: 'audio/webm' }),
    ])
    expect(blob?.size).toBeGreaterThan(0)
    expect(blobFromRecordingChunks([])).toBeNull()
  })

  it('coalesces concurrent Leave, disconnect, and unmount stop calls', async () => {
    class Recorder extends EventTarget {
      state: RecordingState = 'recording'
      stop = vi.fn(() => {
        this.state = 'inactive'
      })
    }
    const recorder = new Recorder()
    const chunks = [new Blob(['complete recording'], { type: 'audio/webm' })]
    const settled = vi.fn()
    const gate = createRecordingStopGate()

    const leave = gate.stop(recorder as unknown as MediaRecorder, () => chunks, settled)
    const disconnect = gate.stop(recorder as unknown as MediaRecorder, () => [], settled)
    const unmount = gate.stop(recorder as unknown as MediaRecorder, () => [], settled)

    expect(leave).toBe(disconnect)
    expect(leave).toBe(unmount)
    expect(recorder.stop).toHaveBeenCalledOnce()

    recorder.dispatchEvent(new Event('stop'))

    await expect(leave).resolves.toMatchObject({ size: chunks[0].size })
    await expect(disconnect).resolves.toMatchObject({ size: chunks[0].size })
    expect(settled).toHaveBeenCalledOnce()
  })

  it('keeps Pause pending until the in-flight upload later succeeds', async () => {
    let finishUpload!: (value: {
      ok: boolean
      audioCapture: 'uploaded'
    }) => void
    const uploadSettled = new Promise<{ ok: boolean; audioCapture: 'uploaded' }>(
      (resolve) => {
        finishUpload = resolve
      },
    )
    const onPending = vi.fn()
    const recorder = {
      finalize: vi.fn().mockResolvedValue({ ok: false, audioCapture: 'pending' }),
      waitForFinalization: vi.fn().mockReturnValue(uploadSettled),
    }

    let completed = false
    const resultPromise = settleRecordingBeforePause(recorder, onPending).then((result) => {
      completed = true
      return result
    })

    await vi.waitFor(() => expect(onPending).toHaveBeenCalledOnce())
    expect(completed).toBe(false)

    finishUpload({ ok: true, audioCapture: 'uploaded' })

    await expect(resultPromise).resolves.toBe('uploaded')
    expect(recorder.waitForFinalization).toHaveBeenCalledOnce()
  })

  it('returns terminal failures without pretending the upload is pending', async () => {
    const recorder = {
      finalize: vi.fn().mockResolvedValue({ ok: false, audioCapture: 'failed' }),
      waitForFinalization: vi.fn(),
    }

    await expect(settleRecordingBeforePause(recorder)).resolves.toBe('failed')
    expect(recorder.waitForFinalization).not.toHaveBeenCalled()
  })
})
