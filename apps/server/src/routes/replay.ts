import { Router, Request, Response } from 'express'
import multer from 'multer'
import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../lib/prisma'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import {
  detectFormatAndParse,
  buildSpeakerLabeledText,
  correctAnnotatedSpeakers,
  filterParticipantAnnotations,
  extractMeetingDateFromTranscript,
} from '../lib/transcript-parser'
import { calculateReplayMetrics, findMatchingSpeaker } from '../lib/replay-metrics'
import { analyzeTranscript } from '../lib/aws-bedrock'
import { calculateSkillScores, calculateWeightedOverallScore, type TextSignals } from '../analytics/skillScores'
import { generateCoachingInsights } from '../analytics/insightGenerator'
import { saveSkillScoresToPulse } from '../analytics/progressPulse'
import {
  uploadToS3,
  startTranscriptionJob,
  pollTranscriptionJob,
  fetchTranscriptionResult,
  mediaFormatFromMime,
  type TranscriptionResult,
} from '../lib/aws-transcribe'
// DEV-ONLY: streaming transcription — remove before production
import { transcribeStreamingFromFile } from '../lib/aws-transcribe-streaming'

const isDev = process.env.NODE_ENV !== 'production'

const SIGNAL_API_URL = process.env.SIGNAL_API_URL || 'http://localhost:4001'
const INTERNAL_AGENT_TOKEN = process.env.INTERNAL_AGENT_TOKEN || 'dev-internal-agent-token'

/**
 * Normalize multi-speaker transcript segments into the {role, content}[]
 * format the analytics engine expects. The resolved participant becomes
 * "user", everyone else becomes "assistant".
 */
function normalizeSegmentsForAnalytics(
  segments: { speaker: string; text: string }[],
  participantSpeaker: string,
): { role: string; content: string }[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({
      role: s.speaker === participantSpeaker ? 'user' : 'assistant',
      content: s.text,
    }))
}

