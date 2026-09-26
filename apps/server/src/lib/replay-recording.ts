import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { digest, replaySegments, type ReplayRecording } from './replay-evidence'
import { REPLAY_PARSER_VERSION } from './replay-word-evidence'
import type { TranscriptionResult } from './aws-transcribe'
const exec = promisify(execFile)
export async function identifyReplayRecording(upload: { id: string; storedPath: string }): Promise<ReplayRecording> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(upload.storedPath)) hash.update(chunk)
  let duration: number | null = null
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', upload.storedPath], { timeout: 5000, maxBuffer: 16384 })
    const n = Number(stdout.trim())
    if (Number.isFinite(n) && n > 0) duration = n
  } catch { /* Missing playable duration is explicitly unavailable, never estimated. */ }
  return { uploadId: upload.id, signature: hash.digest('hex'), duration, timelineOrigin: 'retained_media_seconds' }
}
export function replayCacheKey(recording: ReplayRecording, config: string): string {
  return digest({ signature: recording.signature, uploadId: recording.uploadId, config, parser: REPLAY_PARSER_VERSION })
}

/** Older segment-only caches cannot be upgraded merely by assigning a new key. */
export function isReusableReplayCache(value: unknown, key: string): value is TranscriptionResult & { source?: string; cacheKey: string } {
  if (!value || typeof value !== 'object') return false
  const cached = value as Record<string, any>
  return !!key && cached.cacheKey === key && typeof cached.fullText === 'string' && !!cached.fullText.trim() && replaySegments(cached.segments).length > 0 &&
    cached.wordEvidence?.version === REPLAY_PARSER_VERSION && Array.isArray(cached.wordEvidence.words) && cached.wordEvidence.words.length > 0 &&
    ['aws_batch', 'aws_streaming'].includes(cached.wordEvidence.provider) && cached.wordEvidence.complete === true
}
