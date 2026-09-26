import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { buildReplayEvidence, legacyInput, transcriptRevision, digest, selectionMatches, replaySegments, replaySpeakerCandidates, speakerMeetsAssessment, type ReplayEvidenceInput, type ReplaySelection } from '../lib/replay-evidence'
import { identifyReplayRecording, replayCacheKey, isReusableReplayCache } from '../lib/replay-recording'
import { replayResultView } from '../lib/replay-result-view'
import { Router, Request, Response } from 'express'
import multer from 'multer'
import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { prisma } from '../lib/prisma'
import { logger, reqLog } from '../lib/logger'
import {
  exportDenied,
  getReplaySessionOwnerId,
  isPrivilegedRole,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'
import { trackFeatureUsage } from '../middleware/tracking'
import { replaySessionAccessWhere } from '../lib/replay-access'

function ownedReplayWhere(req: Request, id: string) {
  return replaySessionAccessWhere(
    id,
    req.user!.userId,
    isPrivilegedRole(req.user?.role),
  )
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
import {
  detectFormatAndParse,
  buildSpeakerLabeledText,
  correctAnnotatedSpeakers,
  filterParticipantAnnotations,
  extractMeetingDateFromTranscript,
} from '../lib/transcript-parser'
import { calculateReplayMetrics } from '../lib/replay-metrics'
import { analyzeTranscript } from '../lib/aws-bedrock'
import { getReplayModelId } from '../lib/analysisConfig'
import { calculateSkillScores, calculateWeightedOverallScore, type TextSignals } from '../analytics/skillScores'
import {
  generateCoachingInsights,
} from '../analytics/insightGenerator'
import { skillScoresToPulseEntries } from '../analytics/progressPulse'
import { REPLAY_PULSE_ORIGIN } from '../analytics/pulseEligibility'
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
const INTERNAL_AGENT_TOKEN =
  process.env.INTERNAL_AGENT_TOKEN?.trim() ||
  (process.env.NODE_ENV !== 'production' ? 'dev-internal-agent-token' : '')

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

  const fillerRegex = /\b(um|uh|like|you know|basically|actually|literally|so|well|right|i mean|kind of|sort of)\b/gi
  const fillerMatches = userText.match(fillerRegex) || []
  const hedgingRegex = /\b(i think|maybe|probably|perhaps|kind of|sort of|i guess|not sure|might|could be)\b/gi
  const hedgingMatches = userText.match(hedgingRegex) || []

  const sentences = userText.split(/[.!?]+/).filter((s) => s.trim().length > 3)
  const avgSentLen = sentences.length > 0 ? words.length / sentences.length : 0

  const uniqueWords = new Set(words.map((w) => w.toLowerCase()).filter((w) => w.length > 2))

  return {
    speechRate: { wpm: 0, variability: null, totalWords, status: 'insufficient_evidence' },
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

async function loadCachedTranscription(sessionId: string, cacheKey: string): Promise<TranscriptionResult | null> {
  const cachePath = transcriptionCachePath(sessionId)
  if (!existsSync(cachePath)) return null
  try {
    const raw = await readFile(cachePath, 'utf-8')
    const cached = JSON.parse(raw) as TranscriptionResult & { source?: string; cacheKey?: string }
    if (!isReusableReplayCache(cached, cacheKey)) return null
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
  source: string,
  cacheKey: string
): Promise<void> {
  const cachePath = transcriptionCachePath(sessionId)
  try {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${sessionId} FOR UPDATE`
      if (!await tx.replaySession.findUnique({ where: { id: sessionId } })) return
      await writeFile(cachePath, JSON.stringify({ ...result, source, cacheKey }, null, 2), 'utf-8')
    })
  } catch (err: any) {
    console.warn(`[cache] Failed to save transcription cache: ${err.message}`)
  }
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

// New Replay endpoints use the existing authentication middleware and owner scope.
router.put('/sessions/:id/learner', async (req: Request, res: Response) => {
  const { speaker, transcriptRevision: expectedRevision } = req.body ?? {}
  if (typeof speaker !== 'string' || typeof expectedRevision !== 'string') {
    return res.status(400).json({ error: 'speaker and transcriptRevision are required' })
  }
  try {
    const outcome = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${req.params.id} FOR UPDATE`
      const session = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, req.params.id), include: { result: true } })
      if (!session) return { code: 404, error: 'Replay session not found' }
      if (session.status !== 'completed' || !session.result) return { code: 409, error: 'Wait for analysis to finish' }
      const segments = replaySegments(session.result.structuredTranscript)
      const input = session.result.deliveryEvidence as unknown as ReplayEvidenceInput | null
      const current = input?.version === 'replay-delivery-v1' ? input : legacyInput(segments ?? [], session.result.transcriptionSource)
      if (current.transcriptRevision !== expectedRevision || current.transcriptRevision !== transcriptRevision(segments)) return { code: 409, error: 'Transcript changed; refresh analysis before confirming' }
      if (req.body.recordingSignature !== (current.recording?.signature ?? null)) return { code: 409, error: 'Recording changed; reload before confirming' }
      const candidates = replaySpeakerCandidates(segments)
      if (!Array.isArray(segments) || !candidates.includes(speaker)) return { code: 400, error: 'Unknown speaker' }
      const previous = session.learnerSelection as unknown as ReplaySelection | null
      const previousRevision = buildReplayEvidence(current, previous, segments).identity.revision
      if ((req.body.selectionRevision ?? null) !== previousRevision) return { code: 409, error: 'Speaker selection changed; reload before confirming' }
      if (previous?.speaker === speaker && selectionMatches(previous, current)) return { code: 200, selection: previous }
      const selection: ReplaySelection = { speaker, transcriptRevision: current.transcriptRevision,
        recordingSignature: current.recording?.signature ?? null, provenance: 'user_confirmed',
        revision: digest([speaker, current.transcriptRevision, previous?.revision ?? '', Date.now()]) }
      await tx.replaySession.update({ where: { id: session.id }, data: { learnerSelection: selection as any, progressPulseStatus: null } })
      // Replay-owned removal; shared historical aggregation is intentionally untouched.
      await tx.progressPulse.deleteMany({ where: { sessionId: session.id, source: 'replay' } })
      return { code: 200, selection }
    })
    res.status(outcome.code).json(outcome)
  } catch { res.status(500).json({ error: 'Unable to confirm speaker' }) }
})

