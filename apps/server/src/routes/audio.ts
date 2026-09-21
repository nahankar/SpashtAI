import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import {
  exportDenied,
  getElevateSessionOwnerId,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import {
  lockWritableSession,
  SessionDiscardedError,
  SessionMissingError,
} from '../lib/sessionDiscard'
import { deleteRecordingArtifact } from '../lib/sessionStorageCleanup'
import { enqueueSessionDeletion } from '../lib/sessionDeletionWorker'
import { isValidInternalAgentRequest } from '../middleware/auth'

export async function saveAudioMetadata(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const {
      participantType,
      s3Key,
      s3Bucket,
      durationSeconds,
      sampleRate,
      channels,
      fileSizeBytes,
      uploadTimestamp,
      userId
    } = req.body

    const audioMetadata = {
      participantType,
      s3Key,
      s3Bucket,
      durationSeconds,
      sampleRate,
      channels,
      fileSizeBytes,
      uploadTimestamp,
      userId
    }

    const isAgentCallback = isValidInternalAgentRequest(req)
    const discarded = await prisma.$transaction(async (tx) => {
      let wasDiscarded = false
      try {
        await lockWritableSession(tx, sessionId)
      } catch (error) {
        if (!(error instanceof SessionDiscardedError) || !isAgentCallback) throw error
        wasDiscarded = true
      }

      const transcript = await tx.sessionTranscript.findUnique({ where: { sessionId } })
      const conversationData = (transcript?.conversationData as any) || {}
      const audioFiles = Array.isArray(conversationData.audioFiles)
        ? conversationData.audioFiles
        : []
      const nextConversationData = {
        ...conversationData,
        messages: Array.isArray(conversationData.messages) ? conversationData.messages : [],
        audioFiles: [...audioFiles, audioMetadata],
        lastUpdated: new Date().toISOString(),
        ...(transcript ? {} : { created: new Date().toISOString() }),
      }

      await tx.sessionTranscript.upsert({
        where: { sessionId },
        update: { conversationData: nextConversationData },
        create: {
          sessionId,
          conversationData: nextConversationData,
        },
      })

      if (wasDiscarded) {
        await tx.session.update({
          where: { id: sessionId },
          data: {
            deletionStatus: 'pending',
            nextDeletionAttemptAt: new Date(),
            deletionLeaseId: null,
            deletionLeaseUntil: null,
          },
        })
      }
      return wasDiscarded
    })

    if (discarded) {
      enqueueSessionDeletion(sessionId)
      if (typeof s3Bucket === 'string' && s3Bucket && typeof s3Key === 'string' && s3Key) {
        await deleteRecordingArtifact(`s3://${s3Bucket}/${s3Key}`)
      }
      return res.status(410).json({ error: 'Session discarded' })
    }

    res.status(201).json({ 
      success: true, 
      message: 'Audio metadata saved',
      audioMetadata
    })
  } catch (error) {
    if (
      error instanceof SessionMissingError &&
      isValidInternalAgentRequest(req) &&
      typeof req.body?.s3Bucket === 'string' &&
      req.body.s3Bucket &&
      typeof req.body?.s3Key === 'string' &&
      req.body.s3Key
    ) {
      try {
        await deleteRecordingArtifact(`s3://${req.body.s3Bucket}/${req.body.s3Key}`)
      } catch (cleanupError) {
        console.error('Failed to compensate late legacy audio artifact:', cleanupError)
        return res.status(503).json({ error: 'Audio cleanup pending retry' })
      }
    }
    if (error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error('Error saving audio metadata:', error)
    res.status(500).json({ error: 'Failed to save audio metadata' })
  }
}

export async function getSessionAudio(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }
    if (flags.hideAudioDownload || !flags.enableAudioExport) {
      return exportDenied(res, 'Audio download is disabled for your account')
    }

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId },
      include: {
        session: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        }
      }
    })

    if (!transcript) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const conversationData = transcript.conversationData as any
    const audioFiles = Array.isArray(conversationData.audioFiles) 
      ? conversationData.audioFiles 
      : []

    res.json({
      sessionId,
      audioFiles,
      totalFiles: audioFiles.length,
      totalDuration: audioFiles.reduce((sum: number, file: any) => 
        sum + (file.durationSeconds || 0), 0
      ),
      session: transcript.session
    })
  } catch (error) {
    console.error('Error getting session audio:', error)
    res.status(500).json({ error: 'Failed to get session audio' })
  }
}

