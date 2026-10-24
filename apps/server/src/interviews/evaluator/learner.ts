import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import { lockWritableSession } from '../../lib/sessionDiscard'
import { BankError } from '../bank/csv'
import { CURRENT_LEARNER_POLICY, LEARNER_POLICIES, abstentionResult, explicitAbstention, hash, explicitDontKnow, questionSnapshotSchema, resultSchema } from './contracts'
import { evaluateAnswer, EvaluationFailure, type Invocation } from './model'

type Tx = Prisma.TransactionClient
const json = (v: unknown) => v as Prisma.InputJsonValue
const today = () => new Date().toISOString().slice(0, 10)
export const LEARNER_LIMITS = { perUser: 30, global: 300, concurrent: 2, attempts: 2, leaseMs: 60_000 }
const persistedResult = resultSchema.extend({ validationNotes: z.array(z.string().max(2000)).max(6).optional() })
const scopes = (ownerId: string) => ['learner-global', `learner-${hash(ownerId)}`]

export async function learnerEvaluationAccess(ownerId: string, tx: Tx = prisma) {
  for (const feature of ['interviews', 'interview_voice', 'interview_adaptive']) {
    await tx.$queryRaw`SELECT feature FROM "PlatformFeatureFlag" WHERE feature=${feature} FOR SHARE`
    const flag = await tx.platformFeatureFlag.findUnique({ where: { feature } })
    if (!flag || flag.hidden || flag.disabled) return false
    if (flag.audience === 'SELECTED_USERS') {
      await tx.$queryRaw`SELECT id FROM "UserFeatureGrant" WHERE "userId"=${ownerId} AND feature=${feature} FOR SHARE`
      if (!await tx.userFeatureGrant.findUnique({ where: { userId_feature: { userId: ownerId, feature } } })) return false
    }
  }
  return true
}
export async function learnerPolicy(ownerId: string, tx: Tx) {
  return await learnerEvaluationAccess(ownerId, tx) ? { version: CURRENT_LEARNER_POLICY, config: LEARNER_POLICIES[CURRENT_LEARNER_POLICY].config } : null
}
/** The registered policy a run pinned, or null when it is unknown to this code or was altered. */
function pinnedPolicy(policy: Prisma.JsonValue | null) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) || typeof policy.version !== 'string'
    || !policy.config || typeof policy.config !== 'object') return null
  const entry = Object.hasOwn(LEARNER_POLICIES, policy.version) ? LEARNER_POLICIES[policy.version] : null
  return entry && hash(policy.config) === hash(entry.config) ? entry : null
}
async function budget(ownerId: string, tx: Tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('interview-learner-budget',0))`
  const keys = scopes(ownerId)
  for (const [i, scope] of keys.entries()) {
    const row = await tx.interviewEvaluatorBudget.upsert({ where: { scope_day: { scope, day: today() } }, create: { scope, day: today() }, update: {} })
    if (row.used >= (i === 0 ? LEARNER_LIMITS.global : LEARNER_LIMITS.perUser)) throw new BankError(429, 'Learner evaluation budget reached', 'EVALUATION_BUDGET_REACHED')
  }
  await tx.interviewEvaluatorBudget.updateMany({ where: { day: today(), scope: { in: keys } }, data: { used: { increment: 1 } } })
}

/** Caller holds Session/Run locks and created the authoritative snapshot in this transaction.
 * Evaluation problems never abort the caller: the saved answer always commits. */
export async function enqueueLearnerAssessment(tx: Tx, snapshotId: string, policy: Prisma.JsonValue | null) {
  if (!policy) return
  const snapshot = await tx.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: snapshotId } })
  if (snapshot.source !== 'LIVE_ATTEMPT' || !snapshot.attemptId) throw new BankError(409, 'Learner evaluation requires a captured attempt')
  const entry = pinnedPolicy(policy)
  const pinned = typeof policy === 'object' && !Array.isArray(policy) ? policy : {}
  const config = entry?.config ?? (pinned.config && typeof pinned.config === 'object' ? pinned.config : {})
  const inputKey = hash({ version: pinned.version ?? null, snapshotId, attemptId: snapshot.attemptId, ownerId: snapshot.ownerId,
    source: snapshot.source, questionHash: snapshot.questionHash, answerHash: snapshot.answerHash, assistance: snapshot.assistance, config })
  let status = 'PENDING'; let errorCode: string | null = null; let result: unknown = null
  if (!entry) { status = 'CANCELLED'; errorCode = 'EVALUATOR_POLICY_UNAVAILABLE' }
  else if (!await learnerEvaluationAccess(snapshot.ownerId, tx)) { status = 'CANCELLED'; errorCode = 'PILOT_ACCESS_UNAVAILABLE' }
  else if (entry.deterministicAbstention && explicitAbstention(snapshot.answerText)) { status = 'COMPLETED'; result = abstentionResult() }
  else {
    try { await budget(snapshot.ownerId, tx) } catch (e) {
      if (!(e instanceof BankError) || e.status !== 429) throw e
      status = 'FAILED'; errorCode = 'EVALUATION_BUDGET_REACHED'
    }
  }
  await tx.interviewAssessment.create({ data: { snapshotId, inputKey, config: json(config), status, errorCode,
    ...(result ? { result: json(result), completedAt: new Date() } : {}) } })
}

export async function claimLearnerAssessment() {
  return prisma.$transaction(async tx => {
    const flag = await tx.platformFeatureFlag.findUnique({ where: { feature: 'interview_adaptive' } })
    if (!flag || flag.hidden || flag.disabled) return null
    // Same claim lock as the Admin worker; source limits remain independent (2 + 2).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('interview-evaluator-claim',0))`
    // Locked rows are re-checked, so a result committed meanwhile is never overwritten.
    const expired = await tx.$queryRaw<Array<{ leaseToken: string }>>`WITH expired AS (
        SELECT a.id, a."leaseToken" FROM "InterviewAssessment" a JOIN "InterviewAnswerSnapshot" s ON s.id=a."snapshotId"
        WHERE s.source='LIVE_ATTEMPT' AND a.status='RUNNING' AND a."leaseUntil" < NOW() FOR UPDATE OF a)
      UPDATE "InterviewAssessment" a SET status='FAILED', "errorCode"='LEASE_EXPIRED', "leaseToken"=NULL, "leaseUntil"=NULL
      FROM expired WHERE a.id=expired.id RETURNING expired."leaseToken"`
    // The invocation may still have been billed; its ledger row keeps unknown tokens.
    if (expired.length) await tx.interviewEvaluatorUsage.updateMany({ where: { invocationKey: { in: expired.map(e => e.leaseToken) }, outcome: 'STARTED' },
      data: { outcome: 'LEASE_EXPIRED' } })
    if (await tx.interviewAssessment.count({ where: { snapshot: { source: 'LIVE_ATTEMPT' }, status: 'RUNNING' } }) >= LEARNER_LIMITS.concurrent) return null
    const candidate = await tx.interviewAssessment.findFirst({ where: { snapshot: { source: 'LIVE_ATTEMPT' }, status: 'PENDING', nextAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' }, include: { snapshot: { include: { attempt: { include: { run: true } } } } } })
    if (!candidate?.snapshot.attempt) return null
    const run = candidate.snapshot.attempt.run
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${run.sessionId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "InterviewAssessment" WHERE id=${candidate.id} FOR UPDATE`
    const row = await tx.interviewAssessment.findUniqueOrThrow({ where: { id: candidate.id }, include: { snapshot: true } })
    const session = await tx.session.findUnique({ where: { id: run.sessionId } })
    if (row.status !== 'PENDING') return null
    const policy = pinnedPolicy(run.evaluationPolicySnapshot)
    const cancel = !session || session.discardedAt ? 'SESSION_DISCARDED' : !policy ? 'EVALUATOR_POLICY_UNAVAILABLE'
      : hash(row.config) !== hash(policy.config) ? 'CONFIG_MISMATCH' : row.attempts >= LEARNER_LIMITS.attempts ? 'ATTEMPTS_EXHAUSTED'
      : !await learnerEvaluationAccess(row.snapshot.ownerId, tx) ? 'PILOT_ACCESS_UNAVAILABLE' : null
    if (cancel || !policy) { await tx.interviewAssessment.update({ where: { id: row.id }, data: { status: 'CANCELLED', errorCode: cancel } }); return null }
    const leaseToken = randomUUID()
    await tx.interviewAssessment.update({ where: { id: row.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, leaseToken,
      leaseUntil: new Date(Date.now() + LEARNER_LIMITS.leaseMs) } })
    // Ledger row before the provider call, so a lost publication still leaves an unknown-usage record.
    await tx.interviewEvaluatorUsage.create({ data: { invocationKey: leaseToken, assessmentId: row.id, modelId: policy.config.modelId,
      region: policy.config.region, inputTokens: null, outputTokens: null, latencyMs: 0, outcome: 'STARTED' } })
    return { ...row, leaseToken, attempts: row.attempts + 1, sessionId: run.sessionId, policy }
  })
}
type Claim = NonNullable<Awaited<ReturnType<typeof claimLearnerAssessment>>>
export async function finishLearnerAssessment(job: Claim, invocation: Invocation | EvaluationFailure) {
  if (job.snapshot.source !== 'LIVE_ATTEMPT') throw new BankError(409, 'Learner worker cannot evaluate Admin tests')
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${job.sessionId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM "InterviewAssessment" WHERE id=${job.id} FOR UPDATE`
    const current = await tx.interviewAssessment.findUnique({ where: { id: job.id } })
    const session = await tx.session.findUnique({ where: { id: job.sessionId } })
    const failure = invocation instanceof EvaluationFailure
    const usage = failure ? invocation.usage : invocation
    const recorded = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, latencyMs: usage.latencyMs, outcome: failure ? invocation.code : 'SUCCESS' }
    // Completes the claim's ledger row; a late result after lease expiry still records its usage.
    await tx.interviewEvaluatorUsage.upsert({ where: { invocationKey: job.leaseToken }, update: recorded, create: {
      invocationKey: job.leaseToken, assessmentId: current?.id ?? null, modelId: job.policy.config.modelId, region: job.policy.config.region, ...recorded } })
    if (!current || current.status !== 'RUNNING' || current.leaseToken !== job.leaseToken) return
    const release = { leaseToken: null, leaseUntil: null }
    const cancel = !session || session.discardedAt ? 'SESSION_DISCARDED' : !await learnerEvaluationAccess(job.snapshot.ownerId, tx) ? 'PILOT_ACCESS_UNAVAILABLE' : null
    if (cancel) { await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: 'CANCELLED', errorCode: cancel } }); return }
    if (failure) {
      let retry = invocation.retryable && current.attempts < LEARNER_LIMITS.attempts
      if (retry) { try { await budget(job.snapshot.ownerId, tx) } catch (e) { if (!(e instanceof BankError) || e.status !== 429) throw e; retry = false } }
      await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: retry ? 'PENDING' : 'FAILED', errorCode: invocation.code,
        nextAt: new Date(Date.now() + 5000), completedAt: retry ? null : new Date() } }); return
    }
    // learner-evaluation-1 keeps its original post-model override; later policies never call the model for an abstention.
    const result = !job.policy.deterministicAbstention && explicitDontKnow(job.snapshot.answerText) ? { ...invocation.result, classification: 'NOT_ANSWERED', strengths: [], gaps: [], misconceptions: [], uncertainty: [], guidance: 'You indicated that you do not know this answer. Review the concept before trying again.',
      criteria: invocation.result.criteria.map(c => ({ ...c, finding: 'NOT_ASSESSED', evidence: [], explanation: 'No subject understanding was demonstrated.' })), followUpQuestion: '' } : invocation.result
    await tx.interviewAssessment.update({ where: { id: job.id }, data: { ...release, status: 'COMPLETED', errorCode: null, completedAt: new Date(), result: json(result) } })
  })
}