// The browser submits only evidence revisions, never scores. Selection changes and
// progress writes serialize on the same session lock.
router.post('/sessions/:id/track-progress', async (req: Request, res: Response) => {
  try {
    const outcome = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${req.params.id} FOR UPDATE`
      const session = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, req.params.id), include: { result: true } })
      if (!session) return { code: 404, error: 'Replay session not found' }
      if (session.status !== 'completed' || !session.result) return { code: 409, error: 'Wait for analysis to finish' }
      const view = replayResultView(session.result, session.learnerSelection as unknown as ReplaySelection | null)
      if (view.evidence.identity.state !== 'confirmed' || !view.skillScores ||
          req.body?.selectionRevision !== view.evidence.identity.revision ||
          req.body?.transcriptRevision !== view.evidence.transcriptRevision) {
        return { code: 409, error: 'Current learner-attributed scores are required; reload the results' }
      }
      if (!session.meetingDate) return { code: 400, error: 'Meeting date is required' }
      const entries = skillScoresToPulseEntries(view.skillScores.scores).filter(e => Number.isFinite(e.score) && e.score >= 0 && e.score <= 10)
      if (!entries.length) return { code: 409, error: 'No eligible scores to track' }
      await tx.progressPulse.deleteMany({ where: { sessionId: session.id, source: 'replay' } })
      await tx.progressPulse.createMany({ data: entries.map(e => ({ userId: session.userId, sessionId: session.id,
        source: 'replay', skill: e.skill, score: e.score, recordedAt: session.meetingDate!,
        metadata: { evidenceOrigin: REPLAY_PULSE_ORIGIN,
          selectionRevision: view.evidence.identity.revision, transcriptRevision: view.evidence.transcriptRevision } })) })
      await tx.replaySession.update({ where: { id: session.id }, data: { progressPulseStatus: 'tracked' } })
      return { code: 200, tracked: entries.length }
    })
    res.status(outcome.code).json(outcome)
  } catch { res.status(500).json({ error: 'Unable to track Replay scores' }) }
})

router.get('/sessions/:id/media/:uploadId', async (req: Request, res: Response) => {
  try {
    const session = await prisma.replaySession.findFirst({ where: ownedReplayWhere(req, req.params.id), include: { result: true, uploadedFiles: true } })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })
    const { flags, accessDenied } = await resolveRequestExportFlags(req, session.userId)
    if (accessDenied || flags.hideAudioDownload) return exportDenied(res, 'Recording access is disabled')
    const input = session.result?.deliveryEvidence as unknown as ReplayEvidenceInput | null
    const file = session.uploadedFiles.find(f => f.id === req.params.uploadId && (f.fileType === 'audio' || f.fileType === 'video'))
    if (!file || input?.recording?.uploadId !== file.id) return res.status(404).json({ error: 'Recording evidence unavailable' })
    if (!isPrivilegedRole(req.user?.role)) {
      const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { enablePro: true, enableUltra: true } })
      if (!(file.fileType === 'video' ? user?.enableUltra : user?.enablePro || user?.enableUltra)) return exportDenied(res, 'Your plan does not include this recording')
    }
    const current = await identifyReplayRecording(file)
    if (current.signature !== input.recording.signature) return res.status(409).json({ error: 'Recording changed; evidence is stale' })
    res.setHeader('Cache-Control', 'private, no-store')
    res.type(file.mimeType)
    res.sendFile(path.resolve(file.storedPath), err => { if (err && !res.headersSent) res.status(404).end() })
  } catch { if (!res.headersSent) res.status(503).json({ error: 'Recording temporarily unavailable' }) }
})

// ── POST /api/replay/sessions ──

router.post('/sessions', trackFeatureUsage('replay', 'session_create'), async (req: Request, res: Response) => {
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
    logger.error({ err: error }, 'Error creating replay session:')
    res.status(500).json({ error: 'Failed to create replay session' })
  }
})

// ── POST /api/replay/sessions/:id/upload ──

router.post(
  '/sessions/:id/upload',
  async (req, res, next) => {
    try {
      const session = await prisma.replaySession.findFirst({ where: ownedReplayWhere(req, req.params.id) })
      if (!session) return res.status(404).json({ error: 'Replay session not found' })
      next()
    } catch { res.status(500).json({ error: 'Unable to authorize upload' }) }
  },
  upload.fields([{ name: 'audio', maxCount: 1 }, { name: 'transcript', maxCount: 1 }]),
  async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined
    const cleanupPaths = Object.values(files ?? {}).flat().map(f => f.path)
    let persisted = false
    try {
      const { id } = req.params
      const pastedText = typeof req.body.text === 'string' ? req.body.text.trim() : ''
      const media = files?.audio?.[0]
      if (media && !isPrivilegedRole(req.user?.role)) {
        const u = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { enablePro: true, enableUltra: true } })
        const video = media.mimetype.startsWith('video/')
        if (!(video ? u?.enableUltra : u?.enablePro || u?.enableUltra)) {
          return res.status(403).json({ error: video ? 'Video uploads require Ultra.' : 'Audio uploads require Pro.', code: video ? 'ULTRA_REQUIRED' : 'PRO_REQUIRED' })
        }
      }
      const prepared: Array<{ fileType: string; originalName: string; storedPath: string; fileSize: number; mimeType: string }> = []
      for (const [field, list] of Object.entries(files ?? {})) {
        for (const f of list) prepared.push({ fileType: field === 'audio' ? f.mimetype.startsWith('video/') ? 'video' : 'audio' : 'transcript',
          originalName: f.originalname, storedPath: f.path, fileSize: f.size, mimeType: f.mimetype })
      }
      if (pastedText) {
        await mkdir(UPLOAD_DIR, { recursive: true })
        const textPath = path.join(UPLOAD_DIR, `${id}_${randomUUID()}_pasted.txt`)
        cleanupPaths.push(textPath)
        await writeFile(textPath, pastedText, 'utf8')
        prepared.push({ fileType: 'text', originalName: 'pasted_text.txt', storedPath: textPath, fileSize: Buffer.byteLength(pastedText), mimeType: 'text/plain' })
      }
      if (!prepared.length) return res.status(400).json({ error: 'No files or text provided' })
      let inferred: Date | null = null
      const transcript = prepared.find(f => f.fileType === 'transcript')
      if (transcript) {
        try { inferred = extractMeetingDateFromTranscript(await readFile(transcript.storedPath, 'utf8'), transcript.originalName) } catch { /* not a text format */ }
      }
      if (!inferred && pastedText) inferred = extractMeetingDateFromTranscript(pastedText, 'pasted-transcript.vtt')
      const outcome = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${id} FOR UPDATE`
        const session = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, id) })
        if (!session) return { code: 404, error: 'Replay session not found' }
        if (!['pending', 'completed', 'failed'].includes(session.status)) return { code: 409, error: 'Wait for the current analysis before changing uploads' }
        const uploads = []
        for (const file of prepared) uploads.push(await tx.replayUpload.create({ data: { replaySessionId: id, ...file } }))
        await tx.replayResult.deleteMany({ where: { replaySessionId: id } })
        await tx.progressPulse.deleteMany({ where: { sessionId: id, source: 'replay' } })
        await tx.replaySession.update({ where: { id }, data: { status: 'pending', learnerSelection: Prisma.DbNull, progressPulseStatus: null,
          ...(session.meetingDate ? {} : { meetingDate: inferred }) } })
        const meetingDate = session.meetingDate ?? inferred
        return { code: 200, uploads: uploads.map(({ storedPath, ...safe }) => safe), meetingDateMissing: !meetingDate,
          meetingDateAutoFilled: !session.meetingDate && !!inferred, meetingDate: meetingDate?.toISOString().slice(0, 10) ?? null }
      })
      persisted = outcome.code === 200
      res.status(outcome.code).json(outcome)
    } catch (error) {
      logger.error({ err: error }, 'Replay upload failed')
      res.status(500).json({ error: 'Failed to upload files' })
    } finally {
      if (!persisted) await Promise.all(cleanupPaths.map(file => unlink(file).catch(() => {})))
    }
  },
)

