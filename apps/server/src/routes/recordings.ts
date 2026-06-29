import type { Request, Response } from 'express'
import multer from 'multer'
import { createReadStream, existsSync, mkdirSync, statSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import { prisma } from '../lib/prisma'
import {
  exportDenied,
  getElevateSessionOwnerId,
  isPrivilegedRole,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import { resolveElevateSessionAudio } from '../analytics/insightProviders/resolveSessionAudio'

// Absolute base dir for client-uploaded recordings. Stored as an absolute
// filePath so resolveElevateSessionAudio's absolute-path branch finds it.
const AUDIO_ROOT = process.env.LOCAL_AUDIO_PATH
  ? path.resolve(process.env.LOCAL_AUDIO_PATH)
  : path.join(process.cwd(), 'audio_storage')

export const recordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB cap
})

function extFromMime(mime?: string): string {
  if (!mime) return 'webm'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3'
  return 'webm'
}

function mimeFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    wav: 'audio/wav',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mp4: 'video/mp4',
    webm: 'audio/webm',
    ogg: 'audio/ogg',
  }
  return (ext && map[ext]) || 'application/octet-stream'
}

/**
 * Dev/client capture: upload the in-browser MediaRecorder blob and register it
 * as a SessionRecording so it is streamable + usable for delivery analysis.
 * Also persists the shared audio anchor (Session.recordingStartedAt = t0).
 */
export async function uploadSessionRecording(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true },
    })
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    if (
      req.user &&
      !isPrivilegedRole(req.user.role) &&
      session.userId !== req.user.userId
    ) {
      return res.status(403).json({ error: 'Access denied' })
    }

    const file = req.file
    if (!file) {
      return res.status(400).json({ error: 'No audio file uploaded (field "audio")' })
    }

    const recordingType = (req.body.recordingType as string) || 'user'
    const durationSec = req.body.durationSec ? Number(req.body.durationSec) : 0
    const recordingStartedAt = req.body.recordingStartedAt
      ? new Date(req.body.recordingStartedAt)
      : null

    mkdirSync(AUDIO_ROOT, { recursive: true })
    const ext = extFromMime(file.mimetype)
    const filename = `elevate-${sessionId}-${recordingType}-${Date.now()}.${ext}`
    const absPath = path.join(AUDIO_ROOT, filename)
    await writeFile(absPath, file.buffer)

    const recording = await prisma.sessionRecording.create({
      data: {
        sessionId,
        egressId: `client-${sessionId}-${Date.now()}`,
        filePath: absPath,
        duration: Number.isFinite(durationSec) ? Math.round(durationSec) : 0,
        fileSize: file.size,
        status: 'completed',
        recordingType,
      },
    })

    if (recordingStartedAt && !Number.isNaN(recordingStartedAt.getTime())) {
      await prisma.session.update({
        where: { id: sessionId },
        data: { recordingStartedAt },
      })
    }

    res.status(201).json({ success: true, recording })
  } catch (error) {
    console.error('Error uploading session recording:', error)
    res.status(500).json({ error: 'Failed to upload recording' })
  }
}

/**
 * Stream the best Elevate session recording with HTTP Range support so the
 * replay player can seek. Audio 0:00 corresponds to Session.recordingStartedAt.
 */
export async function streamSessionRecording(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }
    if (flags.hideAudioDownload) {
      return exportDenied(res, 'Audio playback is disabled for your account')
    }

    const resolved = await resolveElevateSessionAudio(sessionId)
    if (!resolved || !existsSync(resolved.audioPath)) {
      return res.status(404).json({ error: 'No audio available for this session' })
    }

    const { audioPath } = resolved
    const stat = statSync(audioPath)
    const contentType = resolved.audioMime || mimeFromPath(audioPath)

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType)

    const range = req.headers.range
    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      const start = match && match[1] ? parseInt(match[1], 10) : 0
      const end = match && match[2] ? parseInt(match[2], 10) : stat.size - 1
      if (start >= stat.size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${stat.size}`)
        return res.end()
      }
      res.status(206)
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      res.setHeader('Content-Length', String(end - start + 1))
      return createReadStream(audioPath, { start, end }).pipe(res)
    }

    res.setHeader('Content-Length', String(stat.size))
    return createReadStream(audioPath).pipe(res)
  } catch (error) {
    console.error('Error streaming session recording:', error)
    res.status(500).json({ error: 'Failed to stream recording' })
  }
}
