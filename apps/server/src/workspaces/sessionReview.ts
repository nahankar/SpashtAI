import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextFunction, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { signWorkspaceReviewMediaToken, verifyWorkspaceReviewMediaToken, verifyWorkspaceToken, type WorkspaceTokenPayload } from '../lib/jwt'
import { audioStorageRoot, workspaceMediaPrefix } from '../lib/mediaStorage'
import { replayResultView } from '../lib/replay-result-view'
import type { ReplaySelection } from '../lib/replay-evidence'
import { questionSnapshotSchema, resultSchema } from '../interviews/evaluator/contracts'
import { transcriptIntegrity } from '../interviews/practice/integrity'
import { WORKSPACE_PRODUCTS, type WorkspaceProduct } from './analytics'
import { idSchema, WorkspaceError } from './contracts'
import { requireWorkspaceManager, withWorkspaceAccess, type establishWorkspace, type WorkspaceTx } from './context'
import { workspaceFeatureReady } from './productAccess'
import { openContainedMedia, sendOpenRecording, type OpenRecording } from './sessionMedia'

type Scope = Awaited<ReturnType<typeof establishWorkspace>>

/** Audit actions. Rows hold ids and filters only, never transcript, answer or feedback content. */
export const REVIEW_AUDIT = {
  list: 'session_review_list',
  detail: 'session_review_detail',
  ticket: 'session_review_media_ticket',
  recording: 'session_review_recording',
} as const
export const REVIEW_MEDIA_PARAM = 'review_media'
export const REVIEW_STATUSES = ['in_progress', 'completed', 'failed'] as const
const PAGE = 50

/**
 * Read-only review by an active Owner/Admin of the current organization. The audit row is
 * written first, then the transaction becomes READ ONLY and the database 'reviewer' reader
 * is enabled; `workspace_review_reads` refuses every row unless all of those hold and the
 * actor is still an active Owner/Admin. A failed review rolls back its audit row.
 */
export function withSessionReview<T>(
  claims: WorkspaceTokenPayload,
  audit: { action: string; subjectId?: string; metadata?: Prisma.InputJsonObject } | null,
  work: (tx: WorkspaceTx, scope: Scope) => Promise<T>,
) {
  return withWorkspaceAccess(claims, async (tx, scope) => {
    requireWorkspaceManager(scope)
    if (audit) {
      await tx.workspaceAudit.create({ data: { workspaceId: scope.workspace.id, actorUserId: scope.member.userId,
        action: audit.action, subjectId: audit.subjectId ?? null, metadata: audit.metadata ?? {} } })
    }
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
    await tx.$executeRaw`SELECT set_config('app.workspace_reader', 'reviewer', true)`
    return work(tx, scope)
  })
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export const reviewListSchema = z.object({
  learner: idSchema.optional(),
  product: z.enum(WORKSPACE_PRODUCTS).optional(),
  status: z.enum(REVIEW_STATUSES).optional(),
  from: day.optional(),
  to: day.optional(),
  after: z.string().min(1).max(400).optional(),
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, 'The start date must be on or before the end date')
const productSchema = z.enum(WORKSPACE_PRODUCTS)

function encodeCursor(at: Date, id: string) { return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url') }
function decodeCursor(value: string) {
  try {
    const [at, id] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown[]
    if (typeof at === 'string' && !Number.isNaN(Date.parse(at)) && typeof id === 'string' && idSchema.safeParse(id).success) return { at, id }
  } catch { /* invalid below */ }
  throw new WorkspaceError(400, 'INVALID_CURSOR', 'Invalid page cursor')
}

type Learner = { memberId: string | null; name: string; email: string | null }
async function learners(tx: WorkspaceTx, workspaceId: string, userIds: string[]) {
  const rows = userIds.length ? await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: userIds } },
    select: { id: true, userId: true, user: { select: { firstName: true, lastName: true, email: true } } } }) : []
  const map = new Map<string, Learner>(rows.map(row => [row.userId, { memberId: row.id, email: row.user.email,
    name: [row.user.firstName, row.user.lastName].filter(Boolean).join(' ') || row.user.email }]))
  return (userId: string): Learner => map.get(userId) ?? { memberId: null, name: 'Former member', email: null }
}