// ── POST /api/replay/sessions/:id/process ──

router.post('/sessions/:id/process', trackFeatureUsage('replay', 'analyze'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { selectionRevision, transcriptRevision: expectedTranscript } = req.body ?? {}
    const boundAssessment = selectionRevision !== undefined || expectedTranscript !== undefined
    if (boundAssessment && (typeof selectionRevision !== 'string' || typeof expectedTranscript !== 'string')) {
      return res.status(400).json({ error: 'selectionRevision and transcriptRevision are required together' })
    }
    const session = await prisma.replaySession.findFirst({
      where: ownedReplayWhere(req, id),
      include: { uploadedFiles: { orderBy: { createdAt: 'desc' } } },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })

    if (!session.meetingDate) {
      return res.status(400).json({
        code: 'MEETING_DATE_REQUIRED',
        error:
          'A meeting date is required for Progress Pulse trend tracking. Please set one before processing.',
      })
    }

    if (!['pending', 'completed', 'failed'].includes(session.status)) {
      return res.status(400).json({
        error: `Session is currently ${session.status}`,
        status: session.status,
      })
    }

    const claimed = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${id} FOR UPDATE`
      const fresh = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, id), include: { result: true } })
      if (!fresh || !['pending', 'completed', 'failed'].includes(fresh.status)) return 'busy'
      if (boundAssessment) {
        const view = fresh.result ? replayResultView(fresh.result, fresh.learnerSelection as unknown as ReplaySelection | null) : null
        if (view?.evidence.identity.state !== 'confirmed' || view.evidence.identity.revision !== selectionRevision ||
            view.evidence.transcriptRevision !== expectedTranscript) return 'selection_changed'
      }
      // Claim runs under lock; previous successful results stay visible until replacement succeeds.
      await tx.replaySession.update({ where: { id }, data: { status: 'transcribing', errorMessage: null, progressPulseStatus: null } })
      return 'claimed'
    })
    if (claimed !== 'claimed') return res.status(409).json({ error: claimed === 'selection_changed'
      ? 'The confirmed speaker or transcript changed. Reload before starting the assessment.'
      : 'Replay session is busy or no longer available' })

    // Fire-and-forget processing — respond immediately
    res.json({ message: 'Processing started', status: 'transcribing' })

    // Run pipeline asynchronously
    reqLog(req).info({ event: 'replay.process_started', sessionId: id }, 'replay processing started')
    processReplaySession(id).catch((err) => {
      logger.error({ err, event: 'replay.process_failed', sessionId: id }, 'replay processing failed')
      prisma.replaySession
        .update({
          where: { id },
          data: { status: 'failed', errorMessage: err.message },
        })
        .catch((updErr) => logger.error({ err: updErr, sessionId: id }, 'replay failure-status update failed'))
    })
  } catch (error) {
    logger.error({ err: error }, 'Error starting processing:')
    res.status(500).json({ error: 'Failed to start processing' })
  }
})

// ── The actual processing pipeline ──

async function processReplaySession(sessionId: string): Promise<void> {
  const pipelineStartMs = Date.now()
  const session = await prisma.replaySession.findUnique({
    where: { id: sessionId },
    include: { uploadedFiles: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
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
  let retainedTranscription: TranscriptionResult | null = null
  const recording = audioFile ? await identifyReplayRecording(audioFile).catch(() => null) : null
  const cacheKey = recording ? replayCacheKey(recording, isDev ? 'aws_streaming:en-US:speakers' : 'aws_batch:en-US:max10') : ''

  // ── Step 1: Get transcript text (check cache first) ──

  if (audioFile && recording) {
    await prisma.replaySession.update({
      where: { id: sessionId },
      data: { status: 'transcribing' },
    })

    // Check for cached transcription from a previous run
    const cached = await loadCachedTranscription(sessionId, cacheKey)
    if (cached) {
      retainedTranscription = cached
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
        retainedTranscription = result
        fullText = result.fullText
        structuredTranscript = result.segments
        speakerCount = result.speakerCount
        durationSec = result.segments.length > 0
          ? Math.max(...result.segments.map((s) => s.endTime))
          : undefined
        transcriptionSource = 'aws_transcribe_streaming'
        await saveTranscriptionCache(sessionId, result, transcriptionSource, cacheKey)
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

        retainedTranscription = result
        fullText = result.fullText
        structuredTranscript = result.segments
        speakerCount = result.speakerCount
        durationSec = result.segments.length > 0
          ? Math.max(...result.segments.map((s) => s.endTime))
          : undefined
        transcriptionSource = 'aws_transcribe'
        await saveTranscriptionCache(sessionId, result, transcriptionSource, cacheKey)
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

  if (!fullText.trim()) {
    throw new Error('No transcript text could be extracted from the uploaded files')
  }

  // ── Step 1b: Resolve confirmed learner speaker ──

  const segments = Array.isArray(structuredTranscript)
    ? structuredTranscript
    : [{ speaker: 'Speaker', text: fullText }]

  const deliveryEvidence: ReplayEvidenceInput = {
    version: 'replay-delivery-v1', recording, transcriptRevision: transcriptRevision(segments),
    transcriptSource: transcriptionSource, words: retainedTranscription?.wordEvidence ?? null,
    supplementaryTranscript: null,
  }
  const learner = session.learnerSelection as unknown as ReplaySelection | null
  const candidates = replaySpeakerCandidates(segments)
  const resolvedParticipantSpeaker = selectionMatches(learner, deliveryEvidence) && candidates.includes(learner?.speaker ?? '')
    ? learner!.speaker
    : null
  const assessmentReady = !!resolvedParticipantSpeaker && speakerMeetsAssessment(segments, resolvedParticipantSpeaker)
  if (resolvedParticipantSpeaker && learner) {
    deliveryEvidence.analysisSelectionRevision = learner.revision
    if (!assessmentReady) deliveryEvidence.assessmentGate = 'insufficient_speech'
  }
  if (audioFile && (transcriptFile || textFile) && retainedTranscription) {
    const supplement = transcriptFile || textFile!
    try {
      const text = await readFile(supplement.storedPath, 'utf8')
      const parsed = detectFormatAndParse(text, supplement.mimeType, supplement.originalName)
      deliveryEvidence.supplementaryTranscript = { revision: transcriptRevision(parsed.segments),
        status: parsed.fullText.trim() === fullText.trim() ? 'matches' : 'different_not_aligned' }
    } catch {
      logger.warn({ sessionId }, 'Replay supplemental transcript unavailable; retaining audio-derived analysis')
      deliveryEvidence.supplementaryTranscript = { revision: null, status: 'unavailable' }
    }
  }

  const measured = buildReplayEvidence(deliveryEvidence, learner, segments)
  const metrics = calculateReplayMetrics(segments, resolvedParticipantSpeaker ?? undefined, durationSec, transcriptionSource)

  if (!assessmentReady) {
    const processingTimeMs = Date.now() - pipelineStartMs
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${sessionId} FOR UPDATE`
      await tx.replayResult.deleteMany({ where: { replaySessionId: sessionId } })
      await tx.replayResult.create({
        data: {
          replaySessionId: sessionId,
          deliveryEvidence: JSON.parse(JSON.stringify(deliveryEvidence)),
          transcriptText: fullText,
          structuredTranscript: structuredTranscript ?? undefined,
          speakerCount,
          transcriptionSource,
          wordsPerMinute: measured.pace.wpm ?? 0,
          fillerWordCount: metrics.fillerWordCount,
          fillerWordRate: metrics.fillerWordRate,
          hedgingCount: metrics.hedgingCount,
          hedgingRate: metrics.hedgingRate,
          avgSentenceLength: metrics.avgSentenceLength,
          vocabularyDiversity: metrics.vocabularyDiversity,
          totalTurns: metrics.totalTurns,
          speakingPercentage: metrics.speakingPercentage,
          interruptionCount: metrics.interruptionCount ?? 0,
          longestMonologueSec: metrics.longestMonologueSec,
          questionsAsked: metrics.questionsAsked,
          repetitionRequests: metrics.repetitionRequests,
          avgResponseTimeSec: metrics.avgResponseTimeSec,
          overallScore: 0,
          clarityScore: 0,
          confidenceScore: 0,
          engagementScore: 0,
          strengths: [],
          improvements: [],
          recommendations: [],
          contextSpecificFeedback: [],
          keyMoments: [],
          annotatedTranscript: [],
          skillScores: Prisma.DbNull,
          communicationSignals: Prisma.DbNull,
          coachingInsights: Prisma.DbNull,
          modelUsed: null,
          promptTokens: 0,
          completionTokens: 0,
          processingTimeMs,
        },
      })
      await tx.coachHomeResultReceipt.deleteMany({ where: { userId: session.userId, module: 'replay', targetId: sessionId } })
      await tx.progressPulse.deleteMany({ where: { sessionId, source: 'replay' } })
      await tx.replaySession.update({ where: { id: sessionId }, data: { status: 'completed' } })
    })
    logger.info(
      { event: 'replay.process_completed', sessionId, phase: resolvedParticipantSpeaker ? 'insufficient_speech' : 'confirmation_required', processingTimeMs },
      'replay processing completed',
    )
    return
  }

  await prisma.replaySession.update({
    where: { id: sessionId },
    data: { status: 'analyzing' },
  })

  const startMs = Date.now()
  const replayModelId = await getReplayModelId()
  const speakerLabeledText = buildSpeakerLabeledText(segments)
  const aiResult = await analyzeTranscript(
    speakerLabeledText,
    {
      meetingType: session.meetingType,
      userRole: session.userRole,
      focusAreas: session.focusAreas,
      meetingGoal: session.meetingGoal || undefined,
      participantName: resolvedParticipantSpeaker,
      speakerCount,
      durationEstimate: durationSec,
    },
    replayModelId
  )
  const processingTimeMs = Date.now() - startMs

  const analyticsMessages = normalizeSegmentsForAnalytics(segments, resolvedParticipantSpeaker)
  const effectiveDurationSec = durationSec || processingTimeMs / 1000

  let signals: TextSignals | null = await fetchSignals(sessionId, analyticsMessages, effectiveDurationSec)
  if (!signals) {
    console.log(`[replay] Python signal API unavailable for ${sessionId}, using fallback`)
    signals = buildFallbackSignals(analyticsMessages, effectiveDurationSec)
  }
  signals.speechRate = { ...signals.speechRate, wpm: measured.pace.wpm ?? 0, variability: null,
    status: measured.pace.wpm == null ? 'insufficient_evidence' : 'available', source: measured.pace.wpm == null ? null : 'word_timestamps', confidence: 'medium' }

  const { scores: skillScores, components: skillComponents } = calculateSkillScores(signals, analyticsMessages.length)

  let coachingInsights: any = null
  const replayAudio = null as { audioPath: string; audioMime: string } | null
  try {
    coachingInsights = await generateCoachingInsights({
      skillScores,
      signals,
      sessionName: session.sessionName || undefined,
      focusArea: session.focusAreas?.[0] || undefined,
      totalMessages: analyticsMessages.length,
      durationSec: effectiveDurationSec,
      audioPath: replayAudio?.audioPath,
      audioMime: replayAudio?.audioMime,
      modelId: replayModelId,
    })
  } catch (err: any) {
    console.error(`[replay] Coaching insight generation failed for ${sessionId}:`, err.message)
  }

  const skillScoresJson = JSON.parse(JSON.stringify({ scores: skillScores, components: skillComponents }))
  const signalsJson = JSON.parse(JSON.stringify(signals))
  const coachingJson = coachingInsights ? JSON.parse(JSON.stringify(coachingInsights)) : null

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${sessionId} FOR UPDATE`
    await tx.replayResult.deleteMany({ where: { replaySessionId: sessionId } })
    await tx.replayResult.create({
      data: {
        replaySessionId: sessionId,
        deliveryEvidence: JSON.parse(JSON.stringify(deliveryEvidence)),
        transcriptText: fullText,
        structuredTranscript: structuredTranscript ?? undefined,
        speakerCount,
        transcriptionSource,
        wordsPerMinute: measured.pace.wpm ?? 0,
        fillerWordCount: metrics.fillerWordCount,
        fillerWordRate: metrics.fillerWordRate,
        hedgingCount: metrics.hedgingCount,
        hedgingRate: metrics.hedgingRate,
        avgSentenceLength: metrics.avgSentenceLength,
        vocabularyDiversity: metrics.vocabularyDiversity,
        totalTurns: metrics.totalTurns,
        speakingPercentage: metrics.speakingPercentage,
        interruptionCount: metrics.interruptionCount ?? 0,
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
        modelUsed: replayModelId,
        promptTokens: aiResult.promptTokens,
        completionTokens: aiResult.completionTokens,
        processingTimeMs,
      },
    })
    await tx.coachHomeResultReceipt.deleteMany({ where: { userId: session.userId, module: 'replay', targetId: sessionId } })
    await tx.progressPulse.deleteMany({ where: { sessionId, source: 'replay' } })
    await tx.replaySession.update({
      where: { id: sessionId },
      data: { status: 'completed' },
    })
  })

  logger.info(
    { event: 'replay.process_completed', sessionId, phase: 'personalized', processingTimeMs },
    'replay processing completed',
  )
}

// ── PATCH /api/replay/sessions/:id ──

router.patch('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const { participantName, meetingDate, sessionName } = req.body ?? {}
    if ([participantName, sessionName, meetingDate].some(value => value != null && typeof value !== 'string')) {
      return res.status(400).json({ error: 'Metadata values must be strings or null' })
    }

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

    const updated = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${id} FOR UPDATE`
      const session = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, id) })
      if (!session) return null
      // Date edits and tracking use the same lock; Pulse must retain the
      // session's current date regardless of which request arrives first.
      if (data.meetingDate !== undefined) {
        if (data.meetingDate) await tx.progressPulse.updateMany({ where: { sessionId: id, source: 'replay' }, data: { recordedAt: data.meetingDate } })
        else await tx.progressPulse.deleteMany({ where: { sessionId: id, source: 'replay' } })
      }
      return tx.replaySession.update({
        where: { id },
        data: { ...data, ...(data.meetingDate === null ? { progressPulseStatus: null } : {}) },
        select: { id: true, sessionName: true, participantName: true, meetingDate: true, status: true },
      })
    })
    if (!updated) return res.status(404).json({ error: 'Replay session not found' })
    res.json(updated)
  } catch (error) {
    logger.error({ err: error }, 'Error updating replay session:')
    res.status(500).json({ error: 'Failed to update replay session' })
  }
})

