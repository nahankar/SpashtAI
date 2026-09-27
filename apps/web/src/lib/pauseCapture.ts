import type {
  AudioCaptureReport,
  SessionRecorderHandle,
} from '@/components/session/SessionRecorder'

/**
 * Seal the MediaRecorder before muting. LiveKit mute stops the microphone
 * track, and that ends an active recorder before its final audio can be read.
 * Resume starts a new segment; playback joins the saved segments.
 */
export async function pauseAfterSealingRecording(actions: {
  sealRecording: () => Promise<void>
  muteMicrophone: () => Promise<void>
  settlePause: () => Promise<void>
}): Promise<boolean> {
  await actions.sealRecording()
  let muted = true
  try {
    await actions.muteMicrophone()
  } catch (error) {
    muted = false
    console.warn('Failed to mute microphone before pause:', error)
  }
  await actions.settlePause()
  return muted
}

/**
 * Finalize the current recording before LiveKit disconnects.
 *
 * A timeout means the upload is still running, not that capture failed. The
 * caller remains in its saving/mic-blocked state while this waits for the same
 * upload promise to settle.
 */
export async function settleRecordingBeforePause(
  recorder: Pick<SessionRecorderHandle, 'finalize' | 'waitForFinalization'>,
  onPending?: () => void,
): Promise<AudioCaptureReport> {
  const initial = await recorder.finalize()
  if (initial.audioCapture !== 'pending') return initial.audioCapture
  onPending?.()
  const settled = await recorder.waitForFinalization()
  return settled.audioCapture
}
