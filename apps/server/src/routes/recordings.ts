import type { Request, Response } from 'express'
import multer from 'multer'
import { createHash, randomUUID } from 'crypto'
import { createReadStream, existsSync, mkdirSync, statSync } from 'fs'
import { link, unlink, writeFile } from 'fs/promises'
import path from 'path'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import {
  exportDenied,
  getElevateSessionOwnerId,
  isPrivilegedRole,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import { resolveElevateSessionAudio } from '../analytics/insightProviders/resolveSessionAudio'
import {
  activeSegmentDurationSec,
  recordingPayloadMatches,
  segmentRecordingFilename,
} from '../analytics/sessionSegments'
import {
  lockWritableSession,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'

// Absolute base dir for client-uploaded recordings. Stored as an absolute
// filePath so resolveElevateSessionAudio's absolute-path branch finds it.
const AUDIO_ROOT = process.env.LOCAL_AUDIO_PATH
  ? path.resolve(process.env.LOCAL_AUDIO_PATH)
  : path.join(process.cwd(), 'audio_storage')

export const recordingUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150MB cap
})

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

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function fingerprintFile(filePath: string): Promise<{ hash: string; size: number }> {
  const hash = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', resolve)
    stream.on('error', reject)
  })
  return { hash: hash.digest('hex'), size: statSync(filePath).size }
}

/**
 * Dev/client capture: upload the in-browser MediaRecorder blob and register it
 * as a SessionRecording so it is streamable + usable for delivery analysis.
 * Also persists the shared audio anchor (Session.recordingStartedAt = t0).
 */
export async function uploadSessionRecording(req: Request, res: Response) {
  let promotedPath: string | null = null
  try {
    const { sessionId } = req.params

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, recordingStartedAt: true, discardedAt: true },
    })
    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }
    if (session.discardedAt) {
      return res.status(410).json({ error: 'Session discarded' })
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
    const segmentId = String(req.body.segmentId || '').trim()
    if (!segmentId) {
      return res.status(400).json({ error: 'segmentId is required' })
    }
    const segment = await prisma.sessionSegment.findUnique({
      where: { id: segmentId },
      include: { recording: true },
    })
    if (!segment || segment.sessionId !== sessionId) {
      return res.status(404).json({ error: 'Session segment not found' })
    }

    const durationSec = req.body.durationSec ? Number(req.body.durationSec) : 0
    const recordingStartedAt = req.body.recordingStartedAt
      ? new Date(req.body.recordingStartedAt)
      : null

    const contentHash = sha256(file.buffer)
    const mimeType = file.mimetype || 'application/octet-stream'

    if (segment.recording) {
      const samePayload = recordingPayloadMatches(segment.recording, {
        contentHash,
        fileSize: file.size,
        mimeType,
      })
      if (!samePayload) {
        return res.status(409).json({ error: 'segmentId already has a different recording' })
      }
      await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        if (segment.audioStatus !== 'available') {
          await tx.sessionSegment.update({
            where: { id: segmentId },
            data: { audioStatus: 'available' },
          })
        }
      })
      return res.status(200).json({
        success: true,
        recording: segment.recording,
        idempotent: true,
      })
    }

    mkdirSync(AUDIO_ROOT, { recursive: true })
    const filename = segmentRecordingFilename(segmentId)
    const absPath = path.join(AUDIO_ROOT, filename)
    const tempPath = `${absPath}.${randomUUID()}.tmp`
    await writeFile(tempPath, file.buffer, { flag: 'wx' })
    try {
      try {
        // Hard-link promotion is atomic and never replaces an existing canonical file.
        await link(tempPath, absPath)
      } catch (error: any) {
        if (error?.code !== 'EEXIST') throw error
        const existingFile = await fingerprintFile(absPath)
        if (existingFile.hash !== contentHash || existingFile.size !== file.size) {
          return res.status(409).json({ error: 'segmentId storage payload conflict' })
        }
      }
    } finally {
      await unlink(tempPath).catch(() => undefined)
    }
    promotedPath = absPath

    let recording
    try {
      recording = await prisma.$transaction(async (tx) => {
        await lockWritableSession(tx, sessionId)
        const created = await tx.sessionRecording.create({
          data: {
            sessionId,
            segmentId,
            egressId: `client-segment-${segmentId}`,
            filePath: absPath,
            duration: Number.isFinite(durationSec) ? Math.round(durationSec) : 0,
            fileSize: file.size,
            status: 'completed',
            recordingType,
            contentHash,
            mimeType,
          },
        })
        await tx.sessionSegment.update({
          where: { id: segmentId },
          data: {
            audioStatus: 'available',
            recordingDurationSec: Number.isFinite(durationSec) ? durationSec : undefined,
            recordingStartedAt:
              recordingStartedAt && !Number.isNaN(recordingStartedAt.getTime())
                ? recordingStartedAt
                : undefined,
            activeDurationSec:
              segment.endedAt
                ? activeSegmentDurationSec(segment.startedAt, segment.endedAt)
                : undefined,
          },
        })
        if (segment.endedAt) {
          const aggregate = await tx.sessionSegment.aggregate({
            where: { sessionId, endedAt: { not: null } },
            _sum: { activeDurationSec: true },
          })
          await tx.session.update({
            where: { id: sessionId },
            data: { durationSec: aggregate._sum.activeDurationSec ?? 0 },
          })
        }
        if (
          segment.segmentIndex === 0 &&
          recordingStartedAt &&
          !Number.isNaN(recordingStartedAt.getTime())
        ) {
          await tx.session.update({
            where: { id: sessionId },
            data: { recordingStartedAt: session.recordingStartedAt ?? recordingStartedAt },
          })
        }
        return created
      })
      promotedPath = null
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const raced = await prisma.sessionRecording.findUnique({ where: { segmentId } })
        const current = await prisma.session.findUnique({
          where: { id: sessionId },
          select: { discardedAt: true },
        })
        if (current?.discardedAt) throw new SessionDiscardedError()
        if (
          raced &&
          recordingPayloadMatches(raced, {
            contentHash,
            fileSize: file.size,
            mimeType,
          })
        ) {
          await prisma.sessionSegment.update({
            where: { id: segmentId },
            data: { audioStatus: 'available' },
          })
          return res.status(200).json({ success: true, recording: raced, idempotent: true })
        }
        return res.status(409).json({ error: 'segmentId already has a different recording' })
      }
      throw error
    }

    res.status(201).json({ success: true, recording })
  } catch (error) {
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      if (promotedPath) await unlink(promotedPath).catch(() => undefined)
      return res.status(error.status).json({ error: error.message })
    }
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