async function fetchSignals(
  sessionId: string,
  messages: { role: string; content: string }[],
  durationSec: number,
): Promise<TextSignals | null> {
  try {
    const res = await fetch(`${SIGNAL_API_URL}/extract-signals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-agent-token': INTERNAL_AGENT_TOKEN,
      },
      body: JSON.stringify({ sessionId, messages, durationSec }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data.signals as TextSignals
  } catch {
    return null
  }
}

function buildFallbackSignals(
  messages: { role: string; content: string }[],
  _durationSec: number,
): TextSignals {
  const userMsgs = messages.filter((m) => m.role === 'user')
  const userText = userMsgs.map((m) => m.content).join(' ')
  const words = userText.split(/\s+/).filter(Boolean)
  const totalWords = words.length

  // Estimate user speaking time (~2.5 words/sec for natural speech)
  const estimatedSpeakingSec = Math.max(totalWords / 2.5, 1)
  const speakingMin = estimatedSpeakingSec / 60

  const fillerRegex = /\b(um|uh|like|you know|basically|actually|literally|so|well|right|i mean|kind of|sort of)\b/gi
  const fillerMatches = userText.match(fillerRegex) || []
  const hedgingRegex = /\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|not sure|might|could be)\b/gi
  const hedgingMatches = userText.match(hedgingRegex) || []

  const sentences = userText.split(/[.!?]+/).filter((s) => s.trim().length > 3)
  const avgSentLen = sentences.length > 0 ? words.length / sentences.length : 0

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length > 2))

  return {
    speechRate: { wpm: Math.round(Math.min(250, totalWords / speakingMin)), variability: 0.2, totalWords },
    fillers: { count: fillerMatches.length, rate: totalWords > 0 ? fillerMatches.length / totalWords : 0, byType: {} },
    hedging: { count: hedgingMatches.length, rate: totalWords > 0 ? hedgingMatches.length / totalWords : 0, phrases: [...new Set(hedgingMatches.map((m) => m.toLowerCase()))] },
    sentenceComplexity: { avgLength: Math.round(avgSentLen * 10) / 10, subordinateRatio: 0.25, readability: 60, fleschKincaid: 8, gunningFog: 10 },
    vocabDiversity: { ratio: totalWords > 0 ? uniqueWords.size / totalWords : 0, uniqueWords: uniqueWords.size, totalWords, sophistication: 5 },
    topicCoherence: { avgSimilarity: 0.75, driftCount: 0 },
    questionHandling: { questionsReceived: 0, avgResponseTime: 0, relevanceScores: [] },
    talkListenBalance: { userRatio: totalWords / Math.max(1, messages.reduce((s, m) => s + m.content.split(/\s+/).length, 0)) },
    interactionSignals: { questionsAsked: userMsgs.filter((m) => m.content.includes('?')).length, participantReferences: 0, followUps: 0 },
    ideaStructure: { markerCount: 0, markerTypes: {} },
  }
}

// ── Transcription cache helpers ──

function transcriptionCachePath(sessionId: string): string {
  return path.join(UPLOAD_DIR, `${sessionId}_transcription.json`)
}

async function loadCachedTranscription(sessionId: string): Promise<TranscriptionResult | null> {
  const cachePath = transcriptionCachePath(sessionId)
  if (!existsSync(cachePath)) return null
  try {
    const raw = await readFile(cachePath, 'utf-8')
    const cached = JSON.parse(raw) as TranscriptionResult & { source?: string }
    console.log(`[cache] Loaded cached transcription for session ${sessionId}: ${cached.segments.length} segments, ${cached.speakerCount} speakers`)
    return cached
  } catch (err: any) {
    console.warn(`[cache] Failed to load cached transcription: ${err.message}`)
    return null
  }
}

async function saveTranscriptionCache(
  sessionId: string,
  result: TranscriptionResult,
  source: string
): Promise<void> {
  const cachePath = transcriptionCachePath(sessionId)
  try {
    await writeFile(cachePath, JSON.stringify({ ...result, source }, null, 2), 'utf-8')
    console.log(`[cache] Saved transcription to ${cachePath}`)
  } catch (err: any) {
    console.warn(`[cache] Failed to save transcription cache: ${err.message}`)
  }
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function getDominantSpeaker(segments: { speaker: string; text: string }[]): string {
  const bySpeaker = new Map<string, number>()
  for (const seg of segments) {
    bySpeaker.set(seg.speaker, (bySpeaker.get(seg.speaker) || 0) + countWords(seg.text))
  }
  let topSpeaker = 'Speaker'
  let topWords = -1
  for (const [speaker, words] of bySpeaker.entries()) {
    if (words > topWords) {
      topWords = words
      topSpeaker = speaker
    }
  }
  return topSpeaker
}

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
    const { sessionName, meetingType, userRole, focusAreas, meetingGoal, meetingDate, participantName } = req.body

    let parsedMeeting: Date | null = null
    if (meetingDate != null && meetingDate !== '') {
      if (typeof meetingDate !== 'string') {
        return res.status(400).json({ error: 'meetingDate must be a string' })
      }
      parsedMeeting = new Date(meetingDate)
      if (Number.isNaN(parsedMeeting.getTime())) {
        return res.status(400).json({ error: 'meetingDate must be a valid date' })
      }
    }

    const userId = req.user!.userId

    const session = await prisma.replaySession.create({
      data: {
        userId,
        sessionName: sessionName?.trim() || null,
        meetingType: meetingType?.trim() || 'General Meeting',
        userRole: userRole?.trim() || 'Participant',
        focusAreas: focusAreas || [],
        meetingGoal: meetingGoal || null,
        meetingDate: parsedMeeting,
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

      const hadMeetingDate = !!session.meetingDate
      let meetingDateAutoFilled = false

      // Calendar date from VTT/SRT header or filename (e.g. Zoom GMT20240315-…). Cue timestamps are ignored.
      if (!session.meetingDate) {
        let inferred: Date | null = null
        if (files?.transcript?.[0]) {
          const f = files.transcript[0]
          try {
            const txt = await readFile(f.path, 'utf-8')
            inferred = extractMeetingDateFromTranscript(txt, f.originalname)
          } catch {
            /* ignore read errors */
          }
        }
        if (!inferred && pastedText?.trim()) {
          inferred = extractMeetingDateFromTranscript(pastedText.trim(), 'pasted-transcript.vtt')
        }
        if (inferred) {
          await prisma.replaySession.update({
            where: { id },
            data: { meetingDate: inferred },
          })
          meetingDateAutoFilled = true
        }
      }

      const fresh = await prisma.replaySession.findUnique({
        where: { id },
        select: { meetingDate: true },
      })

      res.json({
        uploads,
        meetingDateMissing: !fresh?.meetingDate,
        meetingDateAutoFilled: meetingDateAutoFilled && !hadMeetingDate,
        meetingDate: fresh?.meetingDate ? fresh.meetingDate.toISOString().slice(0, 10) : null,
      })
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

    if (!session.meetingDate) {
      return res.status(400).json({
        code: 'MEETING_DATE_REQUIRED',
        error:
          'A meeting date is required for Progress Pulse trend tracking. Please set one before processing.',
      })
    }

    if (session.status === 'transcribing' || session.status === 'analyzing') {
      return res.status(400).json({
        error: `Session is currently ${session.status}`,
        status: session.status,
      })
    }

    // Clean up previous result before re-processing
    if (session.status === 'failed' || session.status === 'completed') {
      await prisma.replayResult.deleteMany({ where: { replaySessionId: id } })
    }

    // Reset Progress Pulse for this session so user gets prompted again with new scores
    if (session.progressPulseStatus === 'tracked') {
      await prisma.progressPulse.deleteMany({ where: { sessionId: id, source: 'replay' } })
    }

    // Mark as processing (clear any previous error, reset pulse status)
    await prisma.replaySession.update({
      where: { id },
      data: { status: 'transcribing', errorMessage: null, progressPulseStatus: null },
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

  // ── Step 1: Get transcript text (check cache first) ──

  if (audioFile) {
    await prisma.replaySession.update({
      where: { id: sessionId },
      data: { status: 'transcribing' },
    })

    // Check for cached transcription from a previous run
    const cached = await loadCachedTranscription(sessionId)
    if (cached) {
      fullText = cached.fullText
      structuredTranscript = cached.segments
      speakerCount = cached.speakerCount
      durationSec = cached.segments.length > 0
        ? Math.max(...cached.segments.map((s) => s.endTime))
        : undefined
      transcriptionSource = (cached as any).source || 'cached'
    } else if (isDev) {
      // DEV-ONLY: Use Transcribe Streaming (no S3 needed). Remove before production.
      try {
        const result = await transcribeStreamingFromFile(
          audioFile.storedPath,
          audioFile.mimeType
        )
        fullText = result.fullText
        structuredTranscript = result.segments
        speakerCount = result.speakerCount
        durationSec = result.segments.length > 0
          ? Math.max(...result.segments.map((s) => s.endTime))
          : undefined
        transcriptionSource = 'aws_transcribe_streaming'
        await saveTranscriptionCache(sessionId, result, transcriptionSource)
      } catch (streamingError: any) {
        console.error('[dev] Streaming transcription failed, falling back to text:', streamingError.message)
      }
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
        await saveTranscriptionCache(sessionId, result, transcriptionSource)
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
  if (audioFile && (transcriptFile || textFile) && (transcriptionSource === 'aws_transcribe' || transcriptionSource === 'aws_transcribe_streaming')) {
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

  // ── Step 1b: Resolve participant speaker ──

  const segments = Array.isArray(structuredTranscript)
    ? structuredTranscript
    : [{ speaker: 'Speaker', text: fullText }]

  let resolvedParticipantSpeaker: string | undefined
  if (session.participantName?.trim()) {
    const matched = findMatchingSpeaker(segments, session.participantName)
    if (matched) {
      resolvedParticipantSpeaker = matched
    } else {
      resolvedParticipantSpeaker = getDominantSpeaker(segments)
      console.log(
        `[replay] Participant "${session.participantName}" not found. Falling back to dominant speaker "${resolvedParticipantSpeaker}".`
      )
    }
  } else {
    resolvedParticipantSpeaker = getDominantSpeaker(segments)
    console.log(
      `[replay] No participant provided. Using dominant speaker "${resolvedParticipantSpeaker}".`
    )
  }

  // ── Step 2: Calculate metrics ──

  await prisma.replaySession.update({
    where: { id: sessionId },
    data: { status: 'analyzing' },
  })

  const metrics = calculateReplayMetrics(
    segments,
    resolvedParticipantSpeaker,
    durationSec,
    transcriptionSource
  )

  // ── Step 3: AI analysis via Bedrock ──

  const startMs = Date.now()
  const speakerLabeledText = buildSpeakerLabeledText(segments)
  const aiResult = await analyzeTranscript(speakerLabeledText, {
    meetingType: session.meetingType,
    userRole: session.userRole,
    focusAreas: session.focusAreas,
    meetingGoal: session.meetingGoal || undefined,
    participantName: resolvedParticipantSpeaker,
    speakerCount,
    durationEstimate: durationSec,
  })
  const processingTimeMs = Date.now() - startMs

  // ── Step 4: Run shared analytics engine (signal extraction → skill scores → coaching) ──

  const analyticsMessages = normalizeSegmentsForAnalytics(segments, resolvedParticipantSpeaker!)
  const effectiveDurationSec = durationSec || processingTimeMs / 1000

  let signals: TextSignals | null = await fetchSignals(sessionId, analyticsMessages, effectiveDurationSec)
  if (!signals) {
    console.log(`[replay] Python signal API unavailable for ${sessionId}, using fallback`)
    signals = buildFallbackSignals(analyticsMessages, effectiveDurationSec)
  }

  const { scores: skillScores, components: skillComponents } = calculateSkillScores(signals, analyticsMessages.length)

  let coachingInsights: any = null
  try {
    coachingInsights = await generateCoachingInsights({
      skillScores,
      signals,
      sessionName: session.sessionName || undefined,
      focusArea: session.focusAreas?.[0] || undefined,
      totalMessages: analyticsMessages.length,
      durationSec: effectiveDurationSec,
    })
  } catch (err: any) {
    console.error(`[replay] Coaching insight generation failed for ${sessionId}:`, err.message)
  }

  const skillScoresJson = JSON.parse(JSON.stringify({ scores: skillScores, components: skillComponents }))
  const signalsJson = JSON.parse(JSON.stringify(signals))
  const coachingJson = coachingInsights ? JSON.parse(JSON.stringify(coachingInsights)) : null

  // ── Step 5: Save results ──

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
      hedgingCount: metrics.hedgingCount,
      hedgingRate: metrics.hedgingRate,
      avgSentenceLength: metrics.avgSentenceLength,
      vocabularyDiversity: metrics.vocabularyDiversity,
      totalTurns: metrics.totalTurns,
      speakingPercentage: metrics.speakingPercentage,
      interruptionCount: metrics.interruptionCount,
      longestMonologueSec: metrics.longestMonologueSec,
      questionsAsked: metrics.questionsAsked,
      repetitionRequests: metrics.repetitionRequests,
      avgResponseTimeSec: metrics.avgResponseTimeSec,

      overallScore: calculateWeightedOverallScore(skillScores),
      clarityScore: aiResult.clarityScore,
      confidenceScore: aiResult.confidenceScore,
      engagementScore: aiResult.engagementScore,

      strengths: aiResult.strengths,
      improvements: aiResult.improvements,
      recommendations: aiResult.recommendations,
      contextSpecificFeedback: aiResult.contextSpecificFeedback,
      keyMoments: aiResult.keyMoments,
      annotatedTranscript: filterParticipantAnnotations(
        correctAnnotatedSpeakers(aiResult.annotatedTranscript, segments),
        segments,
        resolvedParticipantSpeaker
      ),

      skillScores: skillScoresJson,
      communicationSignals: signalsJson,
      coachingInsights: coachingJson,

      modelUsed: process.env.BEDROCK_REPLAY_MODEL_ID || 'amazon.nova-pro-v1:0',
      promptTokens: aiResult.promptTokens,
      completionTokens: aiResult.completionTokens,
      processingTimeMs,
    },
  })

  // ── Step 6: Auto-track Progress Pulse ──

  if (session.meetingDate) {
    try {
      await saveSkillScoresToPulse(
        session.userId,
        sessionId,
        'replay',
        skillScores,
        skillComponents,
      )
      await prisma.replaySession.update({
        where: { id: sessionId },
        data: { progressPulseStatus: 'tracked' },
      })
      console.log(`[replay] Progress Pulse auto-tracked for ${sessionId}`)
    } catch (pulseErr: any) {
      console.error(`[replay] Progress Pulse save failed for ${sessionId}:`, pulseErr.message)
    }
  }

  await prisma.replaySession.update({
    where: { id: sessionId },
    data: { status: 'completed' },
  })

  console.log(`Replay session ${sessionId} processing completed in ${processingTimeMs}ms`)
}

// ── PATCH /api/replay/sessions/:id ──

router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { participantName, meetingDate, sessionName } = req.body

    const session = await prisma.replaySession.findUnique({ where: { id } })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })

    const data: { participantName?: string | null; meetingDate?: Date | null; sessionName?: string | null } = {}
    if (sessionName !== undefined) {
      data.sessionName = sessionName?.trim() || null
    }
    if (participantName !== undefined) {
      data.participantName = participantName?.trim() || null
    }
    if (meetingDate !== undefined) {
      if (meetingDate === null || meetingDate === '') {
        data.meetingDate = null
      } else {
        const d = new Date(meetingDate)
        if (Number.isNaN(d.getTime())) {
          return res.status(400).json({ error: 'meetingDate must be a valid date' })
        }
        data.meetingDate = d
      }
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Send sessionName, participantName and/or meetingDate to update' })
    }

    const updated = await prisma.replaySession.update({
      where: { id },
      data,
      select: { id: true, sessionName: true, participantName: true, meetingDate: true, status: true },
    })

    res.json(updated)
  } catch (error) {
    console.error('Error updating replay session:', error)
    res.status(500).json({ error: 'Failed to update replay session' })
  }
})

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
        sessionName: session.sessionName,
        meetingType: session.meetingType,
        userRole: session.userRole,
        focusAreas: session.focusAreas,
        meetingGoal: session.meetingGoal,
        meetingDate: session.meetingDate,
        participantName: session.participantName,
        status: session.status,
        progressPulseStatus: session.progressPulseStatus,
        createdAt: session.createdAt,
      },
      uploads: session.uploadedFiles,
      result: session.result,
      skillScores: session.result?.skillScores ?? null,
      coachingInsights: session.result?.coachingInsights ?? null,
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
          select: { id: true, fileType: true, originalName: true },
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

// ── GET /api/replay/sessions/:id/download/:fileId ──

router.get('/sessions/:id/download/:fileId', async (req: Request, res: Response) => {
  try {
    const { id, fileId } = req.params
    const file = await prisma.replayUpload.findFirst({
      where: { id: fileId, replaySessionId: id },
    })
    if (!file) return res.status(404).json({ error: 'File not found' })

    if (!existsSync(file.storedPath)) {
      return res.status(404).json({ error: 'File no longer exists on disk' })
    }

    res.download(file.storedPath, file.originalName)
  } catch (error) {
    console.error('Error downloading file:', error)
    res.status(500).json({ error: 'Failed to download file' })
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

    // Delete uploaded files and transcription cache from disk
    for (const file of session.uploadedFiles) {
      try {
        await unlink(file.storedPath)
      } catch {
        // file may already be gone
      }
    }
    try {
      await unlink(transcriptionCachePath(id))
    } catch {
      // cache file may not exist
    }

    // Remove associated Progress Pulse entries
    await prisma.progressPulse.deleteMany({
      where: { sessionId: id, source: 'replay' },
    })

    await prisma.replaySession.delete({ where: { id } })
    res.json({ message: 'Replay session deleted' })
  } catch (error) {
    console.error('Error deleting replay session:', error)
    res.status(500).json({ error: 'Failed to delete replay session' })
  }
})

export default router
