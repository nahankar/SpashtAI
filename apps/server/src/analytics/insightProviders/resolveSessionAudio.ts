import { existsSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { rename, unlink, writeFile } from 'fs/promises'
import { promisify } from 'util'
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
export async function resolveElevateSessionAudio(sessionId: string): Promise<{
  audioPath: string
  audioMime?: string
} | null> {
  const segments = await prisma.sessionSegment.findMany({
    where: { sessionId, audioStatus: 'available', recording: { isNot: null } },
    orderBy: { segmentIndex: 'asc' },
    include: { recording: true },
  })
  const segmentFiles = segments.flatMap((segment) => {
    const storedPath = segment.recording?.filePath
    if (!storedPath) return []
    const audioPath = resolveFilePath(storedPath)
    return audioPath
      ? [{
          audioPath,
          audioMime: segment.recording?.mimeType || mimeFromPath(audioPath),
          updatedAt: segment.recording!.updatedAt,
        }]
      : []
  })

  if (segmentFiles.length === 1) {
    return {
      audioPath: segmentFiles[0].audioPath,
      audioMime: segmentFiles[0].audioMime,
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
    return { audioPath: mergedPath, audioMime: 'audio/webm' }
  }

  const recordings = await prisma.sessionRecording.findMany({
    where: { sessionId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  })

  for (const type of RECORDING_PRIORITY) {
    const rec = recordings.find((r) => r.recordingType === type && r.filePath)
    if (!rec?.filePath) continue
    const audioPath = resolveFilePath(rec.filePath)
    if (audioPath) {
      return { audioPath, audioMime: rec.mimeType || mimeFromPath(audioPath) }
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