// ── GET /api/replay/sessions/:id/status ──

router.get('/sessions/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const session = await prisma.replaySession.findFirst({
      where: ownedReplayWhere(req, id),
      select: { id: true, status: true, errorMessage: true, updatedAt: true },
    })
    if (!session) return res.status(404).json({ error: 'Replay session not found' })
    res.json(session)
  } catch (error) {
    logger.error({ err: error }, 'Error fetching replay status:')
    res.status(500).json({ error: 'Failed to fetch status' })
  }
})

// ── GET /api/replay/sessions/:id/results ──

router.get('/sessions/:id/results', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const ownerId = await getReplaySessionOwnerId(id)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }

    const session = await prisma.replaySession.findFirst({
      where: ownedReplayWhere(req, id),
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

    const safe = replayResultView(session.result, session.learnerSelection as unknown as ReplaySelection | null)
    if (flags.hideTranscriptText) {
      safe.result.transcriptText = ''
      safe.result.structuredTranscript = []
      safe.result.strengths = []
      safe.result.improvements = []
      safe.result.recommendations = []
      safe.result.contextSpecificFeedback = []
      safe.result.annotatedTranscript = []
      safe.result.keyMoments = []
      safe.result.coachingInsights = null
      safe.evidence.speakers = safe.evidence.speakers.map(speaker => ({ ...speaker, excerpt: '' }))
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
      result: safe.result,
      evidence: safe.evidence,
      transcriptHidden: flags.hideTranscriptText,
      transcriptJsonExportDisabled: flags.hideTranscriptJsonExport,
      audioDownloadDisabled: flags.hideAudioDownload,
      skillScores: safe.skillScores,
      coachingInsights: flags.hideTranscriptText ? null : safe.coachingInsights,
    })
  } catch (error) {
    logger.error({ err: error }, 'Error fetching replay results:')
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
            deliveryEvidence: true,
            structuredTranscript: true,
            skillScores: true,
          },
        },
        uploadedFiles: {
          select: { id: true, fileType: true, originalName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json({ sessions: sessions.map(s => ({ ...s, learnerSelection: undefined, result: s.result ? {
      transcriptionSource: s.result.transcriptionSource,
      overallScore: replayResultView(s.result, s.learnerSelection as unknown as ReplaySelection | null).result.overallScore,
    } : null })) })
  } catch (error) {
    logger.error({ err: error }, 'Error listing replay sessions:')
    res.status(500).json({ error: 'Failed to list replay sessions' })
  }
})

