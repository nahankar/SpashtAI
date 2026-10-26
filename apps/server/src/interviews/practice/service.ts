import { projectInterviewTranscript } from './projection'
import { requestDeliveryAlignment } from '../../lib/deliveryAlignmentWorker'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { lockWritableSession } from '../../lib/sessionDiscard'
import { activeSegmentDurationSec } from '../../analytics/sessionSegments'
import { BankError } from '../bank/csv'
import { learnerEligibleWhere } from '../bank/schemas'
import { hash, questionSnapshotSchema } from '../evaluator/contracts'
import { joinSelection, splitSelection, askedSchema, assistanceSchema, chunkSchema, MAX_ANSWER_LENGTH, MAX_QUESTIONS, PRACTICE_NAMESPACE, receiptSchema, startSchema, VOICE_CONSENT_VERSION,
  CONVERSATION_POLICY, conversationPolicySchema, agentFinishSchema, agentNextSchema } from './contracts'
import { conversationAccess, currentInterviewVoiceProfile, practiceExecutionAccess, voiceProfileSchema } from './access'
import { learnerPolicy, enqueueLearnerAssessment, learnerEvaluationAccess } from '../evaluator/learner'

type Tx = Prisma.TransactionClient
const json = (value: unknown) => value as Prisma.InputJsonValue

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
  await practiceExecutionAccess(ownerId, tx)
  const session = await tx.session.findUniqueOrThrow({ where: { id: run.sessionId } })
  if (session.endedAt) throw new BankError(409, 'Interview has ended')
  if (!run.recordingConsentAt || run.recordingConsentVersion !== VOICE_CONSENT_VERSION) throw new BankError(409, 'Recording consent is required')
  return run
}
async function agentAttempt(tx: Tx, attemptId: string) {
  const attempt = await tx.interviewAttempt.findUnique({ where: { id: attemptId }, include: { run: true } })
  if (!attempt) throw new BankError(404, 'Attempt not found')
  const run = await writableRun(tx, attempt.runId, attempt.run.ownerId)
  // Reload after the lock; another callback may have committed the answer.
  return { run, attempt: await tx.interviewAttempt.findUniqueOrThrow({ where: { id: attemptId } }) }
}
async function activeSegment(tx: Tx, sessionId: string, segmentId: string, drainingAttemptId?: string) {
  const segment = await tx.sessionSegment.findFirst({ where: { id: segmentId, sessionId } })
  if (!segment || segment.interviewDrainedAt || (segment.endedAt && (!drainingAttemptId || segment.interviewDrainAttemptId !== drainingAttemptId
    || !segment.interviewDrainUntil || segment.interviewDrainUntil.getTime() <= Date.now()))) {
    throw new BankError(409, 'The speech segment is no longer accepting this answer')
  }
}
function learnerAttempt(row: { id: string; index: number; status: string; assistance: string; askedAt: Date | null; questionSnapshot: Prisma.JsonValue }) {
  const q = questionSnapshotSchema.parse(row.questionSnapshot)
  return { id: row.id, index: row.index, status: row.status, assistance: row.assistance, askedAt: row.askedAt,
    // expectedDepth and answer guidance are authoring/evaluator material and stay in the snapshot only.
    question: { text: q.questionText, track: q.track, topic: q.topic, difficulty: q.difficulty } }
}

