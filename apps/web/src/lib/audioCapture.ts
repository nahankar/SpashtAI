import type { AudioCaptureOptions } from 'livekit-client'

function audioFlag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value !== 'false' && value !== '0'
}

// The mic track published to LiveKit is the same track SessionRecorder captures, so these
// constraints also decide what the prosody analysis sees. Auto gain control flattens
// loudness, which is what energy stability measures — override to compare locally.
export const AUDIO_CAPTURE: AudioCaptureOptions = {
  echoCancellation: audioFlag(import.meta.env.VITE_AUDIO_ECHO_CANCELLATION, true),
  noiseSuppression: audioFlag(import.meta.env.VITE_AUDIO_NOISE_SUPPRESSION, true),
  autoGainControl: audioFlag(import.meta.env.VITE_AUDIO_AUTO_GAIN_CONTROL, true),
  voiceIsolation: audioFlag(import.meta.env.VITE_AUDIO_VOICE_ISOLATION, true),
}

const AUDIO_CAPTURE_KEYS = [
  'echoCancellation',
  'noiseSuppression',
  'autoGainControl',
  'voiceIsolation',
] as const

type AudioCaptureKey = (typeof AUDIO_CAPTURE_KEYS)[number]

/**
 * Compare what we asked getUserMedia for against what the track actually applied.
 *
 * These are ideal (not exact) constraints, so the browser silently degrades any it
 * cannot honour. `voiceIsolation` in particular is only applied where the platform
 * exposes a voice-isolation processor, so `requested: true, applied: false` is a
 * device capability limit rather than a misconfiguration — `supported` distinguishes
 * "the browser does not know this constraint" from "it knows it but could not use it".
 */
export function describeAudioCapture(
  track: MediaStreamTrack,
): Record<AudioCaptureKey, { requested?: boolean; applied?: boolean; supported: boolean }> {
  const settings = track.getSettings() as MediaTrackSettings & { voiceIsolation?: boolean }
  const supported = navigator.mediaDevices.getSupportedConstraints() as MediaTrackSupportedConstraints & {
    voiceIsolation?: boolean
  }
  return Object.fromEntries(
    AUDIO_CAPTURE_KEYS.map((key) => [
      key,
      {
        requested: AUDIO_CAPTURE[key] as boolean | undefined,
        applied: settings[key],
        supported: Boolean(supported[key]),
      },
    ]),
  ) as Record<AudioCaptureKey, { requested?: boolean; applied?: boolean; supported: boolean }>
}
