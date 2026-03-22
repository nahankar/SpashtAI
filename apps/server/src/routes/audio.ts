import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

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

    // Get or update session transcript to include audio metadata
    let transcript = await prisma.sessionTranscript.findUnique({
      where: { sessionId }
    })

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

    if (transcript) {
      // Add audio metadata to existing transcript
      const conversationData = transcript.conversationData as any
      const audioFiles = Array.isArray(conversationData.audioFiles) 
        ? conversationData.audioFiles 
        : []
      audioFiles.push(audioMetadata)

      await prisma.sessionTranscript.update({
        where: { sessionId },
        data: {
          conversationData: {
            ...conversationData,
            audioFiles,
            lastUpdated: new Date().toISOString()
          }
        }
      })
    } else {
      // Create new transcript with audio metadata
      await prisma.sessionTranscript.create({
        data: {
          sessionId,
          conversationData: {
            messages: [],
            audioFiles: [audioMetadata],
            created: new Date().toISOString(),
            lastUpdated: new Date().toISOString()
          }
        }
      })
    }

    res.status(201).json({ 
      success: true, 
      message: 'Audio metadata saved',
      audioMetadata
    })
  } catch (error) {
    console.error('Error saving audio metadata:', error)
    res.status(500).json({ error: 'Failed to save audio metadata' })
  }
}

export async function getSessionAudio(req: Request, res: Response) {
  try {
    const { sessionId } = req.params

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