export async function generateAudioUrl(req: Request, res: Response) {
  try {
    const { sessionId, audioId } = req.params
    const { expiration = 3600 } = req.query

    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }
    if (flags.hideAudioDownload || !flags.enableAudioExport) {
      return exportDenied(res, 'Audio download is disabled for your account')
    }

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    })

    if (!transcript) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const conversationData = transcript.conversationData as any
    const audioFiles = Array.isArray(conversationData.audioFiles) 
      ? conversationData.audioFiles 
      : []

    const audioFile = audioFiles.find((file: any) => 
      file.s3Key === audioId || file.s3Key.includes(audioId)
    )

    if (!audioFile) {
      return res.status(404).json({ error: 'Audio file not found' })
    }

    // Note: In a real implementation, you would use AWS SDK to generate presigned URL
    // For now, we'll return the S3 key and let the client handle it
    const presignedUrl = `https://${audioFile.s3Bucket}.s3.amazonaws.com/${audioFile.s3Key}?expires=${expiration}`

    res.json({
      presignedUrl,
      audioMetadata: audioFile,
      expiresIn: Number(expiration)
    })
  } catch (error) {
    console.error('Error generating audio URL:', error)
    res.status(500).json({ error: 'Failed to generate audio URL' })
  }
}

export async function deleteSessionAudio(req: Request, res: Response) {
  try {
    const { sessionId, audioId } = req.params

    const transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    })

    if (!transcript) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const conversationData = transcript.conversationData as any
    const audioFiles = Array.isArray(conversationData.audioFiles) 
      ? conversationData.audioFiles 
      : []

    const updatedAudioFiles = audioFiles.filter((file: any) => 
      file.s3Key !== audioId && !file.s3Key.includes(audioId)
    )

    if (updatedAudioFiles.length === audioFiles.length) {
      return res.status(404).json({ error: 'Audio file not found' })
    }

    await prisma.sessionTranscript.update({
      where: { sessionId },
      data: {
        conversationData: {
          ...conversationData,
          audioFiles: updatedAudioFiles,
          lastUpdated: new Date().toISOString()
        }
      }
    })

    // Note: In a real implementation, you would also delete from S3
    // const deletedFile = audioFiles.find(file => file.s3Key === audioId)
    // await s3Client.deleteObject({ Bucket: deletedFile.s3Bucket, Key: deletedFile.s3Key })

    res.json({ 
      success: true, 
      message: 'Audio file deleted',
      remainingFiles: updatedAudioFiles.length
    })
  } catch (error) {
    console.error('Error deleting audio file:', error)
    res.status(500).json({ error: 'Failed to delete audio file' })
  }
}

export async function getAudioAnalytics(req: Request, res: Response) {
  try {
    const { userId, startDate, endDate, limit = 50 } = req.query

    const whereConditions: any = {}
    
    if (userId) {
      whereConditions.session = {
        userId: userId as string
      }
    }

    if (startDate || endDate) {
      whereConditions.session = {
        ...whereConditions.session,
        startedAt: {}
      }
      if (startDate) {
        whereConditions.session.startedAt.gte = new Date(startDate as string)
      }
      if (endDate) {
        whereConditions.session.startedAt.lte = new Date(endDate as string)
      }
    }

    const transcripts = await prisma.sessionTranscript.findMany({
      where: whereConditions,
      include: {
        session: {
          include: {
            user: {
              select: { id: true, email: true }
            }
          }
        }
      },
      orderBy: { updatedAt: 'desc' },
      take: Number(limit)
    })

    const analytics = transcripts.map((transcript: any) => {
      const conversationData = transcript.conversationData as any
      const audioFiles = Array.isArray(conversationData.audioFiles) 
        ? conversationData.audioFiles 
        : []

      const totalDuration = audioFiles.reduce((sum: number, file: any) => 
        sum + (file.durationSeconds || 0), 0
      )

      const userAudio = audioFiles.filter((file: any) => 
        file.participantType === 'user'
      )

      const assistantAudio = audioFiles.filter((file: any) => 
        file.participantType === 'assistant'
      )

      return {
        sessionId: transcript.sessionId,
        session: transcript.session,
        audioStats: {
          totalFiles: audioFiles.length,
          totalDuration,
          userAudioCount: userAudio.length,
          assistantAudioCount: assistantAudio.length,
          userDuration: userAudio.reduce((sum: number, file: any) => 
            sum + (file.durationSeconds || 0), 0
          ),
          assistantDuration: assistantAudio.reduce((sum: number, file: any) => 
            sum + (file.durationSeconds || 0), 0
          ),
          totalFileSize: audioFiles.reduce((sum: number, file: any) => 
            sum + (file.fileSizeBytes || 0), 0
          )
        }
      }
    })

    const totalStats = analytics.reduce((acc: any, session: any) => ({
      totalSessions: acc.totalSessions + 1,
      totalFiles: acc.totalFiles + session.audioStats.totalFiles,
      totalDuration: acc.totalDuration + session.audioStats.totalDuration,
      totalFileSize: acc.totalFileSize + session.audioStats.totalFileSize
    }), {
      totalSessions: 0,
      totalFiles: 0,
      totalDuration: 0,
      totalFileSize: 0
    })

    res.json({
      analytics,
      totalStats,
      query: { userId, startDate, endDate, limit }
    })
  } catch (error) {
    console.error('Error getting audio analytics:', error)
    res.status(500).json({ error: 'Failed to get audio analytics' })
  }
}