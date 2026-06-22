import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../../lib/prisma'

const RECORDING_PRIORITY = ['user', 'room_composite', 'merged_audio', 'agent'] as const

const serverDir = dirname(fileURLToPath(import.meta.url))
const agentAudioRoot = join(serverDir, '../../../../../agent/audio_storage')

function resolveFilePath(storedPath: string): string | null {
  if (!storedPath) return null

  let local = storedPath
  if (storedPath.startsWith('/out/')) {
    local = join(agentAudioRoot, storedPath.replace(/^\/out\//, ''))
  } else if (!storedPath.startsWith('/') && !storedPath.match(/^[A-Za-z]:\\/)) {
    const base = process.env.LOCAL_AUDIO_PATH || join(serverDir, '../../../audio_storage')
    local = join(base, storedPath)
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
  const recordings = await prisma.sessionRecording.findMany({
    where: { sessionId, status: 'completed' },
    orderBy: { createdAt: 'desc' },
  })

  for (const type of RECORDING_PRIORITY) {
    const rec = recordings.find((r) => r.recordingType === type && r.filePath)
    if (!rec?.filePath) continue
    const audioPath = resolveFilePath(rec.filePath)
    if (audioPath) {
      return { audioPath, audioMime: mimeFromPath(audioPath) }
    }
  }

  return null
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
