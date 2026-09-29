import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from './prisma'
import { logger } from './logger'

const activeJobs = new Set<string>()
let sweepTimer: NodeJS.Timeout | null = null
const moduleDir = path.dirname(fileURLToPath(import.meta.url))

const REPLAY_UPLOAD_DIR = path.resolve(
  process.env.REPLAY_UPLOAD_PATH ||
    (process.env.NODE_ENV !== 'production'
      ? path.join(moduleDir, '../../../../storage/replay_uploads')
      : './replay_uploads'),
)

export function replayTranscriptionCachePath(replaySessionId: string): string {
  return path.join(REPLAY_UPLOAD_DIR, `${replaySessionId}_transcription.json`)
}

function retryDelayMs(attempt: number): number {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 6))
}

export function enqueueReplayDeletion(replaySessionId: string, delayMs = 0): void {
  setTimeout(() => void processReplayDeletion(replaySessionId), Math.max(delayMs, 0)).unref()
}

export async function processReplayDeletion(replaySessionId: string): Promise<boolean> {
  if (activeJobs.has(replaySessionId)) return false
  activeJobs.add(replaySessionId)
  try {
    const job = await prisma.replayDeletion.findUnique({ where: { replaySessionId } })
    if (!job) return true
    const paths = Array.isArray(job.filePaths)
      ? job.filePaths.filter((value): value is string => typeof value === 'string')
      : []
    await prisma.replayDeletion.update({
      where: { replaySessionId },
      data: { status: 'retrying', attempts: { increment: 1 }, error: null, nextAttemptAt: null },
    })
    for (const filePath of new Set(paths)) {
      try {
        await unlink(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    await prisma.replayDeletion.delete({ where: { replaySessionId } })
    return true
  } catch (error) {
    const current = await prisma.replayDeletion.findUnique({ where: { replaySessionId } }).catch(() => null)
    if (current) {
      const nextAttemptAt = new Date(Date.now() + retryDelayMs(current.attempts))
      await prisma.replayDeletion.update({
        where: { replaySessionId },
        data: {
          status: 'failed',
          error: error instanceof Error ? error.message.slice(0, 2000) : String(error),
          nextAttemptAt,
        },
      }).catch(() => undefined)
      enqueueReplayDeletion(replaySessionId, nextAttemptAt.getTime() - Date.now())
    }
    logger.warn({ err: error, replaySessionId }, 'Replay artifact cleanup failed; retry scheduled')
    return false
  } finally {
    activeJobs.delete(replaySessionId)
  }
}

export function startReplayDeletionWorker(): void {
  if (sweepTimer) return
  const sweep = async () => {
    const now = new Date()
    const jobs = await prisma.replayDeletion.findMany({
      where: { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      select: { replaySessionId: true },
      take: 100,
    }).catch(() => [])
    for (const job of jobs) enqueueReplayDeletion(job.replaySessionId)
  }
  void sweep()
  sweepTimer = setInterval(() => void sweep(), 60_000)
  sweepTimer.unref()
}