// ── GET /api/replay/sessions/:id/download/:fileId ──

router.get('/sessions/:id/download/:fileId', async (req: Request, res: Response) => {
  try {
    const { id, fileId } = req.params
    const ownerId = await getReplaySessionOwnerId(id)
    const { flags, accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) {
      return exportDenied(res, 'Access denied')
    }

    const file = await prisma.replayUpload.findFirst({
      where: { id: fileId, replaySessionId: id },
    })
    if (!file) return res.status(404).json({ error: 'File not found' })

    const fileType = String(file.fileType || '').toLowerCase()
    if (flags.hideAudioDownload && (fileType === 'audio' || fileType === 'video')) {
      return exportDenied(res, 'Audio download is disabled for your account')
    }
    if (flags.hideTranscriptText && (fileType === 'transcript' || fileType === 'text')) {
      return exportDenied(res, 'Transcript download is disabled for your account')
    }
    if (flags.hideTranscriptJsonExport && fileType === 'transcript') {
      return exportDenied(res, 'Transcript export is disabled for your account')
    }

    if (!existsSync(file.storedPath)) {
      return res.status(404).json({ error: 'File no longer exists on disk' })
    }

    res.download(file.storedPath, file.originalName)
  } catch (error) {
    logger.error({ err: error }, 'Error downloading file:')
    res.status(500).json({ error: 'Failed to download file' })
  }
})

// ── DELETE /api/replay/sessions/:id ──

router.delete('/sessions/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params
    const deleted = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ReplaySession" WHERE id = ${id} FOR UPDATE`
      const session = await tx.replaySession.findFirst({ where: ownedReplayWhere(req, id), include: { uploadedFiles: true } })
      if (!session) return false
      // Serialize with cache writes so an in-flight transcript cannot recreate a
      // derived cache after deletion. Missing files are harmless; other errors retry.
      for (const storedPath of [...session.uploadedFiles.map(f => f.storedPath), transcriptionCachePath(id)]) {
        try { await unlink(storedPath) } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      await tx.progressPulse.deleteMany({ where: { sessionId: id, source: 'replay' } })
      await tx.replaySession.delete({ where: { id } })
      return true
    })
    if (!deleted) return res.status(404).json({ error: 'Replay session not found' })
    res.json({ message: 'Replay session deleted' })
  } catch (error) {
    logger.error({ err: error }, 'Error deleting replay session:')
    res.status(500).json({ error: 'Failed to delete replay session' })
  }
})

export default router
