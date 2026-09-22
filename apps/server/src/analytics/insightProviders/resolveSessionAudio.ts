import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { rename, unlink, writeFile } from 'fs/promises'
import { promisify } from 'util'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'

const RECORDING_PRIORITY = ['user', 'room_composite', 'merged_audio', 'agent'] as const

const serverDir = dirname(fileURLToPath(import.meta.url))
const agentAudioRoot = join(serverDir, '../../../../../agent/audio_storage')
// Must stay absolute: these paths are handed to the Python signal API, which
// runs in a different process with a different working directory.
const audioRoot = process.env.LOCAL_AUDIO_PATH
  ? resolve(process.env.LOCAL_AUDIO_PATH)
  : join(serverDir, '../../../audio_storage')
const execFileAsync = promisify(execFile)
const mergeInFlight = new Map<string, Promise<void>>()

export interface ResolvedAudioSegment {
  segmentId: string
  segmentIndex: number
  replayOffsetSec: number
  durationSec: number
}

export interface ResolvedSessionAudio {
  audioPath: string
  audioMime?: string
  segments: ResolvedAudioSegment[]
  inputSignature: string
}

type AudioSignatureClient = Pick<
  Prisma.TransactionClient,
  'sessionSegment' | 'sessionRecording'
>

function digestAudioInputs(inputs: unknown): string {
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex')
}

function segmentInputSignature(segments: Array<any>): string {
  return digestAudioInputs(
    segments
      .map((segment) => ({
        segmentId: segment.id,
        segmentIndex: segment.segmentIndex,
        audioStatus: segment.audioStatus,
        contentHash: segment.recording?.contentHash ?? null,
        fileSize: segment.recording?.fileSize ?? null,
        updatedAt: segment.recording?.updatedAt?.toISOString?.() ?? null,
        filePath: segment.recording?.filePath ?? null,
      })),
  )
}

export async function resolveElevateAudioInputSignature(
  sessionId: string,
  db: AudioSignatureClient = prisma,
): Promise<string> {
  const segments = await db.sessionSegment.findMany({
    where: { sessionId },
    orderBy: { segmentIndex: 'asc' },
    include: { recording: true },
  })
  if (segments.length > 0) return segmentInputSignature(segments)
  const recordings = await db.sessionRecording.findMany({
    where: { sessionId, status: 'completed' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return digestAudioInputs(
    recordings.map((recording) => ({
      id: recording.id,
      recordingType: recording.recordingType,
      contentHash: recording.contentHash ?? null,
      fileSize: recording.fileSize,
      updatedAt: recording.updatedAt?.toISOString?.() ?? null,
      filePath: recording.filePath,
    })),
  )
}

export function resolvePositiveSegmentDuration(
  recordedDuration: number | null | undefined,
  mediaDuration: number | null | undefined,
): number {
  if (Number.isFinite(recordedDuration) && Number(recordedDuration) > 0) {
    return Number(recordedDuration)
  }
  if (Number.isFinite(mediaDuration) && Number(mediaDuration) > 0) {
    return Number(mediaDuration)
  }
  return 0
}

async function probeMediaDuration(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        audioPath,
      ],
      { timeout: 5_000, maxBuffer: 64 * 1024 },
    )
    const duration = Number(stdout.trim())
    return Number.isFinite(duration) && duration > 0 ? duration : 0
  } catch {
    return 0
  }
}

async function ensureMergedRecording(outputPath: string, audioPaths: string[]): Promise<void> {
  if (existsSync(outputPath)) return
  const existing = mergeInFlight.get(outputPath)
  if (existing) return existing

  const task = (async () => {
    const nonce = randomUUID()
    const listPath = `${outputPath}.${nonce}.concat.txt`
    const tempOutput = `${outputPath}.${nonce}.tmp.webm`
    const list = audioPaths
      .map((audioPath) => `file '${audioPath.replace(/'/g, "'\\''")}'`)
      .join('\n')
    await writeFile(listPath, `${list}\n`)
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-vn',
        '-c:a',
        'libopus',
        tempOutput,
      ])
      await rename(tempOutput, outputPath)
    } finally {
      await unlink(listPath).catch(() => undefined)
      await unlink(tempOutput).catch(() => undefined)
    }
  })()
  mergeInFlight.set(outputPath, task)
  try {
    await task
  } finally {
    mergeInFlight.delete(outputPath)
  }
}