export async function startPractice(input: unknown, ownerId: string) {
  const body = startSchema.parse(input)
  return prisma.$transaction(async tx => {
    await practiceExecutionAccess(ownerId, tx)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`interview-start:${ownerId}`},0))`
    const existing = await tx.session.findUnique({ where: { id: body.sessionId }, include: { interviewRun: true } })
    if (existing) {
      if (existing.userId !== ownerId) throw new BankError(404, 'Interview not found')
      await lockWritableSession(tx, existing.id)
      const run = existing.interviewRun
      if (!run || existing.endedAt || run.track !== joinSelection(body.track) || run.experienceBand !== joinSelection(body.experienceBand)
        || run.startingDifficulty !== joinSelection(body.startingDifficulty) || run.durationMinutes !== body.durationMinutes) {
        throw new BankError(409, 'Session ID already belongs to another setup or completed interview')
      }
      return { id: run.id, sessionId: run.sessionId, reused: true }
    }
    const unfinished = await tx.interviewRun.findFirst({ where: { ownerId, session: { endedAt: null, discardedAt: null } } })
    if (unfinished) throw new BankError(409, 'Resume or end your current interview first')
    const eligible = await tx.questionBankQuestion.count({ where: { ...learnerEligibleWhere, namespace: PRACTICE_NAMESPACE,
      track: { in: body.track }, experienceBand: { in: body.experienceBand }, difficulty: { in: body.startingDifficulty } } })
    if (!eligible) throw new BankError(409, 'No eligible questions match this track, experience and difficulty yet')
    const voice = await currentInterviewVoiceProfile(tx)
    const session = await tx.session.create({ data: { id: body.sessionId, userId: ownerId, module: 'elevate',
      purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY', sessionName: `${body.track.join(', ')} interview practice`,
      configurationSnapshot: { capturePolicy: 'committed-turns-1', answerCompletion: 'explicit', technicalFeedback: 'pending' } } })
    const evaluationPolicy = await learnerPolicy(ownerId, tx)
    const conversation = await conversationAccess(ownerId, tx)
    const run = await tx.interviewRun.create({ data: { sessionId: session.id, ownerId, namespace: PRACTICE_NAMESPACE,
      track: joinSelection(body.track), experienceBand: joinSelection(body.experienceBand), startingDifficulty: joinSelection(body.startingDifficulty),
      durationMinutes: body.durationMinutes, maxQuestions: MAX_QUESTIONS,
      recordingConsentAt: new Date(), recordingConsentVersion: VOICE_CONSENT_VERSION, voiceConfigSnapshot: json(voice),
      evaluationPolicySnapshot: evaluationPolicy ? json(evaluationPolicy) : undefined,
      conversationPolicySnapshot: conversation ? json(CONVERSATION_POLICY) : undefined } })
    return { id: run.id, sessionId: session.id, reused: false }
  })
}

export async function prepareBankAttempt(runId: string, ownerId: string, afterAttemptId?: string) {
  return prisma.$transaction(async tx => {
    const run = await writableRun(tx, runId, ownerId)
    if (afterAttemptId !== undefined) {
      // A repeated or late advance gets the question that already follows, never another one.
      const latest = await tx.interviewAttempt.findFirst({ where: { runId }, orderBy: { index: 'desc' } })
      if (!latest || latest.id !== afterAttemptId) {
        const after = await tx.interviewAttempt.findFirst({ where: { id: afterAttemptId, runId } })
        if (after && latest && latest.index === after.index + 1 && ['PREPARED', 'ASKED'].includes(latest.status)) return learnerAttempt(latest)
        throw new BankError(409, 'This practice has already moved on from that question', 'STALE_ADVANCE')
      }
      if (['PREPARED', 'ASKED'].includes(latest.status)) throw new BankError(409, 'Finish or skip the current question first', 'ANSWER_OPEN')
    }
    const open = await tx.interviewAttempt.findFirst({ where: { runId, status: { in: ['PREPARED', 'ASKED'] } } })
    if (open) return learnerAttempt(open)
    const segments = await tx.sessionSegment.findMany({ where: { sessionId: run.sessionId }, select: { startedAt: true, endedAt: true, activeDurationSec: true } })
    const activeSeconds = segments.reduce((sum, s) => sum + (s.activeDurationSec ?? Math.max(0, ((s.endedAt?.getTime() ?? Date.now())-s.startedAt.getTime())/1000)), 0)
    if (activeSeconds >= run.durationMinutes * 60) {
      throw new BankError(409, 'Practice duration reached. Your saved answers are ready for review.', 'PRACTICE_DURATION_REACHED')
    }
    const count = await tx.interviewAttempt.count({ where: { runId } })
    if (count >= run.maxQuestions) throw new BankError(409, 'You have completed the questions for this practice.', 'PRACTICE_QUESTION_LIMIT')
    const where: Prisma.QuestionBankQuestionWhereInput = { ...learnerEligibleWhere, namespace: run.namespace,
      track: { in: splitSelection(run.track) }, experienceBand: { in: splitSelection(run.experienceBand) },
      difficulty: { in: splitSelection(run.startingDifficulty) }, interviewAttempts: { none: { runId } } }
    const candidates = await tx.questionBankQuestion.findMany({ where, take: 2000 })
    const exposure = await tx.interviewAttempt.findMany({ where: { run: { ownerId }, runId: { not: runId },
      askedAt: { gte: new Date(Date.now() - 14 * 86400000) }, questionId: { not: null } }, select: { questionId: true, askedAt: true } })
    const seen = new Map<string, number>()
    for (const e of exposure) if (e.questionId && e.askedAt) seen.set(e.questionId, Math.max(seen.get(e.questionId) ?? 0, e.askedAt.getTime()))
    candidates.sort((a, b) => (seen.get(a.id) ?? 0) - (seen.get(b.id) ?? 0) || hash([run.id,a.id]).localeCompare(hash([run.id,b.id])))
    const candidate = candidates[0]
    if (!candidate) throw new BankError(409, 'You have answered all available questions for this track, experience and difficulty. End practice to review your answers, or start another practice with a different setup.', 'QUESTION_BANK_EXHAUSTED')
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
    await activeSegment(tx, run.sessionId, body.segmentId, attemptId)
    if (attempt.status !== 'ASKED') throw new BankError(409, 'Answer is not accepting speech')
    if (await tx.interviewCaptureReceipt.findFirst({ where: { attemptId, segmentId: body.segmentId, action: { in: ['FINISH','SKIP'] } } })) {
      throw new BankError(409, 'This answer has already been drained for completion')
    }
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
export async function finishAnswer(runId: string, attemptId: string, ownerId: string, skip = false, receiptId?: string) {
  return prisma.$transaction(async tx => {
    const run = await writableRun(tx, runId, ownerId)
    const attempt = await tx.interviewAttempt.findFirst({ where: { id: attemptId, runId } })
    if (!attempt) throw new BankError(404, 'Attempt not found')
    const receipt = receiptId && await tx.interviewCaptureReceipt.findFirst({ where: { id: receiptId, attemptId, action: skip ? 'SKIP' : 'FINISH' } })
    if (!receipt) throw new BankError(409, 'Wait for the interviewer to confirm that your speech has been saved')
    if (!skip) {
      // A segment closed while this answer was open may still hold unsaved speech, unless a FINISH receipt
      // for this attempt already covers it (chunks after that receipt are refused).
      const bound = await tx.sessionSegment.findMany({ where: { sessionId: run.sessionId, interviewDrainAttemptId: attemptId, interviewDrainedAt: null }, select: { id: true } })
      const covered = bound.length ? await tx.interviewCaptureReceipt.findMany({ where: { attemptId, action: 'FINISH', segmentId: { in: bound.map(b => b.id) } }, select: { segmentId: true } }) : []
      if (bound.some(b => !covered.some(c => c.segmentId === b.id))) throw new BankError(409, 'A previous connection has not finished saving this answer. Retry or end it as incomplete.')
    }
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
    await enqueueLearnerAssessment(tx, saved.id, run.evaluationPolicySnapshot)
    return { id: saved.id, status: 'ANSWERED', answerText, reused: false }
  })
}
export async function practiceDetail(runId: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    const run = await ownedRun(tx, runId, ownerId)
    const attempts = await tx.interviewAttempt.findMany({ where: { runId }, orderBy: { index: 'asc' },
      include: { answerSnapshots: { select: { answerText: true, textSource: true, textRevision: true, assistance: true } },
        chunks: { include: { segment: { select: { segmentIndex: true } } } } } })
    const session = await tx.session.findUniqueOrThrow({ where: { id: run.sessionId }, select: { endedAt: true, startedAt: true, retainedAt: true } })
    return { id: run.id, sessionId: run.sessionId, track: run.track, experienceBand: run.experienceBand,
      startingDifficulty: run.startingDifficulty, durationMinutes: run.durationMinutes, ...session,
      recordingConsentAt: run.recordingConsentAt, recordingConsentVersion: run.recordingConsentVersion,
      // Conversation only while the run pinned it and the owner still has access, matching the agent's voiceState.
      evaluationEnabled: run.evaluationPolicySnapshot !== null,
      conversationMode: run.conversationPolicySnapshot !== null && await conversationAccess(ownerId, tx),
      attempts: attempts.map(a => ({ ...learnerAttempt(a), completionReason: a.completionReason,
        capturedText: a.chunks.sort((x,y) => x.segment.segmentIndex-y.segment.segmentIndex || x.localTurnIndex-y.localTurnIndex).map(c => c.text).join('\n'),
        capturedParts: a.chunks.map(c => ({ segmentId: c.segmentId, sourceTurnId: c.sourceTurnId, text: c.text, createdAt: c.createdAt })),
        answer: a.answerSnapshots[0] ?? null })) }
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
    const segments = await tx.sessionSegment.findMany({ where: { sessionId: session.id } })
    for (const segment of segments.filter(s => !s.endedAt)) await tx.sessionSegment.update({ where: { id: segment.id },
      data: { endedAt, activeDurationSec: activeSegmentDurationSec(segment.startedAt, endedAt) } })
    await projectInterviewTranscript(tx, runId, session.id)
    await tx.interviewAttempt.updateMany({ where: { runId, status: { in: ['PREPARED','ASKED'] } },
      data: { status: 'INCOMPLETE', completedAt: endedAt, completionReason: 'USER_ENDED' } })
    await tx.session.update({ where: { id: session.id }, data: { endedAt, retainedAt: null,
      durationSec: segments.reduce((sum,s) => sum+(s.activeDurationSec ?? activeSegmentDurationSec(s.startedAt, s.endedAt ?? endedAt)),0), progressPulseStatus: 'skipped' } })
    await requestDeliveryAlignment(tx, session.id)
    return { endedAt, reused: false }
  })
}

export async function practiceOptions(ownerId: string) {
  return prisma.$transaction(async tx => {
    await practiceExecutionAccess(ownerId, tx)
    await currentInterviewVoiceProfile(tx)
    const coverage = await tx.questionBankQuestion.groupBy({ by: ['track','experienceBand','difficulty'],
      where: { ...learnerEligibleWhere, namespace: PRACTICE_NAMESPACE }, _count: { _all: true } })
    return { coverage: coverage.map(c => ({ track: c.track, experienceBand: c.experienceBand, difficulty: c.difficulty, count: c._count._all })),
      consentVersion: VOICE_CONSENT_VERSION, maxQuestions: MAX_QUESTIONS, evaluationAvailable: await learnerEvaluationAccess(ownerId, tx),
      conversationAvailable: await conversationAccess(ownerId, tx) }
  })
}
export async function practiceHistory(ownerId: string) {
  const rows = await prisma.interviewRun.findMany({ where: { ownerId, session: { discardedAt: null } }, orderBy: { createdAt: 'desc' }, take: 50,
    select: { id: true, sessionId: true, track: true, experienceBand: true, startingDifficulty: true, createdAt: true,
      session: { select: { endedAt: true, retainedAt: true } }, _count: { select: { attempts: true } } } })
  // Outcome counts for the history list, from the same owner-scoped runs (one grouped query).
  const counts = rows.length ? await prisma.interviewAttempt.groupBy({ by: ['runId', 'status'], where: { runId: { in: rows.map(r => r.id) } }, _count: { _all: true } }) : []
  const count = (runId: string, status: string) => counts.find(c => c.runId === runId && c.status === status)?._count._all ?? 0
  return { runs: rows.map(r => ({ id: r.id, sessionId: r.sessionId, track: r.track, experienceBand: r.experienceBand,
    startingDifficulty: r.startingDifficulty, startedAt: r.createdAt, ...r.session, questionCount: r._count.attempts,
    answeredCount: count(r.id, 'ANSWERED'), skippedCount: count(r.id, 'SKIPPED'), incompleteCount: count(r.id, 'INCOMPLETE') })) }
}
export async function voiceState(sessionId: string, segmentId: string, room: string, identity: string) {
  return prisma.$transaction(async tx => {
    const row = await tx.interviewRun.findUnique({ where: { sessionId } })
    if (!row || identity !== `user_${row.ownerId}`) throw new BankError(404, 'Interview not found')
    const run = await writableRun(tx, row.id, row.ownerId)
    await activeSegment(tx, sessionId, segmentId)
    const segment = await tx.sessionSegment.findUniqueOrThrow({ where: { id: segmentId } })
    if (segment.roomName !== room) throw new BankError(409, 'Room does not own this speech segment')
    if (!run.recordingConsentAt || run.recordingConsentVersion !== VOICE_CONSENT_VERSION) throw new BankError(409, 'Recording consent is required for this interview')
    const attempt = await tx.interviewAttempt.findFirst({ where: { runId: run.id }, orderBy: { index: 'desc' } })
    if (!attempt) throw new BankError(409, 'Prepare the first question before joining')
    const max = await tx.interviewAnswerChunk.aggregate({ where: { segmentId }, _max: { localTurnIndex: true } })
    const segments = await tx.sessionSegment.findMany({ where: { sessionId }, select: { startedAt: true, endedAt: true, activeDurationSec: true } })
    const activeSeconds=segments.reduce((sum,s) => sum+(s.activeDurationSec ?? Math.max(0,((s.endedAt?.getTime() ?? Date.now())-s.startedAt.getTime())/1000)),0)
    // Conversation stays on only while the run pinned it and the owner still has access; otherwise manual.
    const policy = conversationPolicySchema.safeParse(run.conversationPolicySnapshot)
    const open = attempt.status === 'ASKED'
    return { runId: run.id, sessionId, segmentId, identity, attempt: learnerAttempt(attempt),
      nextTurnIndex: (max._max.localTurnIndex ?? -1) + 1, secondsRemaining: Math.max(0,run.durationMinutes*60-activeSeconds),
      voiceProfile: voiceProfileSchema.parse(run.voiceConfigSnapshot),
      conversation: { enabled: policy.success && await conversationAccess(run.ownerId, tx), policy: policy.success ? policy.data : null },
      // Speech saved for this answer in earlier segments, and a completion receipt the server has not applied yet.
      attemptHasSpeech: open && (await tx.interviewAnswerChunk.count({ where: { attemptId: attempt.id } })) > 0,
      unfinishedReceipt: open ? await unfinishedReceipt(tx, attempt.id) : null }
  })
}
/** The newest completion receipt of an open attempt, unless speech saved after it shows the learner went on answering. */
async function unfinishedReceipt(tx: Prisma.TransactionClient, attemptId: string) {
  const receipt = await tx.interviewCaptureReceipt.findFirst({ where: { attemptId, action: { in: ['FINISH', 'SKIP'] } },
    orderBy: { createdAt: 'desc' }, select: { id: true, action: true, segmentId: true, createdAt: true } })
  if (!receipt) return null
  const later = await tx.interviewAnswerChunk.count({ where: { attemptId, createdAt: { gt: receipt.createdAt } } })
  return later ? null : { id: receipt.id, action: receipt.action, segmentId: receipt.segmentId }
}
/** The run an internal coordinator call acts for: the owner's, and only while conversation is enabled for it. */
async function conversationRun(where: { attemptId: string } | { runId: string }) {
  const run = 'runId' in where ? await prisma.interviewRun.findUnique({ where: { id: where.runId } })
    : (await prisma.interviewAttempt.findUnique({ where: { id: where.attemptId }, include: { run: true } }))?.run
  if (!run) throw new BankError(404, 'Interview not found')
  if (!conversationPolicySchema.safeParse(run.conversationPolicySnapshot).success || !await conversationAccess(run.ownerId)) {
    throw new BankError(403, 'Automatic conversation is not enabled for this practice', 'CONVERSATION_UNAVAILABLE')
  }
  return run
}
export async function agentFinishAnswer(attemptId: string, input: unknown) {
  const body = agentFinishSchema.parse(input)
  const run = await conversationRun({ attemptId })
  return { ...await finishAnswer(run.id, attemptId, run.ownerId, body.skip, body.receiptId), ownerId: run.ownerId, sessionId: run.sessionId }
}
export async function agentPrepareNext(runId: string, input: unknown) {
  const body = agentNextSchema.parse(input)
  const run = await conversationRun({ runId })
  return prepareBankAttempt(run.id, run.ownerId, body.afterAttemptId)
}
export async function saveCaptureReceipt(attemptId: string, input: unknown) {
  const body = receiptSchema.parse(input)
  return prisma.$transaction(async tx => {
    const { run, attempt } = await agentAttempt(tx, attemptId)
    const existing = await tx.interviewCaptureReceipt.findUnique({ where: { id: body.id } })
    if (existing) {
      if (existing.attemptId !== attemptId || existing.segmentId !== body.segmentId || existing.action !== body.action || existing.lastTurnIndex !== body.lastTurnIndex) {
        throw new BankError(409, 'Capture receipt ID already belongs to another action')
      }
      return { id: existing.id, reused: true }
    }
    await activeSegment(tx, run.sessionId, body.segmentId, attemptId)
    if (['FINISH','SKIP'].includes(body.action) && attempt.status !== 'ASKED') throw new BankError(409, 'Question is not awaiting an answer')
    const max = await tx.interviewAnswerChunk.aggregate({ where: { segmentId: body.segmentId }, _max: { localTurnIndex: true } })
    if ((max._max.localTurnIndex ?? -1) !== body.lastTurnIndex) throw new BankError(409, 'Committed speech is still being saved')
    await tx.interviewCaptureReceipt.create({ data: { ...body, attemptId } })
    return { id: body.id, reused: false }
  })
}
export async function ownedCaptureReceipt(runId: string, receiptId: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    await ownedRun(tx, runId, ownerId)
    const receipt = await tx.interviewCaptureReceipt.findFirst({ where: { id: receiptId, attempt: { runId } },
      select: { id: true, action: true, segmentId: true, attemptId: true } })
    if (!receipt) throw new BankError(404, 'Speech-save confirmation not found')
    return receipt
  })
}
