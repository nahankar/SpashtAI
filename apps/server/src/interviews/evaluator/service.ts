import { randomUUID } from 'crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import { BankError } from '../bank/csv'
import { ACTIONS, CONFIGS, LIMITS, configFor, explicitDontKnow, hash, questionSnapshotSchema, submitSchema, type EvaluationResult, type QuestionSnapshot } from './contracts'
import { evaluateAnswer, EvaluationFailure, type Invocation } from './model'
type Tx = Prisma.TransactionClient
const FEATURE = 'interview_evaluator'
const json = (value: unknown) => value as Prisma.InputJsonValue
const day = () => new Date().toISOString().slice(0, 10)

export async function evaluatorAccess(userId: string, db: Tx = prisma) {
  const [user, flag, grant] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { role: true } }),
    db.platformFeatureFlag.findUnique({ where: { feature: FEATURE } }),
    db.userFeatureGrant.findUnique({ where: { userId_feature: { userId, feature: FEATURE } } }),
  ])
  return Boolean(user && ['ADMIN','SUPER_ADMIN'].includes(user.role) && flag && !flag.hidden && !flag.disabled
    && (flag.audience !== 'SELECTED_USERS' || grant))
}
async function assertAccess(userId: string, tx: Tx) {
  if (!await evaluatorAccess(userId, tx)) throw new BankError(403, 'Interview evaluator pilot access is required. Enable it and grant access in Feature Flags.')
}
async function consumeBudget(userId: string, tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('interview-evaluator-budget',0))`
  for (const [scope, limit] of [['global', LIMITS.dailyGlobal], [hash(userId), LIMITS.dailyPerAdmin]] as const) {
    const key = { scope, day: day() }
    const budget = await tx.interviewEvaluatorBudget.upsert({ where: { scope_day: key }, create: key, update: {} })
    if (budget.used >= limit) throw new BankError(429, 'Daily evaluator pilot limit reached. Try again tomorrow (UTC).')
  }
  await tx.interviewEvaluatorBudget.updateMany({ where: { day: day(), scope: { in: ['global', hash(userId)] } }, data: { used: { increment: 1 } } })
}
export async function enqueueAssessment(input: unknown, ownerId: string) {
  const body = submitSchema.parse(input); const config = configFor(body.model)
  return prisma.$transaction(async tx => {
    await assertAccess(ownerId, tx)
    // Serialize capture with edits/deletion so the supplied revision identifies exactly this text.
    await tx.$queryRaw`SELECT id FROM "QuestionBankQuestion" WHERE id=${body.questionId} FOR SHARE`
    const question = await tx.questionBankQuestion.findUnique({ where: { id: body.questionId } })
    if (!question) throw new BankError(404, 'Question not found')
    if (question.revision !== body.revision) throw new BankError(409, 'Question changed. Reload before testing.')
    if (!question.goodAnswerPoints.trim() && !question.exampleAnswer.trim()) throw new BankError(400, 'Add answer guidance before testing this question')
    const snapshot = questionSnapshotSchema.parse(Object.fromEntries(Object.keys(questionSnapshotSchema.shape).map(k => [k, question[k as keyof typeof question]])))
    if (JSON.stringify(snapshot).length > 60000) throw new BankError(400, 'Question guidance is too long for the pilot evaluator. Shorten it before testing.')
    const questionHash = hash(snapshot); const answerHash = hash(body.answer)
    const inputKey = hash({ ownerId, source: body.source, questionHash, answerHash, config, assistance: body.assistance, language: body.language, textSource: 'ADMIN_TYPED', textRevision: 1 })
    // Global quota lock also serializes same-key concurrent submissions.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('interview-evaluator-budget',0))`
    const existing = await tx.interviewAssessment.findUnique({ where: { inputKey } })
    if (existing) return { id: existing.id, reused: true }
    await consumeBudget(ownerId, tx)
    const saved = await tx.interviewAnswerSnapshot.create({ data: {
      ownerId, questionId: question.id, questionSnapshot: json(snapshot), questionHash, answerText: body.answer, answerHash,
      assistance: body.assistance, language: body.language,
      assessment: { create: { inputKey, config: json(config) } },
    }, include: { assessment: true } })
    return { id: saved.assessment!.id, reused: false }
  })
}
async function ownedAssessment(id: string, actorId: string, tx: Tx = prisma) {
  const role = await tx.user.findUnique({ where: { id: actorId }, select: { role: true } })
  if (!role || !['ADMIN','SUPER_ADMIN'].includes(role.role)) throw new BankError(403, 'Current Admin access required')
  const row = await tx.interviewAssessment.findFirst({ where: { id, ...(role.role === 'SUPER_ADMIN' ? {} : { snapshot: { ownerId: actorId } }) }, include: { snapshot: true, usage: { orderBy: { createdAt: 'asc' } } } })
  if (!row) throw new BankError(404, 'Test not found')
  return row
}
export async function assessmentDetail(id: string, actorId: string) {
  const row = await ownedAssessment(id, actorId)
  const current = row.snapshot.questionId ? await prisma.questionBankQuestion.findUnique({ where: { id: row.snapshot.questionId }, select: { revision: true } }) : null
  const question = questionSnapshotSchema.parse(row.snapshot.questionSnapshot)
  return { ...row, bankChanged: !current || current.revision !== question.revision, afterExample: row.snapshot.assistance === 'EXAMPLE' }
}
export async function deleteAssessment(id: string, actorId: string) {
  await prisma.$transaction(async tx => {
    const row = await ownedAssessment(id, actorId, tx)
    await tx.interviewAnswerSnapshot.delete({ where: { id: row.snapshotId } })
  })
}
export async function retryAssessment(id: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await assertAccess(actorId, tx)
    await tx.$queryRaw`SELECT id FROM "InterviewAssessment" WHERE id=${id} FOR UPDATE`
    const row = await ownedAssessment(id, actorId, tx)
    // A Super Admin can inspect/delete another owner's test, but cannot bill retries to them.
    if (row.snapshot.ownerId !== actorId) throw new BankError(403, 'Only the submitting admin can retry this test')
    if (!Object.keys(CONFIGS).some(key => hash(configFor(key as keyof typeof CONFIGS)) === hash(row.config))) throw new BankError(409, 'Evaluator configuration changed. Submit a new test using the current configuration.')
    if (!['FAILED','CANCELLED'].includes(row.status) || row.attempts >= LIMITS.attempts) throw new BankError(409, 'This test cannot be retried. At most three invocations are allowed.')
    await consumeBudget(actorId, tx)
    return tx.interviewAssessment.update({ where: { id }, data: { status: 'PENDING', nextAt: new Date(), errorCode: null, completedAt: null } })
  })
}
export async function adaptiveDecision(question: QuestionSnapshot, result: EvaluationResult, tx: Tx = prisma) {
  const action = ACTIONS[result.classification]
  if (action !== 'SWITCH_TOPIC') return { action, source: 'GENERATED', questionId: null, topic: question.topic, questionText: result.followUpQuestion, needsReview: true }
  // Case-insensitive topic comparison prevents spelling/case duplicates from masquerading as a switch.
  const next = await tx.questionBankQuestion.findFirst({ where: {
    namespace: question.namespace, track: question.track, approved: true, active: true, verbalSuitable: true,
    NOT: [{ topic: { equals: question.topic, mode: 'insensitive' } }, { topic: { equals: 'General', mode: 'insensitive' } }, { id: question.id }],
    difficulty: { in: ['Simple','Medium'] },
  }, orderBy: [{ difficulty: 'desc' }, { externalQid: 'asc' }], select: { id: true, questionText: true, topic: true } })
  return { action, source: next ? 'BANK' : 'NONE_AVAILABLE', questionId: next?.id ?? null, topic: next?.topic ?? null,
    questionText: next?.questionText ?? null, needsReview: false }
}
export async function claimAssessment() {
  return prisma.$transaction(async tx => {
    const flag = await tx.platformFeatureFlag.findUnique({ where: { feature: FEATURE } })
    if (!flag || flag.hidden || flag.disabled) return null
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('interview-evaluator-claim',0))`
    await tx.interviewAssessment.updateMany({ where: { status: 'RUNNING', leaseUntil: { lt: new Date() } }, data: { status: 'FAILED', errorCode: 'LEASE_EXPIRED', leaseToken: null, leaseUntil: null } })
    if (await tx.interviewAssessment.count({ where: { status: 'RUNNING' } }) >= LIMITS.concurrent) return null
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "InterviewAssessment" WHERE status='PENDING' AND "nextAt" <= NOW() ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`
    if (!rows.length) return null
    const row = await tx.interviewAssessment.findUniqueOrThrow({ where: { id: rows[0].id }, include: { snapshot: true } })
    if (row.attempts >= LIMITS.attempts || !await evaluatorAccess(row.snapshot.ownerId, tx)) {
      await tx.interviewAssessment.update({ where: { id: row.id }, data: { status: 'CANCELLED', errorCode: 'PILOT_ACCESS_UNAVAILABLE' } })
      return null
    }
    const leaseToken = randomUUID()
    await tx.interviewAssessment.update({ where: { id: row.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, leaseToken, leaseUntil: new Date(Date.now() + LIMITS.leaseMs) } })
    return { ...row, leaseToken, attempts: row.attempts + 1 }
  })
}
type Claim = NonNullable<Awaited<ReturnType<typeof claimAssessment>>>
export async function finishAssessment(job: Claim, invocation: Invocation | EvaluationFailure) {
  const failure = invocation instanceof EvaluationFailure
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "InterviewAssessment" WHERE id=${job.id} FOR UPDATE`
    const current = await tx.interviewAssessment.findUnique({ where: { id: job.id }, include: { snapshot: true } })
    const usage = failure ? invocation.usage : invocation
    await tx.interviewEvaluatorUsage.upsert({ where: { invocationKey: job.leaseToken }, update: {}, create: {
      invocationKey: job.leaseToken, assessmentId: current?.id ?? null,
      modelId: (job.config as ReturnType<typeof configFor>).modelId, region: (job.config as ReturnType<typeof configFor>).region,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs: usage.latencyMs, outcome: failure ? invocation.code : 'SUCCESS',
    } })
    if (!current || current.status !== 'RUNNING' || current.leaseToken !== job.leaseToken) return
    const release = { leaseToken: null, leaseUntil: null }
    if (!await evaluatorAccess(current.snapshot.ownerId, tx)) {
      await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: 'CANCELLED', errorCode: 'PILOT_ACCESS_UNAVAILABLE' } }); return
    }
    if (failure) {
      let retry = invocation.retryable && current.attempts < LIMITS.attempts
      if (retry) { try { await consumeBudget(current.snapshot.ownerId, tx) } catch (error) { if (error instanceof BankError && error.status === 429) retry = false; else throw error } }
      await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: retry ? 'PENDING' : 'FAILED', errorCode: invocation.code,
        nextAt: new Date(Date.now() + 5000 * 2 ** current.attempts) } })
      return
    }
    const question = questionSnapshotSchema.parse(current.snapshot.questionSnapshot)
    let result = invocation.result
    // Exact explicit abstentions cannot acquire an invented grade or generated same-topic follow-up.
    if (explicitDontKnow(current.snapshot.answerText)) result = { ...result, classification: 'NOT_ANSWERED', strengths: [], misconceptions: [],
      criteria: result.criteria.map(c => ({ ...c, finding: 'NOT_ASSESSED', evidence: [], explanation: 'No subject understanding was demonstrated in this answer.' })) }
    const next = await adaptiveDecision(question, result, tx)
    await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: 'COMPLETED', errorCode: null, completedAt: new Date(),
      result: json({ ...result, next, assistance: current.snapshot.assistance, afterExample: current.snapshot.assistance === 'EXAMPLE', calibrated: false }) } })
  })
}
export async function sweepAssessments() {
  await prisma.interviewEvaluatorBudget.deleteMany({ where: { day: { lt: new Date(Date.now() - 7 * 86400000).toISOString().slice(0,10) } } })
  const job = await claimAssessment(); if (!job) return false
  let invocation: Invocation | EvaluationFailure
  try { invocation = await evaluateAnswer(questionSnapshotSchema.parse(job.snapshot.questionSnapshot), job.snapshot.answerText, job.config as ReturnType<typeof configFor>, job.snapshot.assistance) }
  catch (error) { invocation = error instanceof EvaluationFailure ? error : new EvaluationFailure('EVALUATION_FAILED', false, { inputTokens: null, outputTokens: null, latencyMs: 0 }) }
  await finishAssessment(job, invocation)
  return true
}
let timer: NodeJS.Timeout | null = null; let running = false
export function startInterviewEvaluatorWorker() {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    void sweepAssessments().catch(error => logger.error({ event: 'interview_evaluator.worker_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Interview evaluator processing failed'))
      .finally(() => { running = false })
  }, 2000)
  timer.unref?.()
}
export async function evaluatorConfig(actorId: string) {
  const usage = await prisma.interviewEvaluatorUsage.aggregate({ where: { assessment: { snapshot: { ownerId: actorId } } }, _sum: { inputTokens: true, outputTokens: true, latencyMs: true }, _count: true })
  const budget = await prisma.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: hash(actorId), day: day() } } })
  const unreportedUsage = await prisma.interviewEvaluatorUsage.count({ where: { assessment: { snapshot: { ownerId: actorId } }, OR: [{ inputTokens: null }, { outputTokens: null }] } })
  return { accessible: await evaluatorAccess(actorId), models: Object.entries(CONFIGS).map(([key, value]) => ({ key, ...value })), versions: configFor('nova2_lite'),
    limits: LIMITS, usedToday: budget?.used ?? 0, usage, unreportedUsage, calibrated: false, costUsd: null }
}