async function learnerUserId(tx: WorkspaceTx, scope: Scope, memberId: string) {
  const member = await tx.workspaceMember.findFirst({ where: { id: memberId, workspaceId: scope.workspace.id }, select: { userId: true } })
  if (!member) throw new WorkspaceError(404, 'LEARNER_NOT_FOUND', 'Learner not found in this workspace')
  return member.userId
}

type ListRow = { id: string; userId: string; product: WorkspaceProduct; name: string | null; at: Date; endedAt: Date | null; durationSec: number | null; status: string }

export function listReviewSessions(claims: WorkspaceTokenPayload, input: unknown) {
  const query = reviewListSchema.parse(input ?? {})
  const audit = { action: REVIEW_AUDIT.list, metadata: { learner: query.learner ?? null, product: query.product ?? null,
    status: query.status ?? null, from: query.from ?? null, to: query.to ?? null } }
  return withSessionReview(claims, audit, async (tx, scope) => {
    const ws = scope.workspace.id
    const tz = scope.workspace.timeZone
    const userId = query.learner ? await learnerUserId(tx, scope, query.learner) : null
    const cursor = query.after ? decodeCursor(query.after) : null
    const parts: Prisma.Sql[] = []
    if (!query.product || query.product !== 'replay') {
      const purposes = query.product === 'elevate' ? ['COMMUNICATION'] : query.product === 'interviews' ? ['INTERVIEW'] : ['COMMUNICATION', 'INTERVIEW']
      parts.push(Prisma.sql`SELECT s.id, s."userId", CASE WHEN s.purpose = 'INTERVIEW' THEN 'interviews' ELSE 'elevate' END AS product,
        s."sessionName" AS name, s."startedAt" AS at, s."endedAt" AS "endedAt", s."durationSec" AS "durationSec",
        CASE WHEN s."endedAt" IS NULL THEN 'in_progress' ELSE 'completed' END AS status
        FROM "Session" s WHERE s."workspaceId" = ${ws} AND s."workspaceKind" = 'ORGANIZATION' AND s."discardedAt" IS NULL
        AND s.purpose::text IN (${Prisma.join(purposes)})
        AND NOT EXISTS (SELECT 1 FROM "PreparationPractice" p WHERE p."sessionId" = s.id)`)
    }
    if (!query.product || query.product === 'replay') {
      parts.push(Prisma.sql`SELECT r.id, r."userId", 'replay' AS product, coalesce(r."sessionName", r."meetingType") AS name,
        r."createdAt" AS at, NULL::timestamp AS "endedAt", NULL::int AS "durationSec",
        CASE r.status WHEN 'completed' THEN 'completed' WHEN 'failed' THEN 'failed' ELSE 'in_progress' END AS status
        FROM "ReplaySession" r WHERE r."workspaceId" = ${ws} AND r."workspaceKind" = 'ORGANIZATION' AND r.purpose = 'COMMUNICATION'
        AND NOT EXISTS (SELECT 1 FROM "PreparationRecording" p WHERE p."replaySessionId" = r.id)`)
    }
    const localDay = Prisma.sql`((a.at AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`
    const filters = [
      userId ? Prisma.sql`a."userId" = ${userId}` : null,
      query.status ? Prisma.sql`a.status = ${query.status}` : null,
      query.from ? Prisma.sql`${localDay} >= ${query.from}::date` : null,
      query.to ? Prisma.sql`${localDay} <= ${query.to}::date` : null,
      cursor ? Prisma.sql`(a.at, a.id) < (${cursor.at}::timestamp, ${cursor.id})` : null,
    ].filter((f): f is Prisma.Sql => f !== null)
    const rows = await tx.$queryRaw<ListRow[]>`SELECT * FROM (${Prisma.join(parts, ' UNION ALL ')}) a
      ${filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty}
      ORDER BY a.at DESC, a.id DESC LIMIT ${PAGE + 1}`
    const page = rows.slice(0, PAGE)
    const who = await learners(tx, ws, [...new Set(page.map(row => row.userId))])
    const items = page.map(row => ({ id: row.id, product: row.product, name: row.name, learner: who(row.userId),
      startedAt: row.at, endedAt: row.endedAt, durationSeconds: row.durationSec, status: row.status }))
    return { items, nextCursor: rows.length > PAGE ? encodeCursor(page.at(-1)!.at, page.at(-1)!.id) : null, timeZone: tz }
  })
}

