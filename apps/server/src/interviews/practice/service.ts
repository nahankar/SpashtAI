import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { lockWritableSession } from '../../lib/sessionDiscard'
import { BankError } from '../bank/csv'
import { learnerEligibleWhere } from '../bank/schemas'
import { hash, questionSnapshotSchema } from '../evaluator/contracts'
import { askedSchema, assistanceSchema, chunkSchema, MAX_ANSWER_LENGTH, MAX_QUESTIONS, PRACTICE_NAMESPACE, startSchema } from './contracts'

type Tx = Prisma.TransactionClient
const json = (value: unknown) => value as Prisma.InputJsonValue

async function executionAccess(tx: Tx, ownerId: string) {
  // Read current rollout state, rather than the public flag map's normalized values.
  await tx.$queryRaw`SELECT feature FROM "PlatformFeatureFlag" WHERE feature='interviews' FOR SHARE`
  const flag = await tx.platformFeatureFlag.findUnique({ where: { feature: 'interviews' } })
  await tx.$queryRaw`SELECT id FROM "UserFeatureGrant" WHERE "userId"=${ownerId} AND feature='interviews' FOR SHARE`
  const grant = await tx.userFeatureGrant.findUnique({ where: { userId_feature: { userId: ownerId, feature: 'interviews' } } })
  if (!flag || flag.hidden || flag.disabled || (flag.audience === 'SELECTED_USERS' && !grant)) {
    throw new BankError(403, 'Interview practice is not available')
  }
}
async function ownedRun(tx: Tx, runId: string, ownerId: string) {
  const run = await tx.interviewRun.findFirst({ where: { id: runId, ownerId } })
  if (!run) throw new BankError(404, 'Interview not found')
  // Always acquire Session before Run, matching discard's persistence fence.
  await lockWritableSession(tx, run.sessionId)
  await tx.$queryRaw`SELECT id FROM "InterviewRun" WHERE id=${runId} FOR UPDATE`
  return run
}
async function writableRun(tx: Tx, runId: string, ownerId: string) {
  const run = await ownedRun(tx, runId, ownerId)
  await executionAccess(tx, ownerId)
  const session = await tx.session.findUniqueOrThrow({ where: { id: run.sessionId } })
  if (session.endedAt) throw new BankError(409, 'Interview has ended')
  return run
}
async function agentAttempt(tx: Tx, attemptId: string) {
  const attempt = await tx.interviewAttempt.findUnique({ where: { id: attemptId }, include: { run: true } })
  if (!attempt) throw new BankError(404, 'Attempt not found')
  const run = await writableRun(tx, attempt.runId, attempt.run.ownerId)
  // Reload after the lock; another callback may have committed the answer.
  return { run, attempt: await tx.interviewAttempt.findUniqueOrThrow({ where: { id: attemptId } }) }
}
async function activeSegment(tx: Tx, sessionId: string, segmentId: string) {
  const segment = await tx.sessionSegment.findFirst({ where: { id: segmentId, sessionId, endedAt: null } })
  if (!segment) throw new BankError(409, 'The speech segment is not active for this interview')
}
function learnerAttempt(row: { id: string; index: number; status: string; assistance: string; questionSnapshot: Prisma.JsonValue }) {
  const q = questionSnapshotSchema.parse(row.questionSnapshot)
  return { id: row.id, index: row.index, status: row.status, assistance: row.assistance,
    question: { text: q.questionText, track: q.track, topic: q.topic, difficulty: q.difficulty, expectedDepth: q.expectedDepth } }
}

export async function startPractice(input: unknown, ownerId: string) {
  const body = startSchema.parse(input)
  return prisma.$transaction(async tx => {
    await executionAccess(tx, ownerId)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interview-start:${ownerId}`},0))`
    const existing = await tx.session.findUnique({ where: { id: body.sessionId }, include: { interviewRun: true } })
    if (existing) {
      if (existing.userId !== ownerId) throw new BankError(404, 'Interview not found')
      await lockWritableSession(tx, existing.id)
      const run = existing.interviewRun
      if (!run || existing.endedAt || run.track !== body.track || run.experienceBand !== body.experienceBand
        || run.startingDifficulty !== body.startingDifficulty || run.durationMinutes !== body.durationMinutes) {
        throw new BankError(409, 'Session ID already belongs to another setup or completed interview')
      }
      return { id: run.id, sessionId: run.sessionId, reused: true }
    }
    const unfinished = await tx.interviewRun.findFirst({ where: { ownerId, session: { endedAt: null, discardedAt: null } } })
    if (unfinished) throw new BankError(409, 'Resume or end your current interview first')
    const eligible = await tx.questionBankQuestion.count({ where: { ...learnerEligibleWhere, namespace: PRACTICE_NAMESPACE,
      track: body.track, experienceBand: body.experienceBand, difficulty: body.startingDifficulty } })
    if (!eligible) throw new BankError(409, 'No eligible questions match this track, experience and difficulty yet')
    const session = await tx.session.create({ data: { id: body.sessionId, userId: ownerId, module: 'elevate',
      purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY', sessionName: `${body.track} interview practice`,
      configurationSnapshot: { capturePolicy: 'committed-turns-1', answerCompletion: 'explicit', technicalFeedback: 'pending' } } })
    const run = await tx.interviewRun.create({ data: { sessionId: session.id, ownerId, namespace: PRACTICE_NAMESPACE,
      track: body.track, experienceBand: body.experienceBand, startingDifficulty: body.startingDifficulty,
      durationMinutes: body.durationMinutes, maxQuestions: MAX_QUESTIONS } })
    return { id: run.id, sessionId: session.id, reused: false }
  })
}