export async function learnerFindings(runId: string, ownerId: string, tx: Tx = prisma) {
  const run = await tx.interviewRun.findFirst({ where: { id: runId, ownerId }, include: { owner: { select: { hideTranscriptText: true } } } })
  if (!run) throw new BankError(404, 'Interview not found')
  await lockWritableSession(tx, run.sessionId)
  const rows = await tx.interviewAttempt.findMany({ where: { runId }, orderBy: { index: 'asc' },
    include: { answerSnapshots: { include: { assessment: true } } } })
  const enabled = run.evaluationPolicySnapshot !== null
  return rows.map(a => {
    const snapshot = a.answerSnapshots[0]; const assessment = snapshot?.assessment
    const result = assessment?.status === 'COMPLETED' ? persistedResult.safeParse(assessment.result) : null
    const unassessed = a.status === 'SKIPPED' || a.status === 'INCOMPLETE' ? a.status
      : enabled && (a.status === 'PREPARED' || a.status === 'ASKED') ? 'AWAITING_ANSWER' : 'NOT_ENABLED'
    return { attemptId: a.id, index: a.index, question: run.owner.hideTranscriptText ? '' : questionSnapshotSchema.parse(a.questionSnapshot).questionText,
      status: assessment?.status ?? unassessed,
      errorCode: assessment?.errorCode ?? null, assistance: snapshot?.assistance ?? a.assistance, afterExample: snapshot?.assistance === 'EXAMPLE',
      result: result?.success && !run.owner.hideTranscriptText ? { classification: result.data.classification, criteria: result.data.criteria, strengths: result.data.strengths,
        gaps: result.data.gaps, misconceptions: result.data.misconceptions, guidance: result.data.guidance, uncertainty: result.data.uncertainty,
        ...(result.data.validationNotes ? { validationNotes: result.data.validationNotes } : {}) } : null }
  })
}

export async function sweepLearnerAssessments() {
  const flag = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interview_adaptive' } })
  if (!flag || flag.hidden || flag.disabled) return false
  const job = await claimLearnerAssessment(); if (!job) return false
  let invocation: Invocation | EvaluationFailure
  // Each job runs with the exact registered configuration its run pinned, not whatever is current.
  try { invocation = await evaluateAnswer(questionSnapshotSchema.parse(job.snapshot.questionSnapshot), job.snapshot.answerText, job.policy.config, job.snapshot.assistance) }
  catch (e) { invocation = e instanceof EvaluationFailure ? e : new EvaluationFailure('EVALUATION_FAILED', false, { inputTokens: null, outputTokens: null, latencyMs: 0 }) }
  await finishLearnerAssessment(job, invocation); return true
}
let timer: NodeJS.Timeout | null = null; let running = false
export function startLearnerEvaluatorWorker() {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    void sweepLearnerAssessments().catch(e => logger.error({ event: 'interviews.learner_evaluation_failed', errorType: e instanceof Error ? e.name : 'unknown' }, 'Learner evaluation worker failed'))
      .finally(() => { running = false })
  }, 2000); timer.unref?.()
}
