/**
 * Chromium flags for the test browser. Fake media flags only provide a permission-free device list; the audio
 * itself always comes from the instrumented virtual microphone (see inject.ts).
 */
export function browserArgs(opts: { muteSpeakers: boolean }): string[] {
  return [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(opts.muteSpeakers ? ['--mute-audio'] : []),
  ]
}