export async function prepareBankAttempt(runId: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    const run = await writableRun(tx, runId, ownerId)
    const open = await tx.interviewAttempt.findFirst({ where: { runId, status: { in: ['PREPARED', 'ASKED'] } } })
    if (open) return learnerAttempt(open)
    const session = await tx.session.findUniqueOrThrow({ where: { id: run.sessionId } })
    if (Date.now() >= session.startedAt.getTime() + run.durationMinutes * 60_000) {
      throw new BankError(409, 'Practice duration reached; finish the current answer or end the interview')
    }
    const count = await tx.interviewAttempt.count({ where: { runId } })
    if (count >= run.maxQuestions) throw new BankError(409, 'Question limit reached')
    const where: Prisma.QuestionBankQuestionWhereInput = { ...learnerEligibleWhere, namespace: run.namespace,
      track: run.track, experienceBand: run.experienceBand, difficulty: run.startingDifficulty,
      interviewAttempts: { none: { runId } } }
    const candidate = await tx.questionBankQuestion.findFirst({ where, orderBy: { externalQid: 'asc' } })
    if (!candidate) throw new BankError(409, 'No more eligible questions match this setup')
    await tx.$queryRaw`SELECT id FROM "QuestionBankQuestion" WHERE id=${candidate.id} FOR SHARE`
    const question = await tx.questionBankQuestion.findFirst({ where: { ...where, id: candidate.id } })
    if (!question) throw new BankError(409, 'Question eligibility changed; try again')
    const snapshot = questionSnapshotSchema.parse(Object.fromEntries(Object.keys(questionSnapshotSchema.shape).map(k => [k, question[k as keyof typeof question]])))
    if (JSON.stringify(snapshot).length > 60000 || snapshot.questionText.length > 8000) throw new BankError(409, 'Question guidance exceeds the pilot limit')
    const attempt = await tx.interviewAttempt.create({ data: { runId, index: count + 1, questionId: question.id,
      questionSnapshot: json(snapshot), questionHash: hash(snapshot) } })
    return learnerAttempt(attempt)
  })
}

