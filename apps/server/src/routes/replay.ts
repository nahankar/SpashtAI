import { Router, Request, Response } from 'express'
import multer from 'multer'
import { readFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../lib/prisma'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import { detectFormatAndParse } from '../lib/transcript-parser'
import { calculateReplayMetrics } from '../lib/replay-metrics'
import { analyzeTranscript } from '../lib/aws-bedrock'
import {
  uploadToS3,
  startTranscriptionJob,
  pollTranscriptionJob,
  fetchTranscriptionResult,
  mediaFormatFromMime,
} from '../lib/aws-transcribe'

const isDev = process.env.NODE_ENV !== 'production'

// Dev: store under the spashtai project folder.  Prod: configurable via env.
const UPLOAD_DIR = path.resolve(
  process.env.REPLAY_UPLOAD_PATH ||
    (isDev
      ? path.join(__dirname, '../../../../storage/replay_uploads')
      : './replay_uploads')
)

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true })
    }
    cb(null, UPLOAD_DIR)
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const ext = path.extname(file.originalname)
    cb(null, `${unique}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
})

const router = Router()

// ── POST /api/replay/sessions ──

router.post('/sessions', async (req: Request, res: Response) => {
  try {
    const { meetingType, userRole, focusAreas, meetingGoal, meetingDate, participantName } = req.body

    if (!meetingType || !userRole) {
      return res.status(400).json({ error: 'meetingType and userRole are required' })
    }

    const userId = req.user!.userId

    const session = await prisma.replaySession.create({
      data: {
        userId,
        meetingType,
        userRole,
        focusAreas: focusAreas || [],
        meetingGoal: meetingGoal || null,
        meetingDate: meetingDate ? new Date(meetingDate) : null,
        participantName: participantName?.trim() || null,
      },
    })

    res.json({ sessionId: session.id })
  } catch (error) {
    console.error('Error creating replay session:', error)
    res.status(500).json({ error: 'Failed to create replay session' })
  }
})

// ── POST /api/replay/sessions/:id/upload ──

router.post(
  '/sessions/:id/upload',
  upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'transcript', maxCount: 1 },
  ]),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params
      const session = await prisma.replaySession.findUnique({ where: { id } })
      if (!session) return res.status(404).json({ error: 'Replay session not found' })

      const files = req.files as Record<string, Express.Multer.File[]> | undefined
      const pastedText: string | undefined = req.body.text

      const uploads: any[] = []

      // Audio file
      if (files?.audio?.[0]) {
        const f = files.audio[0]
        const record = await prisma.replayUpload.create({
          data: {
            replaySessionId: id,
            fileType: f.mimetype.startsWith('video/') ? 'video' : 'audio',
            originalName: f.originalname,
            storedPath: f.path,
            fileSize: f.size,
            mimeType: f.mimetype,
          },
        })
        uploads.push(record)
      }

      // Transcript file
      if (files?.transcript?.[0]) {
        const f = files.transcript[0]
        const record = await prisma.replayUpload.create({
          data: {
            replaySessionId: id,
            fileType: 'transcript',
            originalName: f.originalname,
            storedPath: f.path,
            fileSize: f.size,
            mimeType: f.mimetype,
          },
        })
        uploads.push(record)
      }

      // Pasted text
      if (pastedText && pastedText.trim()) {
        const textPath = path.join(UPLOAD_DIR, `${id}_pasted.txt`)
        const { writeFile } = await import('fs/promises')
        await writeFile(textPath, pastedText, 'utf-8')
        const record = await prisma.replayUpload.create({
          data: {
            replaySessionId: id,
            fileType: 'text',
            originalName: 'pasted_text.txt',
            storedPath: textPath,
            fileSize: Buffer.byteLength(pastedText, 'utf-8'),
            mimeType: 'text/plain',
          },
        })
        uploads.push(record)
      }

      if (uploads.length === 0) {
        return res.status(400).json({ error: 'No files or text provided' })
      }

      res.json({ uploads })
    } catch (error) {
      console.error('Error uploading files:', error)
      res.status(500).json({ error: 'Failed to upload files' })
    }
  }
)

// ── POST /api/replay/sessions/:id/process ──

router.post('/sessions/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const session = await prisma.replaySession.findUnique({
      where: { id },
      include: { uploadedFiles: true },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })

    if (session.status !== 'pending') {
      return res.status(400).json({
        error: `Session is already ${session.status}`,
        status: session.status,
      })
    }

    // Mark as processing
    await prisma.replaySession.update({
      where: { id },
      data: { status: 'transcribing' },
    })

    // Fire-and-forget processing — respond immediately
    res.json({ message: 'Processing started', status: 'transcribing' })

    // Run pipeline asynchronously
    processReplaySession(id).catch((err) => {
      console.error(`Replay processing failed for ${id}:`, err)
      prisma.replaySession
        .update({
          where: { id },
          data: { status: 'failed', errorMessage: err.message },
        })
        .catch(console.error)
    })
  } catch (error) {
    console.error('Error starting processing:', error)
    res.status(500).json({ error: 'Failed to start processing' })
  }
})

// ── The actual processing pipeline ──

async function processReplaySession(sessionId: string): Promise<void> {
  const session = await prisma.replaySession.findUnique({
    where: { id: sessionId },
    include: { uploadedFiles: true },
  })
  if (!session) throw new Error('Session not found')

  const audioFile = session.uploadedFiles.find(
    (f) => f.fileType === 'audio' || f.fileType === 'video'
  )
  const transcriptFile = session.uploadedFiles.find((f) => f.fileType === 'transcript')
  const textFile = session.uploadedFiles.find((f) => f.fileType === 'text')

  let fullText = ''
  let structuredTranscript: any = null
  let speakerCount = 1
  let transcriptionSource = 'uploaded'
  let durationSec: number | undefined

  // ── Step 1: Get transcript text ──

  if (audioFile) {
    await prisma.replaySession.update({
      where: { id: sessionId },
      data: { status: 'transcribing' },
    })

    if (isDev) {
      // Dev mode: skip S3 + AWS Transcribe (requires a real S3 bucket).
      // Audio file stays on disk; analysis falls through to text-based path.
      console.log(
        `[dev] Skipping AWS Transcribe for audio file "${audioFile.originalName}". ` +
        `Provide a transcript or pasted text alongside audio for analysis in dev mode.`
      )
    } else {
      // Production: upload to S3 and use AWS Transcribe
      const s3Key = `replay/${sessionId}/${path.basename(audioFile.storedPath)}`
      const mediaFormat = mediaFormatFromMime(audioFile.mimeType)

      try {
        const s3Uri = await uploadToS3(audioFile.storedPath, s3Key, audioFile.mimeType)
        const jobName = `spashtai-replay-${sessionId}-${Date.now()}`
        await startTranscriptionJob(s3Uri, jobName, mediaFormat)
        const transcriptUri = await pollTranscriptionJob(jobName)
        const result = await fetchTranscriptionResult(transcriptUri)

        fullText = result.fullText
        structuredTranscript = result.segments
        speakerCount = result.speakerCount
        durationSec = result.segments.length > 0
          ? Math.max(...result.segments.map((s) => s.endTime))
          : undefined
        transcriptionSource = 'aws_transcribe'
      } catch (transcribeError: any) {
        console.error('AWS Transcribe failed, checking for text fallback:', transcribeError.message)
      }
    }
  }

  // If we don't have text yet, try uploaded transcript or pasted text
  if (!fullText && (transcriptFile || textFile)) {
    const file = transcriptFile || textFile!
    const content = await readFile(file.storedPath, 'utf-8')
    const parsed = detectFormatAndParse(content, file.mimeType, file.originalName)
    fullText = parsed.fullText
    structuredTranscript = parsed.segments
    speakerCount = parsed.speakerCount
    transcriptionSource = file.fileType === 'text' ? 'pasted' : 'uploaded'
  }

  // Also merge uploaded transcript if audio was primary
  if (audioFile && (transcriptFile || textFile) && transcriptionSource === 'aws_transcribe') {
    // Audio transcription succeeded; merge uploaded text as supplementary context
    const file = transcriptFile || textFile!
    const content = await readFile(file.storedPath, 'utf-8')
    const parsed = detectFormatAndParse(content, file.mimeType, file.originalName)
    if (parsed.speakerCount > speakerCount) {
      speakerCount = parsed.speakerCount
    }
  }

  if (!fullText.trim()) {
    throw new Error('No transcript text could be extracted from the uploaded files')
  }

  // ── Step 2: Calculate metrics ──

  await prisma.replaySession.update({
    where: { id: sessionId },
    data: { status: 'analyzing' },
  })

  const segments = Array.isArray(structuredTranscript)
    ? structuredTranscript
    : [{ speaker: 'Speaker', text: fullText }]

  const metrics = calculateReplayMetrics(segments, session.participantName || undefined, durationSec)

  // ── Step 3: AI analysis via Bedrock ──

  const startMs = Date.now()
  const aiResult = await analyzeTranscript(fullText, {
    meetingType: session.meetingType,
    userRole: session.userRole,
    focusAreas: session.focusAreas,
    meetingGoal: session.meetingGoal || undefined,
    participantName: session.participantName || undefined,
    speakerCount,
    durationEstimate: durationSec,
  })
  const processingTimeMs = Date.now() - startMs

  // ── Step 4: Save results ──

  await prisma.replayResult.create({
    data: {
      replaySessionId: sessionId,
      transcriptText: fullText,
      structuredTranscript: structuredTranscript ?? undefined,
      speakerCount,
      transcriptionSource,

      wordsPerMinute: metrics.wordsPerMinute,
      fillerWordCount: metrics.fillerWordCount,
      fillerWordRate: metrics.fillerWordRate,
      avgSentenceLength: metrics.avgSentenceLength,
      vocabularyDiversity: metrics.vocabularyDiversity,
      totalTurns: metrics.totalTurns,
      speakingPercentage: metrics.speakingPercentage,

      overallScore: aiResult.overallScore,
      clarityScore: aiResult.clarityScore,
      confidenceScore: aiResult.confidenceScore,
      engagementScore: aiResult.engagementScore,

      strengths: aiResult.strengths,
      improvements: aiResult.improvements,
      recommendations: aiResult.recommendations,
      contextSpecificFeedback: aiResult.contextSpecificFeedback,
      keyMoments: aiResult.keyMoments,
      annotatedTranscript: aiResult.annotatedTranscript,

      modelUsed: process.env.BEDROCK_REPLAY_MODEL_ID || 'amazon.nova-pro-v1:0',
      promptTokens: aiResult.promptTokens,
      completionTokens: aiResult.completionTokens,
      processingTimeMs,
    },
  })

  await prisma.replaySession.update({
    where: { id: sessionId },
    data: { status: 'completed' },
  })

  console.log(`Replay session ${sessionId} processing completed in ${processingTimeMs}ms`)
}

// ── GET /api/replay/sessions/:id/status ──

router.get('/sessions/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const session = await prisma.replaySession.findUnique({
      where: { id },
      select: { id: true, status: true, errorMessage: true, updatedAt: true },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })
    res.json(session)
  } catch (error) {
    console.error('Error fetching replay status:', error)
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// ── GET /api/replay/sessions/:id/results ──

router.get('/sessions/:id/results', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const session = await prisma.replaySession.findUnique({
      where: { id },
      include: {
        result: true,
        uploadedFiles: {
          select: {
            id: true,
            fileType: true,
            originalName: true,
            fileSize: true,
            duration: true,
          },
        },
      },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })
    if (!session.result) {
      return res.status(404).json({
        error: 'Results not yet available',
        status: session.status,
      })
    }

    res.json({
      session: {
        id: session.id,
        meetingType: session.meetingType,
        userRole: session.userRole,
        focusAreas: session.focusAreas,
        meetingGoal: session.meetingGoal,
        meetingDate: session.meetingDate,
        participantName: session.participantName,
        status: session.status,
        createdAt: session.createdAt,
      },
      uploads: session.uploadedFiles,
      result: session.result,
    })
  } catch (error) {
    console.error('Error fetching replay results:', error)
    res.status(500).json({ error: 'Failed to fetch results' })
  }
})

// ── GET /api/replay/sessions ──

router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId
    const sessions = await prisma.replaySession.findMany({
      where: { userId },
      include: {
        result: {
          select: {
            overallScore: true,
            transcriptionSource: true,
          },
        },
        uploadedFiles: {
          select: { fileType: true, originalName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ sessions })
  } catch (error) {
    console.error('Error listing replay sessions:', error)
    res.status(500).json({ error: 'Failed to list replay sessions' })
  }
})

// ── DELETE /api/replay/sessions/:id ──

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const session = await prisma.replaySession.findUnique({
      where: { id },
      include: { uploadedFiles: true },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })

    // Delete uploaded files from disk
    for (const file of session.uploadedFiles) {
      try {
        await unlink(file.storedPath)
      } catch {
        // file may already be gone
      }
    }

    await prisma.replaySession.delete({ where: { id } })
    res.json({ message: 'Replay session deleted' })
  } catch (error) {
    console.error('Error deleting replay session:', error)
    res.status(500).json({ error: 'Failed to delete replay session' })
  }
})

export default router