// ── Explicit, content-only presenters (no stored object is ever spread) ──

const obj = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const str = (value: unknown) => typeof value === 'string' ? value : null
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
const strings = (value: unknown) => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
/** Learner-facing feedback lists: plain text, numbers and nested lists/objects only, bounded depth. */
function plain(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (depth >= 4) return null
  if (Array.isArray(value)) return value.slice(0, 200).map(item => plain(item, depth + 1))
  const record = obj(value)
  return record ? Object.fromEntries(Object.entries(record).map(([key, item]) => [key, plain(item, depth + 1)])) : null
}
const SKILLS = ['clarity', 'conciseness', 'confidence', 'structure', 'engagement', 'pacing', 'delivery', 'emotionalControl'] as const
function skillScores(value: unknown) {
  const source = obj(obj(value)?.scores) ?? obj(value)
  if (!source) return null
  const scores = Object.fromEntries(SKILLS.map(key => [key, num(source[key])]))
  return Object.values(scores).some(v => v !== null) ? scores : null
}
/** Coaching narrative only; provider ids, token counts and error text are internal. */
function coachingInsights(value: unknown) {
  const source = obj(value)
  if (!source) return null
  return { topStrength: str(source.topStrength), primaryImprovement: str(source.primaryImprovement), actionableAdvice: str(source.actionableAdvice),
    practiceExercise: str(source.practiceExercise), overallNarrative: str(source.overallNarrative), topicFlow: str(source.topicFlow),
    practicePlan: Array.isArray(source.practicePlan) ? source.practicePlan.flatMap(item => {
      const row = obj(item)
      return row ? [{ title: str(row.title), description: str(row.description), focusSkill: str(row.focusSkill) }] : []
    }) : [] }
}

