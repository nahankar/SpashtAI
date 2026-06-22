import { readFileSync, statSync } from 'fs'

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024 // 15 MB

export function readAudioBytes(filePath: string): Uint8Array {
  const maxBytes = parseInt(process.env.INSIGHT_AUDIO_MAX_BYTES || '', 10) || DEFAULT_MAX_BYTES
  const size = statSync(filePath).size
  if (size > maxBytes) {
    throw new Error(
      `Audio file too large (${(size / 1024 / 1024).toFixed(1)} MB). ` +
        `Max ${(maxBytes / 1024 / 1024).toFixed(0)} MB (INSIGHT_AUDIO_MAX_BYTES).`,
    )
  }
  return new Uint8Array(readFileSync(filePath))
}