function resolveFilePath(storedPath: string): string | null {
  if (!storedPath) return null

  let local = storedPath
  if (storedPath.startsWith('/out/')) {
    local = join(agentAudioRoot, storedPath.replace(/^\/out\//, ''))
  } else if (!storedPath.startsWith('/') && !storedPath.match(/^[A-Za-z]:\\/)) {
    local = join(audioRoot, storedPath)
  }

  return existsSync(local) ? local : null
}

/**
 * Pick the best Elevate session recording and return a readable local path.
 */
export async function resolveElevateSessionAudio(
  sessionId: string,
  options: { requireCompleteSegments?: boolean } = {},
): Promise<ResolvedSessionAudio | null> {
  const segments = await prisma.sessionSegment.findMany({
    where: { sessionId },
    orderBy: { segmentIndex: 'asc' },
    include: { recording: true },
  })
  const inputSignature = segmentInputSignature(segments)
  const segmentCandidates = await Promise.all(segments.map(async (segment) => {
    if (segment.audioStatus !== 'available' || !segment.recording) return null
    const storedPath = segment.recording?.filePath
    if (!storedPath) return null
    const audioPath = resolveFilePath(storedPath)
    if (!audioPath) return null
    let durationSec = resolvePositiveSegmentDuration(
      segment.recordingDurationSec,
      segment.recording!.duration,
    )
    if (durationSec <= 0) durationSec = await probeMediaDuration(audioPath)
    if (durationSec <= 0) {
      console.warn(
        `[audio] omitting segment ${segment.id}: readable file has no trustworthy duration`,
      )
      return null
    }
    return {
      audioPath,
      audioMime: segment.recording?.mimeType || mimeFromPath(audioPath),
      updatedAt: segment.recording!.updatedAt,
      segmentId: segment.id,
      segmentIndex: segment.segmentIndex,
      durationSec,
    }
  }))
  const segmentFiles = segmentCandidates.filter(
    (candidate): candidate is NonNullable<typeof candidate> => candidate != null,
  )
  // `failed` and `unavailable` describe capture outcome, not whether the user
  // spoke.  For example, a user can speak, then deliberately choose “Pause
  // without replay audio”. Replay may sequence the readable subset and label
  // the gap, but session-level delivery evidence must never certify that
  // partial subset as the whole practice.
  const expectedSegments = segments
  if (
    options.requireCompleteSegments &&
    expectedSegments.length > 0 &&
    segmentFiles.length !== expectedSegments.length
  ) {
    console.warn(
      `[audio] refusing partial session audio for ${sessionId}: resolved ${segmentFiles.length}/${expectedSegments.length} expected segments`,
    )
    return null
  }
  let replayOffsetSec = 0
  const resolvedSegments: ResolvedAudioSegment[] = segmentFiles.map((file) => {
    const resolved = {
      segmentId: file.segmentId,
      segmentIndex: file.segmentIndex,
      replayOffsetSec,
      durationSec: file.durationSec,
    }
    replayOffsetSec += file.durationSec
    return resolved
  })

  if (segmentFiles.length === 1) {
    return {
      audioPath: segmentFiles[0].audioPath,
      audioMime: segmentFiles[0].audioMime,
      segments: resolvedSegments,
      inputSignature,
    }
  }

  if (segmentFiles.length > 1) {
    const signature = createHash('sha256')
      .update(segmentFiles.map((f) => `${f.audioPath}:${f.updatedAt.toISOString()}`).join('|'))
      .digest('hex')
      .slice(0, 16)
    const mergedPath = join(audioRoot, `elevate-merged-${sessionId}-${signature}.webm`)
    await ensureMergedRecording(
      mergedPath,
      segmentFiles.map((file) => file.audioPath),
    )
    return {
      audioPath: mergedPath,
      audioMime: 'audio/webm',
      segments: resolvedSegments,
      inputSignature,
    }
  }

  // A segmented session must never fall back to an arbitrary single recording:
  // that would pair partial audio with the full-session legacy transcript.
  if (segments.length > 0) return null

  const recordings = await prisma.sessionRecording.findMany({
    where: { sessionId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  })

  for (const type of RECORDING_PRIORITY) {
    const rec = recordings.find((r) => r.recordingType === type && r.filePath)
    if (!rec?.filePath) continue
    const audioPath = resolveFilePath(rec.filePath)
    if (audioPath) {
      return {
        audioPath,
        audioMime: rec.mimeType || mimeFromPath(audioPath),
        segments: [],
        inputSignature: await resolveElevateAudioInputSignature(sessionId),
      }
    }
  }

  return null
}

export async function resolveSessionSegmentAudio(segmentId: string): Promise<{
  audioPath: string
  audioMime?: string
} | null> {
  const recording = await prisma.sessionRecording.findUnique({
    where: { segmentId },
    select: { filePath: true, mimeType: true, status: true },
  })
  if (!recording?.filePath || recording.status !== 'completed') return null
  const audioPath = resolveFilePath(recording.filePath)
  if (!audioPath) return null
  return {
    audioPath,
    audioMime: recording.mimeType || mimeFromPath(audioPath),
  }
}

export function resolveReplayUploadAudio(storedPath: string, mimeType?: string | null): {
  audioPath: string
  audioMime?: string
} | null {
  const audioPath = resolveFilePath(storedPath)
  if (!audioPath) return null
  return { audioPath, audioMime: mimeType || mimeFromPath(audioPath) }
}

function mimeFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  }
  return ext ? map[ext] : undefined
}

/** Bedrock Converse audio block format keyword */
export function bedrockAudioFormat(filePath: string): 'wav' | 'mp3' | 'ogg' | 'flac' | 'webm' {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'mp3' || ext === 'mpeg') return 'mp3'
  if (ext === 'ogg') return 'ogg'
  if (ext === 'flac') return 'flac'
  if (ext === 'webm') return 'webm'
  return 'wav'
}
