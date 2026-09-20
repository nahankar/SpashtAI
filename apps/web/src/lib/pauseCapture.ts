import type {
  AudioCaptureReport,
  SessionRecorderHandle,
} from '@/components/session/SessionRecorder'

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
