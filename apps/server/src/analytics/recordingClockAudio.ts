import { execFile } from 'child_process'
import { promisify } from 'util'
import { envelopeFromPcm16 } from './recordingClockMap'

const execFileAsync = promisify(execFile)
const MAX_SEGMENT_SEC = 45 * 60
const MAX_BUFFER = 80 * 1024 * 1024

/**
 * RMS envelope of one retained recording segment, on that segment's own timeline.
 * Decode seek matches the alignment worker so both clocks describe the same slice.
 */
export async function loadSegmentEnvelopes(
  audioPath: string,
  segments: Array<{ segmentId: string, replayOffsetSec: number, durationSec: number }>,
): Promise<Map<string, Uint8Array> | null> {
  const envelopes = new Map<string, Uint8Array>()
  for (const segment of segments) {
    if (!Number.isFinite(segment.durationSec) || segment.durationSec <= 0 || segment.durationSec > MAX_SEGMENT_SEC) {
      return null
    }
    try {
      const { stdout } = await execFileAsync('ffmpeg', [
        '-nostdin', '-v', 'error', '-i', audioPath,
        '-ss', String(segment.replayOffsetSec), '-t', String(segment.durationSec),
        '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1',
      ], { timeout: 60_000, maxBuffer: MAX_BUFFER, encoding: 'buffer' })
      const bytes = stdout as unknown as Buffer
      if (!Buffer.isBuffer(bytes) || bytes.length < 4 || bytes.length % 2 !== 0) return null
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
      const envelope = envelopeFromPcm16(samples, 16_000)
      if (envelope.length < 50) return null
      envelopes.set(segment.segmentId, envelope)
    } catch {
      return null
    }
  }
  return envelopes
}
