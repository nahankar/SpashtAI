import { describe, expect, it, vi } from 'vitest'
import { settleRecordingBeforePause } from './pauseCapture'

describe('Pause recording settlement', () => {
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