// These producer methods must only be exposed behind internal-agent authentication
// when checkpoint 3.2 registers the voice adapter. No router is registered yet.
export async function markQuestionAsked(attemptId: string, input: unknown) {
  const body = askedSchema.parse(input)
  return prisma.$transaction(async tx => {
    const { attempt, run } = await agentAttempt(tx, attemptId)
    await activeSegment(tx, run.sessionId, body.segmentId)
    if (body.questionText !== questionSnapshotSchema.parse(attempt.questionSnapshot).questionText) {
      throw new BankError(409, 'Spoken question must match the saved question')
    }
    if (attempt.status === 'ASKED') return learnerAttempt(attempt)
    if (attempt.status !== 'PREPARED') throw new BankError(409, 'Question is already completed')
    return learnerAttempt(await tx.interviewAttempt.update({ where: { id: attemptId }, data: { status: 'ASKED', askedAt: new Date() } }))
  })
}
export async function captureCommittedTurn(attemptId: string, input: unknown) {
  const body = chunkSchema.parse(input)
  return prisma.$transaction(async tx => {
    const { attempt, run } = await agentAttempt(tx, attemptId)
    const previous = await tx.interviewAnswerChunk.findUnique({ where: { segmentId_sourceTurnId: { segmentId: body.segmentId, sourceTurnId: body.sourceTurnId } } })
    if (previous) {
      if (previous.attemptId !== attemptId || previous.localTurnIndex !== body.localTurnIndex || previous.text !== body.text) {
        throw new BankError(409, 'Committed turn ID already contains different speech')
      }
      return { id: previous.id, reused: true }
    }
    await activeSegment(tx, run.sessionId, body.segmentId)
    if (attempt.status !== 'ASKED') throw new BankError(409, 'Answer is not accepting speech')
    if (await tx.interviewAnswerChunk.findUnique({ where: { segmentId_localTurnIndex: { segmentId: body.segmentId, localTurnIndex: body.localTurnIndex } } })) {
      throw new BankError(409, 'Speech turn order is already occupied')
    }
    const chunks = await tx.interviewAnswerChunk.findMany({ where: { attemptId }, select: { text: true } })
    if (chunks.reduce((sum, c) => sum + c.text.length + 1, body.text.length) > MAX_ANSWER_LENGTH) {
      throw new BankError(413, 'Answer is too long; speech was not silently truncated')
    }
    const chunk = await tx.interviewAnswerChunk.create({ data: { attemptId, segmentId: body.segmentId,
      sourceTurnId: body.sourceTurnId, localTurnIndex: body.localTurnIndex, text: body.text } })
    return { id: chunk.id, reused: false }
  })
}
export async function recordAssistance(attemptId: string, input: unknown) {
  const body = assistanceSchema.parse(input)
  return prisma.$transaction(async tx => {
    const { attempt } = await agentAttempt(tx, attemptId)
    if (attempt.status !== 'ASKED') throw new BankError(409, 'Assistance can only be recorded during an answer')
    if (attempt.assistance === 'EXAMPLE' || attempt.assistance === body.assistance) return
    await tx.interviewAttempt.update({ where: { id: attemptId }, data: { assistance: body.assistance } })
  })
}
export async function finishAnswer(runId: string, attemptId: string, ownerId: string, skip = false) {
  return prisma.$transaction(async tx => {
    await writableRun(tx, runId, ownerId)
    const attempt = await tx.interviewAttempt.findFirst({ where: { id: attemptId, runId } })
    if (!attempt) throw new BankError(404, 'Attempt not found')
    if (attempt.status === 'ANSWERED' && !skip) {
      const saved = await tx.interviewAnswerSnapshot.findUniqueOrThrow({ where: { attemptId_textRevision: { attemptId, textRevision: 1 } } })
      return { id: saved.id, status: 'ANSWERED', answerText: saved.answerText, reused: true }
    }
    if (attempt.status === 'SKIPPED' && skip) return { id: null, status: 'SKIPPED', reused: true }
    if (attempt.status !== 'ASKED') throw new BankError(409, 'Question is not awaiting an answer')
    const chunks = await tx.interviewAnswerChunk.findMany({ where: { attemptId }, include: { segment: { select: { segmentIndex: true } } } })
    chunks.sort((a, b) => a.segment.segmentIndex - b.segment.segmentIndex || a.localTurnIndex - b.localTurnIndex)
    const answerText = chunks.map(c => c.text).join('\n')
    if (!skip && !answerText.trim()) throw new BankError(409, 'No committed answer yet; continue or explicitly skip')
    if (!skip && answerText.length > MAX_ANSWER_LENGTH) throw new BankError(413, 'Answer exceeds the capture limit')
    await tx.interviewAttempt.update({ where: { id: attemptId }, data: { status: skip ? 'SKIPPED' : 'ANSWERED', completedAt: new Date() } })
    if (skip) return { id: null, status: 'SKIPPED', reused: false }
    const saved = await tx.interviewAnswerSnapshot.create({ data: { ownerId, source: 'LIVE_ATTEMPT', attemptId,
      questionId: attempt.questionId, questionSnapshot: json(attempt.questionSnapshot), questionHash: attempt.questionHash,
      answerText, answerHash: hash(answerText), textSource: 'AGENT_COMMITTED_TURNS', textRevision: 1, assistance: attempt.assistance } })
    // Capture only. Source-aware learner quotas/worker enqueue are checkpoint 3.3.
    return { id: saved.id, status: 'ANSWERED', answerText, reused: false }
  })
}
export async function practiceDetail(runId: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    const run = await ownedRun(tx, runId, ownerId)
    const attempts = await tx.interviewAttempt.findMany({ where: { runId }, orderBy: { index: 'asc' },
      include: { answerSnapshots: { select: { answerText: true, textSource: true, textRevision: true, assistance: true } } } })
    return { id: run.id, sessionId: run.sessionId, track: run.track, experienceBand: run.experienceBand,
      attempts: attempts.map(a => ({ ...learnerAttempt(a), answer: a.answerSnapshots[0] ?? null })) }
  })
}

// Ending remains available when rollout access is withdrawn. Technical capture
// does not call communication analysis or award points.
export async function endPractice(runId: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    const run = await ownedRun(tx, runId, ownerId)
    const session = await tx.session.findUniqueOrThrow({ where: { id: run.sessionId } })
    if (session.endedAt) return { endedAt: session.endedAt, reused: true }
    const endedAt = new Date()
    await tx.session.update({ where: { id: session.id }, data: { endedAt, retainedAt: null,
      durationSec: Math.max(0, Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000)), progressPulseStatus: 'skipped' } })
    return { endedAt, reused: false }
  })
}