const AUDIO_MIME = new Set(['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'video/webm', 'video/mp4'])
const EXTENSION_MIME: Record<string, string> = { webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4' }
/** Only audio/video types are ever served; an unknown stored type is unavailable rather than guessed. */
export function reviewMediaType(mimeType: string | null | undefined, storedPath: string) {
  const declared = mimeType?.split(';')[0].trim().toLowerCase()
  if (declared && AUDIO_MIME.has(declared)) return declared
  return EXTENSION_MIME[path.extname(storedPath).slice(1).toLowerCase()] ?? null
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/
const notFound = () => new WorkspaceError(404, 'SESSION_NOT_FOUND', 'Session not found')

async function reviewableSession(tx: WorkspaceTx, scope: Scope, product: 'elevate' | 'interviews', id: string) {
  const session = await tx.session.findFirst({ where: { id, workspaceId: scope.workspace.id, workspaceKind: 'ORGANIZATION', discardedAt: null,
    purpose: product === 'interviews' ? 'INTERVIEW' : 'COMMUNICATION', preparationPractice: { is: null } },
  select: { id: true, userId: true, sessionName: true, startedAt: true, endedAt: true, durationSec: true, recordingStartedAt: true } })
  if (!session) throw notFound()
  return session
}
async function reviewableReplay(tx: WorkspaceTx, scope: Scope, id: string) {
  const replay = await tx.replaySession.findFirst({ where: { id, workspaceId: scope.workspace.id, workspaceKind: 'ORGANIZATION',
    purpose: 'COMMUNICATION', preparationRecording: { is: null } } })
  if (!replay) throw notFound()
  return replay
}

async function sessionTranscript(tx: WorkspaceTx, sessionId: string) {
  const turns = await tx.sessionTurn.findMany({ where: { sessionId }, orderBy: { sequenceNo: 'asc' },
    select: { id: true, role: true, text: true, audioStart: true, audioEnd: true, score: true, coachNote: true, segmentId: true } })
  if (turns.length) {
    return turns.map(turn => {
      const score = obj(turn.score)
      return { id: turn.id, role: turn.role, text: turn.text, audioStart: turn.audioStart, audioEnd: turn.audioEnd, segmentId: turn.segmentId,
        score: score ? { stars: num(score.stars), tags: strings(score.tags) } : null, coachNote: turn.coachNote }
    })
  }
  // Older sessions keep only the conversation JSON, which may also hold internal audio paths:
  // only the supported message fields are returned.
  const stored = obj((await tx.sessionTranscript.findUnique({ where: { sessionId }, select: { conversationData: true } }))?.conversationData)
  const messages = Array.isArray(stored?.messages) ? stored.messages : []
  return messages.flatMap((message, index) => {
    const row = obj(message)
    return row ? [{ id: str(row.id) ?? `message-${index}`, role: str(row.role), text: str(row.content) ?? '', audioStart: null, audioEnd: null,
      segmentId: null, score: null, coachNote: null }] : []
  })
}

async function sessionRecordings(tx: WorkspaceTx, sessionId: string) {
  const rows = await tx.sessionRecording.findMany({ where: { sessionId, status: 'completed' }, orderBy: { createdAt: 'asc' },
    select: { id: true, duration: true, recordingType: true, mimeType: true, filePath: true, segment: { select: { segmentIndex: true } } } })
  return rows.flatMap(row => {
    const mime = reviewMediaType(row.mimeType, row.filePath)
    return mime ? [{ id: row.id, kind: row.recordingType, mimeType: mime, durationSeconds: row.duration, segmentIndex: row.segment?.segmentIndex ?? null }] : []
  }).sort((a, b) => (a.segmentIndex ?? 0) - (b.segmentIndex ?? 0))
}

const learnerResult = resultSchema.extend({ validationNotes: z.array(z.string()).optional(), responseKind: z.enum(['REQUEST_ONLY', 'DONT_KNOW']).optional() })
const savedIncomplete = (value: Prisma.JsonValue | null) => obj(value)?.incomplete === true

/** Questions, captured answers and technical feedback, following the learner's own visibility rules. */
async function interviewReview(tx: WorkspaceTx, sessionId: string, ended: boolean) {
  const run = await tx.interviewRun.findUnique({ where: { sessionId },
    select: { id: true, track: true, experienceBand: true, startingDifficulty: true, durationMinutes: true, evaluationPolicySnapshot: true } })
  if (!run) return null
  const attempts = await tx.interviewAttempt.findMany({ where: { runId: run.id }, orderBy: { index: 'asc' }, include: {
    chunks: { select: { text: true, localTurnIndex: true, segment: { select: { segmentIndex: true } } } },
    answerSnapshots: { orderBy: { textRevision: 'desc' }, take: 1, select: { answerText: true, textSource: true, textRevision: true, assistance: true,
      transcriptIntegrity: true, assessment: { select: { status: true, errorCode: true, result: true } } } },
    transcriptIssues: { select: { kind: true, lostSpeechSeconds: true, createdAt: true } },
  } })
  const enabled = run.evaluationPolicySnapshot !== null
  return {
    track: run.track, experienceBand: run.experienceBand, startingDifficulty: run.startingDifficulty, durationMinutes: run.durationMinutes,
    evaluationEnabled: enabled,
    attempts: attempts.map(attempt => {
      const parsed = questionSnapshotSchema.safeParse(attempt.questionSnapshot)
      // Answer guidance, example answers and evaluator notes are authoring material and never leave the snapshot.
      const question = parsed.success ? { text: parsed.data.questionText, track: parsed.data.track, category: parsed.data.category,
        topic: parsed.data.topic, difficulty: parsed.data.difficulty } : { text: '', track: null, category: null, topic: null, difficulty: null }
      const snapshot = attempt.answerSnapshots[0]
      const integrity = transcriptIntegrity(attempt.transcriptIssues)
      const incomplete = !!snapshot && (integrity.incomplete || savedIncomplete(snapshot.transcriptIntegrity))
      const unassessed = attempt.status === 'SKIPPED' || attempt.status === 'INCOMPLETE' ? attempt.status
        : enabled && (attempt.status === 'PREPARED' || attempt.status === 'ASKED') ? 'AWAITING_ANSWER' : 'NOT_ENABLED'
      const assessment = snapshot?.assessment
      const parsedResult = ended && !incomplete && assessment?.status === 'COMPLETED' ? learnerResult.safeParse(assessment.result) : null
      const feedbackStatus = !ended ? (enabled ? 'AFTER_PRACTICE' : 'NOT_ENABLED') : incomplete ? 'TRANSCRIPT_INCOMPLETE' : assessment?.status ?? unassessed
      return {
        id: attempt.id, index: attempt.index, status: attempt.status, completionReason: attempt.completionReason,
        assistance: snapshot?.assistance ?? attempt.assistance, askedAt: attempt.askedAt, completedAt: attempt.completedAt, question,
        capturedText: [...attempt.chunks].sort((x, y) => x.segment.segmentIndex - y.segment.segmentIndex || x.localTurnIndex - y.localTurnIndex)
          .map(chunk => chunk.text).join('\n'),
        answer: snapshot ? { text: snapshot.answerText, source: snapshot.textSource, revision: snapshot.textRevision } : null,
        feedback: { status: feedbackStatus, errorCode: ended ? (incomplete ? 'TRANSCRIPT_INCOMPLETE' : assessment?.errorCode ?? null) : null,
          result: parsedResult?.success ? { classification: parsedResult.data.classification, criteria: parsedResult.data.criteria,
            strengths: parsedResult.data.strengths, gaps: parsedResult.data.gaps, misconceptions: parsedResult.data.misconceptions,
            guidance: parsedResult.data.guidance, uncertainty: parsedResult.data.uncertainty, responseKind: parsedResult.data.responseKind ?? null } : null },
      }
    }),
  }
}

async function replayPlan(tx: WorkspaceTx, workspaceId: string) {
  const rows = await tx.workspaceFeature.findMany({ where: { workspaceId, feature: { in: ['pro', 'ultra'] } } })
  const on = (feature: 'pro' | 'ultra') => rows.some(row => row.feature === feature && row.entitled && row.enabled) && workspaceFeatureReady(feature)
  return { audio: on('pro') || on('ultra'), video: on('ultra') }
}

function replayReview(result: Record<string, unknown> | null, selection: unknown) {
  if (!result) return null
  let view: ReturnType<typeof replayResultView>
  try { view = replayResultView(result, selection as ReplaySelection | null) } catch { return null }
  const r = view.result
  return {
    transcriptText: r.transcriptText,
    structuredTranscript: r.structuredTranscript.map(segment => ({ speaker: segment.speaker, text: segment.text,
      startTime: num(segment.startTime), endTime: num(segment.endTime) })),
    metrics: { wordsPerMinute: r.wordsPerMinute, paceStatus: r.paceStatus, fillerWordCount: r.fillerWordCount, fillerWordRate: r.fillerWordRate,
      hedgingCount: r.hedgingCount, avgSentenceLength: r.avgSentenceLength, vocabularyDiversity: r.vocabularyDiversity, totalTurns: r.totalTurns,
      wordShare: r.wordShare, questionsAsked: r.questionsAsked },
    scores: { overall: r.overallScore, clarity: r.clarityScore, confidence: r.confidenceScore, engagement: r.engagementScore },
    skillScores: skillScores(view.skillScores),
    feedback: { strengths: plain(r.strengths), improvements: plain(r.improvements), recommendations: plain(r.recommendations),
      contextSpecificFeedback: plain(r.contextSpecificFeedback), keyMoments: plain(r.keyMoments), scope: r.feedbackScope },
    coachingInsights: coachingInsights(view.coachingInsights),
  }
}

export function reviewSessionDetail(claims: WorkspaceTokenPayload, productInput: unknown, idInput: unknown) {
  const product = productSchema.parse(productInput), id = idSchema.parse(idInput)
  return withSessionReview(claims, { action: REVIEW_AUDIT.detail, subjectId: id, metadata: { product } }, async (tx, scope) => {
    if (product === 'replay') {
      const replay = await reviewableReplay(tx, scope, id)
      const [result, uploads, plan, who] = await Promise.all([
        tx.replayResult.findUnique({ where: { replaySessionId: id } }),
        tx.replayUpload.findMany({ where: { replaySessionId: id }, orderBy: { createdAt: 'asc' },
          select: { id: true, fileType: true, mimeType: true, storedPath: true, duration: true } }),
        replayPlan(tx, scope.workspace.id),
        learners(tx, scope.workspace.id, [replay.userId]),
      ])
      return {
        product, readOnly: true,
        session: { id: replay.id, name: replay.sessionName, learner: who(replay.userId), startedAt: replay.createdAt, endedAt: null, durationSeconds: null,
          status: replay.status === 'completed' ? 'completed' : replay.status === 'failed' ? 'failed' : 'in_progress',
          meetingType: replay.meetingType, userRole: replay.userRole, focusAreas: replay.focusAreas, meetingGoal: replay.meetingGoal, meetingDate: replay.meetingDate },
        recordings: uploads.flatMap(upload => {
          const mime = upload.fileType === 'audio' || upload.fileType === 'video' ? reviewMediaType(upload.mimeType, upload.storedPath) : null
          return mime ? [{ id: upload.id, kind: upload.fileType, mimeType: mime, durationSeconds: upload.duration, segmentIndex: null,
            available: upload.fileType === 'video' ? plan.video : plan.audio }] : []
        }),
        replay: replayReview(result as unknown as Record<string, unknown> | null, replay.learnerSelection),
      }
    }
    const session = await reviewableSession(tx, scope, product, id)
    const [transcript, recordings, metrics, who] = await Promise.all([
      sessionTranscript(tx, id), sessionRecordings(tx, id),
      tx.sessionMetrics.findUnique({ where: { sessionId: id }, select: { userWpm: true, userFillerCount: true, userFillerRate: true,
        userAvgSentenceLength: true, userSpeakingTime: true, userVocabDiversity: true, userResponseTimeAvg: true, totalTurns: true,
        skillScores: true, coachingInsights: true } }),
      learners(tx, scope.workspace.id, [session.userId]),
    ])
    return {
      product, readOnly: true,
      session: { id: session.id, name: session.sessionName, learner: who(session.userId), startedAt: session.startedAt, endedAt: session.endedAt,
        durationSeconds: session.durationSec, status: session.endedAt ? 'completed' : 'in_progress' },
      transcript,
      recordings: recordings.map(recording => ({ ...recording, available: true })),
      results: metrics ? {
        metrics: { wordsPerMinute: metrics.userWpm, fillerCount: metrics.userFillerCount, fillerRate: metrics.userFillerRate,
          avgSentenceLength: metrics.userAvgSentenceLength, speakingSeconds: metrics.userSpeakingTime, vocabularyDiversity: metrics.userVocabDiversity,
          responseTimeAvg: metrics.userResponseTimeAvg, totalTurns: metrics.totalTurns },
        skillScores: skillScores(metrics.skillScores), coachingInsights: coachingInsights(metrics.coachingInsights),
      } : null,
      interview: product === 'interviews' ? await interviewReview(tx, id, session.endedAt !== null) : null,
    }
  })
}

// ── Recordings ──

const serverDir = path.dirname(fileURLToPath(import.meta.url))
function replayUploadRoot() {
  return path.resolve(process.env.REPLAY_UPLOAD_PATH
    || (process.env.NODE_ENV !== 'production' ? path.join(serverDir, '../../../../storage/replay_uploads') : './replay_uploads'))
}
const recordingUnavailable = () => new WorkspaceError(404, 'RECORDING_UNAVAILABLE', 'Recording is not available')

/** Opens one recording of a reviewable activity, only from that activity's own workspace media prefix. */
async function openReviewRecording(tx: WorkspaceTx, scope: Scope, product: WorkspaceProduct, sessionId: string, recordingId: string): Promise<OpenRecording> {
  if (![scope.workspace.id, sessionId, recordingId].every(id => SAFE_ID.test(id))) throw recordingUnavailable()
  if (product === 'replay') {
    await reviewableReplay(tx, scope, sessionId)
    const upload = await tx.replayUpload.findFirst({ where: { id: recordingId, replaySessionId: sessionId, fileType: { in: ['audio', 'video'] } },
      select: { fileType: true, mimeType: true, storedPath: true } })
    const mime = upload && reviewMediaType(upload.mimeType, upload.storedPath)
    if (!upload || !mime) throw recordingUnavailable()
    const plan = await replayPlan(tx, scope.workspace.id)
    if (!(upload.fileType === 'video' ? plan.video : plan.audio)) {
      throw new WorkspaceError(403, 'RECORDING_NOT_IN_PLAN', `Your organization's plan does not include this recording`)
    }
    return openContainedMedia(replayUploadRoot(), workspaceMediaPrefix(scope.workspace.id, 'replay', sessionId), upload.storedPath, mime)
  }
  await reviewableSession(tx, scope, product, sessionId)
  const recording = await tx.sessionRecording.findFirst({ where: { id: recordingId, sessionId, status: 'completed' }, select: { filePath: true, mimeType: true } })
  const mime = recording && reviewMediaType(recording.mimeType, recording.filePath)
  if (!recording || !mime) throw recordingUnavailable()
  return openContainedMedia(audioStorageRoot(), workspaceMediaPrefix(scope.workspace.id, 'sessions', sessionId), recording.filePath, mime)
}

function streamPath(product: string, sessionId: string, recordingId: string) {
  return `/api/workspaces/current/review/sessions/${product}/${encodeURIComponent(sessionId)}/recordings/${encodeURIComponent(recordingId)}/stream`
}

/** Audited playback ticket for `<audio src>`; availability is checked before it is issued. */
export function issueReviewMediaTicket(claims: WorkspaceTokenPayload, productInput: unknown, sessionInput: unknown, recordingInput: unknown) {
  const product = productSchema.parse(productInput), sessionId = idSchema.parse(sessionInput), recordingId = idSchema.parse(recordingInput)
  return withSessionReview(claims, { action: REVIEW_AUDIT.ticket, subjectId: sessionId, metadata: { product, recordingId } }, async (tx, scope) => {
    const file = await openReviewRecording(tx, scope, product, sessionId, recordingId)
    await file.handle.close()
    const ticket = signWorkspaceReviewMediaToken({ userId: claims.userId, workspaceId: claims.workspaceId, membershipId: claims.membershipId,
      product, sessionId, recordingId })
    return { url: `${streamPath(product, sessionId, recordingId)}?${REVIEW_MEDIA_PARAM}=${encodeURIComponent(ticket)}`, expiresInSeconds: 3600 }
  })
}

/**
 * Byte-range playback. Either the workspace token in Authorization (audited per request) or a
 * ticket for exactly this recording (audited when issued). Both recheck the reviewer every request.
 */
export async function streamReviewRecording(req: Request, res: Response, next: NextFunction) {
  let file: OpenRecording | undefined
  try {
    const product = productSchema.parse(req.params.product)
    const sessionId = idSchema.parse(req.params.sessionId), recordingId = idSchema.parse(req.params.recordingId)
    const ticket = req.query[REVIEW_MEDIA_PARAM]
    let claims: WorkspaceTokenPayload
    let audited = true
    if (ticket !== undefined) {
      let media
      try { media = verifyWorkspaceReviewMediaToken(String(ticket)) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
      if (typeof ticket !== 'string' || media.product !== product || media.sessionId !== sessionId || media.recordingId !== recordingId) {
        throw new WorkspaceError(403, 'WORKSPACE_MEDIA_REJECTED', 'This playback link is not valid here')
      }
      claims = { tokenUse: 'workspace', userId: media.userId, workspaceId: media.workspaceId, membershipId: media.membershipId }
      audited = false
    } else {
      const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : ''
      try { claims = verifyWorkspaceToken(token) } catch { throw new WorkspaceError(401, 'WORKSPACE_TOKEN_REQUIRED', 'Open the workspace again to continue') }
    }
    const audit = audited ? { action: REVIEW_AUDIT.recording, subjectId: sessionId, metadata: { product, recordingId, range: Boolean(req.headers.range) } } : null
    // Track the descriptor outside the transaction so a failed commit closes it too.
    await withSessionReview(claims, audit, async (tx, scope) => { file = await openReviewRecording(tx, scope, product, sessionId, recordingId) })
    await sendOpenRecording(req, res, file!)
  } catch (error) { await file?.handle.close().catch(() => {}); next(error) }
}
