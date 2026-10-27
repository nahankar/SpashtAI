import { randomUUID } from 'crypto'
import express from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Practice integration tests require the isolated simple_bank database')
  return { url }
})
// History deletion uses the real tombstone route; the background purge is driven explicitly below.
vi.mock('../src/lib/sessionDeletionWorker', () => ({ enqueueSessionDeletion: vi.fn() }))
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: db.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
import { prisma } from '../src/lib/prisma'
import { createQuestion, confirmProvenance, editQuestion, questionAction } from '../src/interviews/bank/service'
import { readyDraft } from './fixtures/bank-draft'
import { readInterviewPlaybackConversation } from '../src/interviews/practice/projection'
import { practiceDurations } from '../src/interviews/practice/access'
import { RECORDING_ACKNOWLEDGMENT, RECORDING_ACKNOWLEDGMENT_VERSIONS } from '../src/interviews/practice/contracts'
import { captureCommittedTurn, endPractice, finishAnswer, markQuestionAsked, practiceDetail, prepareBankAttempt, recordAssistance, startPractice, saveCaptureReceipt, voiceState, practiceHistory } from '../src/interviews/practice/service'
import { LEARNER_POLICIES, hash } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, claimAssessment } from '../src/interviews/evaluator/service'
import { isPulseEligible } from '../src/lib/activityPolicy'
import { practiceAgentRouter, practiceRouter } from '../src/routes/interview-practice'
import { signToken } from '../src/lib/jwt'
import { requireAuth } from '../src/middleware/auth'
import { guardInterviewSession, requireSessionFeature } from '../src/middleware/interviewSessionAccess'
import { resolveLivekitAccess } from '../src/lib/livekitAccess'
import { invalidateFeatureFlagCache } from '../src/lib/featureFlags'
import sessionChatRouter from '../src/routes/session-chat'
import { deleteSession, retainSession } from '../src/routes/sessions'
import { getSessionTurns } from '../src/routes/turns'
import { claimLearnerAssessment, finishLearnerAssessment, sweepLearnerAssessments, LEARNER_LIMITS } from '../src/interviews/evaluator/learner'
import { EvaluationFailure } from '../src/interviews/evaluator/model'
import { correctEvaluation, testAnswer } from './fixtures/interview-evaluation'
import featureRouter from '../src/routes/admin/feature-flags'

const app = express(); app.use(express.json()); app.use('/practice', practiceRouter); app.use('/agent', practiceAgentRouter)
app.use('/flags', requireAuth, featureRouter)
app.use('/chat',requireAuth,sessionChatRouter)
app.put('/retain/:id', requireAuth, retainSession)
app.use(guardInterviewSession)
app.get('/sessions/:sessionId/turns', requireAuth, getSessionTurns)
app.delete('/sessions/:id', requireAuth, requireSessionFeature(), deleteSession)
app.get('/sessions/:id', requireAuth, requireSessionFeature(), (_req,res)=>res.json({ok:true}))
app.post('/sessions/:sessionId/segments', requireAuth, (_req,res)=>res.json({ok:true}))
const ownerTrackFragment = () => fixture.slice(0, 10).toUpperCase()
const token = (id: string, role = 'USER') => signToken({ userId: id, role, email: `${fixture}@example.invalid` })

const fixture = `practice_${randomUUID().replaceAll('-', '')}`
let admin: string; let owner: string; let other: string; let questionId: string; let alternate: string
const originalFlags: Array<Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>> = []
let originalVoices: Awaited<ReturnType<typeof prisma.voiceConfig.findMany>>; let testVoiceId: string
const users: string[] = []; const questions: string[] = []
let originalAdaptive: Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>
let originalLearnerBudget: Awaited<ReturnType<typeof prisma.interviewEvaluatorBudget.findUnique>>
const learnerUsage: string[] = []
const learnerDay = () => new Date().toISOString().slice(0, 10)
async function enableLearner() {
  await prisma.platformFeatureFlag.update({ where: { feature: 'interview_adaptive' }, data: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
  await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: owner, feature: 'interview_adaptive' } }, create: { userId: owner, feature: 'interview_adaptive' }, update: {} })
}
let originalConversation: Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>
async function enableConversation() {
  await prisma.platformFeatureFlag.update({ where: { feature: 'interview_conversation' }, data: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
  await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: owner, feature: 'interview_conversation' } }, create: { userId: owner, feature: 'interview_conversation' }, update: {} })
}
async function learnerClaim() { const job = await claimLearnerAssessment(); expect(job).not.toBeNull(); learnerUsage.push(job!.leaseToken); return job! }
const setup = () => ({ sessionId: randomUUID(), track: fixture, experienceBand: '2-5', startingDifficulty: 'Medium', durationMinutes: 10, recordingConsent: true })
async function run() { return startPractice(setup(), owner) }
const run_ = run
async function segment(sessionId: string, index = 0) {
  return prisma.sessionSegment.create({ data: { id: randomUUID(), sessionId, segmentIndex: index, roomName: randomUUID(), startedAt: new Date() } })
}
async function asked() {
  const r = await run(); const a = await prepareBankAttempt(r.id, owner); const s = await segment(r.sessionId)
  await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
  return { r, a, s }
}
async function receipt(attemptId: string, segmentId: string, action: 'FINISH'|'SKIP'|'PAUSE'|'LEAVE' = 'FINISH') {
  const last = await prisma.interviewAnswerChunk.aggregate({ where: { segmentId }, _max: { localTurnIndex: true } })
  return saveCaptureReceipt(attemptId, { id: randomUUID(), segmentId, action, lastTurnIndex: last._max.localTurnIndex ?? -1 })
}
async function finish(runId: string, attemptId: string, skip = false) {
  const r = await prisma.interviewRun.findUniqueOrThrow({ where: { id: runId } })
  const s = await prisma.sessionSegment.findFirstOrThrow({ where: { sessionId: r.sessionId, endedAt: null } })
  const ack = await receipt(attemptId, s.id, skip ? 'SKIP' : 'FINISH')
  return finishAnswer(runId, attemptId, owner, skip, ack.id)
}
const turn = (segmentId: string, text: string, localTurnIndex = 0) => ({ segmentId, text, localTurnIndex, sourceTurnId: `user_turn_${localTurnIndex}`, role: 'user' })
describe.skipIf(!db.url)('owned interview capture PostgreSQL contracts', () => {
  beforeAll(async () => {
    originalAdaptive = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interview_adaptive' } })
    originalConversation = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interview_conversation' } })
    originalLearnerBudget = await prisma.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: 'learner-global', day: learnerDay() } } })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_adaptive' }, data: { hidden: true, disabled: true } })
    await prisma.interviewEvaluatorBudget.upsert({ where: { scope_day: { scope: 'learner-global', day: learnerDay() } }, create: { scope: 'learner-global', day: learnerDay() }, update: { used: 0 } })
    for (const feature of ['interviews','interview_voice']) {
      originalFlags.push(await prisma.platformFeatureFlag.findUnique({ where: { feature } }))
      await prisma.platformFeatureFlag.upsert({ where: { feature }, create: { feature, label: 'Test', hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' }, update: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
    }
    originalVoices = await prisma.voiceConfig.findMany()
    await prisma.voiceConfig.updateMany({ data: { isActive: false } })
    const voice = await prisma.voiceConfig.upsert({ where: { backend: 'pipeline-bedrock' },
      create: { backend: 'pipeline-bedrock', displayName: 'Interview test', sttProvider: 'transcribe', ttsProvider: 'polly', isActive: true },
      update: { sttProvider: 'transcribe', ttsProvider: 'polly', isActive: true } })
    testVoiceId = voice.id
    for (const [suffix, role] of [['admin', 'SUPER_ADMIN'], ['owner', 'USER'], ['other', 'SUPER_ADMIN']] as const) {
      const u = await prisma.user.create({ data: { email: `${fixture}-${suffix}@example.invalid`, role } }); users.push(u.id)
      for (const feature of ['interviews','interview_voice']) await prisma.userFeatureGrant.create({ data: { userId: u.id, feature } })
    }
    ;[admin, owner, other] = users
    for (const [qid, namespace] of [['A', 'automation-pilot'], ['B', 'automation-pilot'], ['C', fixture]]) {
      const id = await createQuestion({ namespace, externalQid: `${fixture}-${qid}` }, { ...readyDraft(), track: fixture }, admin)
      questions.push(id)
      await confirmProvenance({ questions: [{ id, revision: 1 }], confirmed: true, note: 'Original disposable interview capture test content; no imported material.' }, admin)
      await questionAction(id, 1, 'approve_activate', admin)
    }
    ;[questionId, alternate] = questions
  })
  afterEach(async () => {
    await prisma.session.deleteMany({ where: { userId: { in: users } } })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_adaptive' }, data: { hidden: true, disabled: true, enabled: false } })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_conversation' }, data: { hidden: true, disabled: true, enabled: false } })
    await prisma.userFeatureGrant.deleteMany({ where: { userId: { in: users }, feature: 'interview_conversation' } })
    await prisma.interviewEvaluatorBudget.deleteMany({ where: { scope: `learner-${hash(owner)}` } })
    for (const feature of ['interviews','interview_voice']) await prisma.platformFeatureFlag.update({ where: { feature }, data: { hidden: false, disabled: false } })
    await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: owner, feature: 'interviews' } }, create: { userId: owner, feature: 'interviews' }, update: {} })
  })
  afterAll(async () => {
    await prisma.interviewEvaluatorUsage.deleteMany({ where: { invocationKey: { in: learnerUsage } } })
    if (originalAdaptive) await prisma.platformFeatureFlag.update({ where: { feature: 'interview_adaptive' }, data: { hidden: originalAdaptive.hidden, disabled: originalAdaptive.disabled, enabled: originalAdaptive.enabled, audience: originalAdaptive.audience } })
    if (originalConversation) await prisma.platformFeatureFlag.update({ where: { feature: 'interview_conversation' }, data: { hidden: originalConversation.hidden, disabled: originalConversation.disabled, enabled: originalConversation.enabled, audience: originalConversation.audience } })
    if (originalLearnerBudget) await prisma.interviewEvaluatorBudget.update({ where: { scope_day: { scope: 'learner-global', day: learnerDay() } }, data: { used: originalLearnerBudget.used } })
    else await prisma.interviewEvaluatorBudget.deleteMany({ where: { scope: 'learner-global', day: learnerDay() } })
    await prisma.questionBankQuestion.deleteMany({ where: { id: { in: questions } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    for (const [i,feature] of ['interviews','interview_voice'].entries()) {
      const original = originalFlags[i]
      if (original) await prisma.platformFeatureFlag.update({ where: { feature }, data: { hidden: original.hidden, disabled: original.disabled, enabled: original.enabled, audience: original.audience } })
      else await prisma.platformFeatureFlag.delete({ where: { feature } })
    }
    if (!originalVoices.some(v=>v.id===testVoiceId)) await prisma.voiceConfig.delete({ where: { id: testVoiceId } })
    for (const voice of originalVoices) {
      const { id, createdAt, updatedAt, ...data } = voice
      await prisma.voiceConfig.update({ where: { id }, data })
    }
    await prisma.$disconnect()
  })
  it('never retroactively enables evaluation for a legacy manual run', async () => {
    const { r, a, s } = await asked()
    await enableLearner()
    await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    const saved = await finish(r.id, a.id)
    expect(await prisma.interviewAssessment.count({ where: { snapshotId: saved.id! } })).toBe(0)
  })
  it('does not grade a skipped answer even when learner evaluation is enabled', async () => {
    await enableLearner()
    const { r, a } = await asked()
    await finish(r.id, a.id, true)
    expect(await prisma.interviewAnswerSnapshot.count({ where: { attemptId: a.id } })).toBe(0)
    expect(await claimLearnerAssessment()).toBeNull()
  })
  it.skipIf(!process.env.INTERVIEW_EVALUATOR_TEST_ENDPOINT).each([
    [testAnswer, 'COMPLETED', null], ['[INVALID_OUTPUT]', 'FAILED', 'INVALID_OUTPUT_JSON'],
    ['[THROTTLE]', 'PENDING', 'MODEL_UNAVAILABLE'], ['[TIMEOUT]', 'PENDING', 'TIMEOUT'],
  ])('runs the actual learner worker and Bedrock SDK over local HTTP: %s', async (answer, status, code) => {
    await enableLearner()
    const { r, a, s } = await asked()
    await captureCommittedTurn(a.id, turn(s.id, answer!)); const saved = await finish(r.id, a.id)
    expect(await sweepLearnerAssessments()).toBe(true)
    const row = await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: saved.id! }, include: { usage: true } })
    learnerUsage.push(...row.usage.map(u => u.invocationKey))
    expect(row).toMatchObject({ status, errorCode: code, attempts: 1 })
    expect(row.usage).toHaveLength(1)
    if (status !== 'COMPLETED') expect(row.result).toBeNull()
  }, 30000)
  it('atomically queues one learner assessment and returns owned sanitized findings even after End', async () => {
    await enableLearner()
    const { r, a, s } = await asked()
    await recordAssistance(a.id, { assistance: 'HINT' })
    await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    const receiptId = (await receipt(a.id, s.id)).id
    const replies = await Promise.all([finishAnswer(r.id, a.id, owner, false, receiptId), finishAnswer(r.id, a.id, owner, false, receiptId)])
    expect(replies[0].id).toBe(replies[1].id)
    expect(await prisma.interviewAssessment.count({ where: { snapshotId: replies[0].id! } })).toBe(1)
    const job = await learnerClaim()
    await endPractice(r.id, owner)
    await finishLearnerAssessment(job, { result: { ...correctEvaluation(), validationNotes: ['Answer depth was left unassessed because no evidence was supplied.'] }, inputTokens: 100, outputTokens: 50, latencyMs: 120 })
    const response = await request(app).get(`/practice/playback/${r.sessionId}/assessments`).auth(token(owner), { type: 'bearer' })
    expect(response.status).toBe(200)
    expect(response.body.assessments[0]).toMatchObject({ status: 'COMPLETED', assistance: 'HINT', result: { classification: 'CORRECT' } })
    expect(response.body.assessments[0].result.validationNotes).toHaveLength(1)
    expect(JSON.stringify(response.body)).not.toMatch(/questionSnapshot|questionHash|answerHash|inputKey|followUpQuestion|goodAnswerPoints/)
    expect((await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(other, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(404)
    await expect(assessmentDetail(job.id, admin)).rejects.toMatchObject({ status: 404 })
    await prisma.user.update({ where: { id: owner }, data: { hideTranscriptText: true } })
    try {
      const hidden = await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })
      expect(hidden.body.assessments[0]).toMatchObject({ question: '', result: null })
    } finally { await prisma.user.update({ where: { id: owner }, data: { hideTranscriptText: false } }) }
    expect((await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).sessionPointsAwarded).toBe(false)
  })
  it('reveals technical feedback on both learner paths only after the practice ends', async () => {
    await enableLearner()
    const { r, a, s } = await asked()
    await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    await finish(r.id, a.id)
    // The assessment runs privately in the background and completes before the practice ends.
    const job = await learnerClaim()
    await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 100, outputTokens: 50, latencyMs: 120 })
    expect(await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'COMPLETED' })
    const paths = [`/practice/runs/${r.id}/assessments`, `/practice/playback/${r.sessionId}/assessments`]
    // While unfinished (including a paused segment), neither path returns status or content.
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    for (const path of paths) {
      const during = await request(app).get(path).auth(token(owner), { type: 'bearer' })
      expect(during.status).toBe(200)
      expect(during.body.assessments).toEqual([expect.objectContaining({ attemptId: a.id, status: 'AFTER_PRACTICE', errorCode: null, result: null })])
      expect(JSON.stringify(during.body)).not.toMatch(/CORRECT|COMPLETED|strengths|gaps|guidance|criteria/)
    }
    expect((await request(app).get(paths[1]).auth(token(other, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(404)
    await endPractice(r.id, owner)
    for (const path of paths) {
      const after = await request(app).get(path).auth(token(owner), { type: 'bearer' })
      expect(after.body.assessments[0]).toMatchObject({ status: 'COMPLETED', result: { classification: 'CORRECT' } })
    }
    // No extra model call was made to delay the display: still exactly one assessment, claimed once.
    expect(await prisma.interviewAssessment.count({ where: { snapshot: { attemptId: a.id } } })).toBe(1)
    expect((await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: job.id } })).attempts).toBe(1)
  })
  describe('transcript integrity', () => {
    const previousToken = process.env.INTERNAL_AGENT_TOKEN
    const agent = (path: string, body: unknown) => request(app).post(`/agent${path}`).set('x-internal-agent-token', `${fixture}-internal`).send(body)
    const issue = (attemptId: string, segmentId: string, kind: string, extra: Record<string, unknown> = {}) =>
      agent(`/attempts/${attemptId}/transcript-issues`, { segmentId, kind, eventKey: randomUUID(), ...extra })
    const findingsAfterEnd = async (runId: string) => {
      await endPractice(runId, owner)
      return (await request(app).get(`/practice/runs/${runId}/assessments`).auth(token(owner), { type: 'bearer' })).body.assessments
    }
    beforeAll(() => { process.env.INTERNAL_AGENT_TOKEN = `${fixture}-internal` })
    afterAll(() => { if (previousToken === undefined) delete process.env.INTERNAL_AGENT_TOKEN; else process.env.INTERNAL_AGENT_TOKEN = previousToken })

    it('records events once, on the named answer and its own practice, append-only', async () => {
      const { r, a, s } = await asked()
      const key = randomUUID()
      const body = { segmentId: s.id, kind: 'GAP', lostSpeechSeconds: 12.4, eventKey: key }
      expect((await agent(`/attempts/${a.id}/transcript-issues`, body)).body.reused).toBe(false)
      expect((await agent(`/attempts/${a.id}/transcript-issues`, body)).body.reused).toBe(true)  // duplicate notification
      expect((await agent(`/attempts/${a.id}/transcript-issues`, { ...body, lostSpeechSeconds: 3 })).status).toBe(409)
      expect((await issue(a.id, s.id, 'GAP')).status).toBe(400)                         // a gap needs its speech estimate
      expect((await issue(a.id, s.id, 'NOISE_IGNORED', { lostSpeechSeconds: 1 })).status).toBe(400)
      const other = await prisma.sessionSegment.create({ data: { id: randomUUID(), sessionId: (await prisma.session.create({ data: { id: randomUUID(), userId: owner, module: 'elevate' } })).id,
        segmentIndex: 0, roomName: randomUUID(), startedAt: new Date() } })
      expect((await issue(a.id, other.id, 'RECOGNITION_UNAVAILABLE')).status).toBe(409) // never attributed across practices
      const row = await prisma.interviewTranscriptIssue.findFirstOrThrow({ where: { attemptId: a.id } })
      await expect(prisma.interviewTranscriptIssue.update({ where: { id: row.id }, data: { lostSpeechSeconds: 1 } })).rejects.toThrow()
      expect(await prisma.interviewTranscriptIssue.count({ where: { attemptId: a.id } })).toBe(1)
      await endPractice(r.id, owner)
    })

    it('never grades an answer with a confirmed gap, and a later recovery does not clear it', async () => {
      await enableLearner()
      const { r, a, s } = await asked()
      await captureCommittedTurn(a.id, turn(s.id, testAnswer))
      await issue(a.id, s.id, 'RECOGNITION_UNAVAILABLE')
      await issue(a.id, s.id, 'GAP', { lostSpeechSeconds: 28.3 })
      await issue(a.id, s.id, 'RECOGNITION_RECOVERED')
      const saved = await finish(r.id, a.id)
      const snapshot = await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: saved.id! } })
      expect(snapshot.transcriptIntegrity).toMatchObject({ incomplete: true, gapSpeechSeconds: 28.3, unresolved: false })
      const row = await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: saved.id! } })
      expect(row).toMatchObject({ status: 'CANCELLED', errorCode: 'TRANSCRIPT_INCOMPLETE', attempts: 0, result: null })
      expect(await claimLearnerAssessment()).toBeNull()                                // no model call
      const [finding] = await findingsAfterEnd(r.id)
      expect(finding).toMatchObject({ status: 'TRANSCRIPT_INCOMPLETE', result: null,
        transcriptIntegrity: { gapSpeechSeconds: 28.3, unresolved: false, unconfirmedAccepted: false, recordingAvailable: false } })
      expect(JSON.stringify(finding)).not.toMatch(/INCORRECT|NOT_ANSWERED|DONT_KNOW/)
    })

    it('treats unresolved recognition and accepted unconfirmed speech as incomplete, but not ignored noise', async () => {
      await enableLearner()
      const { r, a, s } = await asked()
      await captureCommittedTurn(a.id, turn(s.id, testAnswer))
      await issue(a.id, s.id, 'RECOGNITION_UNAVAILABLE')                              // never recovered
      const first = await finish(r.id, a.id)
      expect(await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: first.id! } })).toMatchObject({ errorCode: 'TRANSCRIPT_INCOMPLETE' })
      // The next question starts clean: the gap stays with the answer it affected.
      const b = await prepareBankAttempt(r.id, owner, a.id)
      await markQuestionAsked(b.id, { segmentId: s.id, questionText: b.question.text })
      await captureCommittedTurn(b.id, turn(s.id, testAnswer, 1))
      await issue(b.id, s.id, 'NOISE_IGNORED')
      const second = await finish(r.id, b.id)
      expect((await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: second.id! } })).transcriptIntegrity).toMatchObject({ incomplete: false, ignoredSounds: 1 })
      expect(await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: second.id! } })).toMatchObject({ status: 'PENDING', errorCode: null })
      const job = await learnerClaim()
      expect(job.snapshot.attemptId).toBe(b.id)
      await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 10, outputTokens: 5, latencyMs: 1 })
      const findings = await findingsAfterEnd(r.id)
      expect(findings[0]).toMatchObject({ status: 'TRANSCRIPT_INCOMPLETE', transcriptIntegrity: { unresolved: true } })
      expect(findings[1]).toMatchObject({ status: 'COMPLETED', result: { classification: 'CORRECT' } })
      expect(findings[1].transcriptIntegrity).toBeUndefined()
    })

    it('a gap arriving after grading hides the grade without rewriting the stored evaluation', async () => {
      await enableLearner()
      const { r, a, s } = await asked()
      await captureCommittedTurn(a.id, turn(s.id, testAnswer))
      await finish(r.id, a.id)
      const job = await learnerClaim()
      // Reported while the model ran: the late result is not stored as a grade.
      await issue(a.id, s.id, 'GAP', { lostSpeechSeconds: 4 })
      await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 10, outputTokens: 5, latencyMs: 1 })
      const row = await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: job.id } })
      expect(row).toMatchObject({ status: 'CANCELLED', errorCode: 'TRANSCRIPT_INCOMPLETE', result: null })
      // An evaluation completed before a later event stays stored as it was, but is never shown as a grade.
      const c = await prepareBankAttempt(r.id, owner, a.id)
      await markQuestionAsked(c.id, { segmentId: s.id, questionText: c.question.text })
      await captureCommittedTurn(c.id, turn(s.id, testAnswer, 1)); await finish(r.id, c.id)
      const graded = await learnerClaim()
      await finishLearnerAssessment(graded, { result: correctEvaluation(), inputTokens: 10, outputTokens: 5, latencyMs: 1 })
      const stored = await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: graded.id } })
      await prisma.interviewTranscriptIssue.create({ data: { attemptId: c.id, segmentId: s.id, kind: 'UNCONFIRMED_ACCEPTED', eventKey: randomUUID() } })
      const findings = await findingsAfterEnd(r.id)
      expect(findings[1]).toMatchObject({ status: 'TRANSCRIPT_INCOMPLETE', result: null, transcriptIntegrity: { unconfirmedAccepted: true } })
      expect(await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: graded.id } })).toEqual(stored)
    }, 30000)

    it('events go with their answer through Pause, a new segment and discard', async () => {
      const { r, a, s } = await asked()
      await issue(a.id, s.id, 'GAP', { lostSpeechSeconds: 2.5 })
      // Pause ends the segment; the answer continues on a new segment after reconnecting.
      await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
      const s2 = await segment(r.sessionId, 1)
      await issue(a.id, s2.id, 'RECOGNITION_UNAVAILABLE')
      expect(await prisma.interviewTranscriptIssue.findMany({ where: { attemptId: a.id }, select: { segmentId: true }, orderBy: { createdAt: 'asc' } }))
        .toEqual([{ segmentId: s.id }, { segmentId: s2.id }])
      await prisma.session.delete({ where: { id: r.sessionId } })
      expect(await prisma.interviewTranscriptIssue.count({ where: { attemptId: a.id } })).toBe(0)
    })
  })
  it('preserves the saved answer when learner budget is exhausted', async () => {
    await enableLearner()
    await prisma.interviewEvaluatorBudget.upsert({ where: { scope_day: { scope: `learner-${hash(owner)}`, day: learnerDay() } },
      create: { scope: `learner-${hash(owner)}`, day: learnerDay(), used: LEARNER_LIMITS.perUser }, update: { used: LEARNER_LIMITS.perUser } })
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    const saved = await finish(r.id, a.id)
    expect((await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: saved.id! } })).answerText).toBe(testAnswer)
    expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: saved.id! } })).toMatchObject({ status: 'FAILED', errorCode: 'EVALUATION_USER_BUDGET_REACHED' })
    expect(await claimLearnerAssessment()).toBeNull()
  })
  it('cancels queued learner work through the real Admin grant-revocation endpoint', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    const saved = await finish(r.id, a.id)
    const reply = await request(app).put(`/flags/interview_adaptive/grants/${owner}`).auth(token(admin, 'SUPER_ADMIN'), { type: 'bearer' }).send({ granted: false })
    expect(reply.status).toBe(200)
    expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: saved.id! } })).toMatchObject({ status: 'CANCELLED', result: null, leaseToken: null })
  })
  it('fences publication after grant revocation and keeps disabled learner work out of the Admin worker', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); await finish(r.id, a.id)
    const job = await learnerClaim()
    await prisma.userFeatureGrant.deleteMany({ where: { userId: owner, feature: 'interview_adaptive' } })
    await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    expect(await prisma.interviewAssessment.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'CANCELLED', result: null })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_adaptive' }, data: { disabled: true } })
    expect(await claimLearnerAssessment()).toBeNull()
    expect(await claimAssessment()).toBeNull()
  })
  it('retries a transient model failure without making a second logical assessment', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); await finish(r.id, a.id)
    const first = await learnerClaim()
    await finishLearnerAssessment(first, new EvaluationFailure('TIMEOUT', true, { inputTokens: null, outputTokens: null, latencyMs: 20000 }))
    await prisma.interviewAssessment.update({ where: { id: first.id }, data: { nextAt: new Date(0) } })
    const second = await learnerClaim(); expect(second.id).toBe(first.id); expect(second.attempts).toBe(2)
    await finishLearnerAssessment(second, { result: correctEvaluation(), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    await finishLearnerAssessment(first, new EvaluationFailure('TIMEOUT', true, { inputTokens: null, outputTokens: null, latencyMs: 20000 }))
    expect(await prisma.interviewAssessment.findUnique({ where: { id: first.id } })).toMatchObject({ status: 'COMPLETED', attempts: 2 })
  })
  it('records abstention as unassessed under learner-evaluation-1 and fences a result arriving after discard', async () => {
    await enableLearner()
    // learner-evaluation-1 calls the model and overrides an explicit abstention afterwards.
    const { r, a, s } = await asked(); await pin(r.id, 'learner-evaluation-1')
    await captureCommittedTurn(a.id, turn(s.id, "I don't know")); await finish(r.id, a.id)
    const first = await learnerClaim()
    await finishLearnerAssessment(first, { result: correctEvaluation("I don't know"), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    const result = (await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: first.id } })).result as { classification: string; criteria: Array<{finding:string}> }
    expect(result.classification).toBe('NOT_ANSWERED'); expect(result.criteria.every(c => c.finding === 'NOT_ASSESSED')).toBe(true)
    const next = await prepareBankAttempt(r.id, owner)
    await markQuestionAsked(next.id, { segmentId: s.id, questionText: next.question.text })
    await captureCommittedTurn(next.id, turn(s.id, testAnswer, 1)); await finish(r.id, next.id)
    const late = await learnerClaim()
    await prisma.session.update({ where: { id: r.sessionId }, data: { discardedAt: new Date() } })
    await finishLearnerAssessment(late, { result: correctEvaluation(), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    expect(await prisma.interviewAssessment.findUnique({ where: { id: late.id } })).toMatchObject({ status: 'CANCELLED', result: null })
    expect((await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })).status).toBe(410)
  })
  // Simulates a run pinned by another code release: run configuration is otherwise immutable in SQL.
  const pin = (runId: string, version: string, ...config: unknown[]) => prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`
    const policy = config.length ? (config[0] === undefined ? { version } : { version, config: config[0] }) : { version, config: LEARNER_POLICIES[version].config }
    await tx.interviewRun.update({ where: { id: runId }, data: { evaluationPolicySnapshot: policy as never } })
  })
  const ownerBudget = () => prisma.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: `learner-${hash(owner)}`, day: learnerDay() } } })
  it('keeps saving answers when the pinned learner policy is unknown to this code or altered', async () => {
    await enableLearner()
    for (const [version, config] of [['learner-evaluation-99', { modelId: 'unregistered' }], ['learner-evaluation-1', { ...LEARNER_POLICIES['learner-evaluation-1'].config, maxTokens: 4000 }], ['learner-evaluation-1', undefined]] as const) {
      const { r, a, s } = await asked(); await pin(r.id, version, config)
      await captureCommittedTurn(a.id, turn(s.id, testAnswer))
      const saved = await finish(r.id, a.id)
      expect(saved.status).toBe('ANSWERED')
      expect((await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: saved.id! } })).answerText).toBe(testAnswer)
      expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: saved.id! } })).toMatchObject({ status: 'CANCELLED', errorCode: 'EVALUATOR_POLICY_UNAVAILABLE', result: null })
      await endPractice(r.id, owner)
    }
    expect(await ownerBudget()).toBeNull()
    expect(await claimLearnerAssessment()).toBeNull()
  })
  it('evaluates each run with the exact registered policy it pinned', async () => {
    await enableLearner()
    const jobs: Record<string, string> = {}
    for (const version of ['learner-evaluation-1', 'learner-evaluation-2']) {
      const { r, a, s } = await asked(); await pin(r.id, version)
      await captureCommittedTurn(a.id, turn(s.id, testAnswer)); const saved = await finish(r.id, a.id)
      jobs[version] = (await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: saved.id! } })).id
      await endPractice(r.id, owner)
    }
    for (let i = 0; i < 2; i++) {
      const job = await learnerClaim()
      const version = Object.entries(jobs).find(([, id]) => id === job.id)![0]
      expect(job.policy.config).toEqual(LEARNER_POLICIES[version].config)
      expect(hash(job.config)).toBe(hash(LEARNER_POLICIES[version].config))
    }
  })
  it('cancels a job whose stored config no longer matches its run policy with a distinct code', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); const saved = await finish(r.id, a.id)
    await prisma.interviewAssessment.update({ where: { snapshotId: saved.id! }, data: { config: { ...LEARNER_POLICIES['learner-evaluation-1'].config } } })
    expect(await claimLearnerAssessment()).toBeNull()
    expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: saved.id! } })).toMatchObject({ status: 'CANCELLED', errorCode: 'CONFIG_MISMATCH' })
    await endPractice(r.id, owner)
    const second = await asked(); await captureCommittedTurn(second.a.id, turn(second.s.id, testAnswer)); const other = await finish(second.r.id, second.a.id)
    await prisma.session.update({ where: { id: second.r.sessionId }, data: { discardedAt: new Date() } })
    expect(await claimLearnerAssessment()).toBeNull()
    expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: other.id! } })).toMatchObject({ status: 'CANCELLED', errorCode: 'SESSION_DISCARDED' })
  })
  it('completes an explicit abstention under learner-evaluation-2 without a model call or budget', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await pin(r.id, 'learner-evaluation-2')
    await captureCommittedTurn(a.id, turn(s.id, "Sorry, I don't know this one.")); const saved = await finish(r.id, a.id)
    const row = await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: saved.id! }, include: { usage: true } })
    expect(row).toMatchObject({ status: 'COMPLETED', attempts: 0, errorCode: null }); expect(row.usage).toHaveLength(0)
    expect((row.result as { classification: string }).classification).toBe('NOT_ANSWERED')
    expect(await ownerBudget()).toBeNull()
    expect(await claimLearnerAssessment()).toBeNull()
    await endPractice(r.id, owner)
    const findings = await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })
    expect(findings.body.assessments[0]).toMatchObject({ status: 'COMPLETED', result: { classification: 'NOT_ANSWERED', strengths: [], misconceptions: [] } })
  })
  it('completes a request-only answer under learner-evaluation-4 as no evidence, without a model call or budget', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await pin(r.id, 'learner-evaluation-4')
    await captureCommittedTurn(a.id, turn(s.id, 'Can you repeat that question one more time, please?')); const saved = await finish(r.id, a.id)
    const row = await prisma.interviewAssessment.findUniqueOrThrow({ where: { snapshotId: saved.id! }, include: { usage: true } })
    expect(row).toMatchObject({ status: 'COMPLETED', attempts: 0 }); expect(row.usage).toHaveLength(0)
    expect(await ownerBudget()).toBeNull()
    await endPractice(r.id, owner)
    const findings = await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })
    expect(findings.body.assessments[0].result).toMatchObject({ classification: 'NOT_ANSWERED', responseKind: 'REQUEST_ONLY', strengths: [] })
  })
  it('lists only the owner\'s practices with answered, skipped and incomplete counts, and links playback by attempt', async () => {
    // Skipped first question, answered second, then a third left open when the practice ends.
    const { r, a, s } = await asked(); await finish(r.id, a.id, true)
    const second = await prepareBankAttempt(r.id, owner, a.id)
    await markQuestionAsked(second.id, { segmentId: s.id, questionText: second.question.text })
    await captureCommittedTurn(second.id, turn(s.id, testAnswer)); await finish(r.id, second.id)
    await endPractice(r.id, owner)
    const listed = (await request(app).get('/practice/runs').auth(token(owner), { type: 'bearer' })).body.runs.find((h: { id: string }) => h.id === r.id)
    expect(listed).toMatchObject({ questionCount: 2, answeredCount: 1, skippedCount: 1, incompleteCount: 0 })
    expect(listed.endedAt).toBeTruthy()
    expect((await request(app).get('/practice/runs').auth(token(other), { type: 'bearer' })).body.runs.some((h: { id: string }) => h.id === r.id)).toBe(false)
    const playback = await readInterviewPlaybackConversation(prisma, r.id)
    expect(playback.filter(m => m.role === 'user').map(m => m.attemptId)).toEqual([second.id])
    expect(playback.find(m => m.id === `interview_question_${a.id}`)).toMatchObject({ attemptId: a.id, attemptStatus: 'SKIPPED' })
  })
  it('pins learner-evaluation-8 for a newly started evaluated practice while earlier pins keep their own policy', async () => {
    await enableLearner()
    const fresh = await asked()
    expect((await prisma.interviewRun.findUniqueOrThrow({ where: { id: fresh.r.id } })).evaluationPolicySnapshot).toEqual({ version: 'learner-evaluation-8', config: LEARNER_POLICIES['learner-evaluation-8'].config })
    await endPractice(fresh.r.id, owner)
    const older = await asked(); await pin(older.r.id, 'learner-evaluation-5')
    await captureCommittedTurn(older.a.id, turn(older.s.id, testAnswer)); await finish(older.r.id, older.a.id)
    const job = await learnerClaim()
    expect(job.policy.config).toEqual(LEARNER_POLICIES['learner-evaluation-5'].config)
    expect(job.policy.config.schema).toBe('interview-result-3')
  })
  it('verifies plan practice times server-side: Ultra no limit, Pro 30 minutes, others 5-15', async () => {
    const plan = (data: { enablePro: boolean; enableUltra: boolean }) => prisma.user.update({ where: { id: owner }, data })
    const start = async (durationMinutes?: number | null) => {
      const body = { ...setup(), durationMinutes }; if (durationMinutes === undefined) delete (body as { durationMinutes?: unknown }).durationMinutes
      return request(app).post('/practice/runs').auth(token(owner), { type: 'bearer' }).send(body)
    }
    const durationOf = async (id: string) => (await prisma.interviewRun.findUniqueOrThrow({ where: { id } })).durationMinutes
    try {
      await plan({ enablePro: true, enableUltra: true })   // both on (the default for new accounts): Ultra wins
      let res = await start(); expect(res.status).toBe(201); expect(await durationOf(res.body.id)).toBeNull(); await endPractice(res.body.id, owner)
      res = await start(15); expect(await durationOf(res.body.id)).toBe(15); await endPractice(res.body.id, owner)
      await plan({ enablePro: true, enableUltra: false })
      res = await start(); expect(await durationOf(res.body.id)).toBe(30); await endPractice(res.body.id, owner)
      res = await start(null); expect(res.status).toBe(403); expect(res.body.code ?? res.body.error).toBeTruthy()
      await plan({ enablePro: false, enableUltra: false })
      res = await start(); expect(await durationOf(res.body.id)).toBe(10); await endPractice(res.body.id, owner)
      expect((await start(30)).status).toBe(403)
      expect((await start(45 as never)).status).toBe(400)
      // The plan comes from the stored account, never from a role claimed in the token.
      const forged = await request(app).get('/practice/options').auth(token(owner, 'SUPER_ADMIN'), { type: 'bearer' })
      if (forged.status === 200) expect(forged.body.durations.plan).toBe('standard')
      // An Admin account has every plan feature, including no time limit.
      expect(practiceDurations({ role: 'SUPER_ADMIN', enablePro: false, enableUltra: false })).toMatchObject({ plan: 'ultra', default: null })
      const learnerOptions = await request(app).get('/practice/options').auth(token(owner), { type: 'bearer' })
      expect(learnerOptions.body.durations).toEqual({ plan: 'standard', allowed: [5, 10, 15], default: 10 })
    } finally { await plan({ enablePro: true, enableUltra: true }) }
  })
  it('runs a new practice past eight questions until eligible questions run out; earlier practices keep their stored limit', async () => {
    const track = `${fixture}-many`
    const extra: string[] = []
    try {
      for (let i = 0; i < 10; i++) {
        const id = await createQuestion({ namespace: 'automation-pilot', externalQid: `${track}-${i}` }, { ...readyDraft(), track }, admin)
        extra.push(id)
        await confirmProvenance({ questions: [{ id, revision: 1 }], confirmed: true, note: 'Original disposable interview capture test content; no imported material.' }, admin)
        await questionAction(id, 1, 'approve_activate', admin)
      }
      const r = await startPractice({ ...setup(), track: [track], durationMinutes: null }, owner)
      const stored = await prisma.interviewRun.findUniqueOrThrow({ where: { id: r.id } })
      expect(stored.maxQuestions).toBeNull()
      const s = await segment(r.sessionId)
      const seen = new Set<string>()
      let previous: string | undefined
      for (let i = 1; i <= 10; i++) {
        const a = await prepareBankAttempt(r.id, owner, previous)
        expect(a.index).toBe(i)
        seen.add(a.question.text + a.id)
        await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
        await finish(r.id, a.id, true)
        previous = a.id
      }
      // No question repeats within the practice; the eleventh request reports the exhausted bank, never a new question.
      const asked = await prisma.interviewAttempt.findMany({ where: { runId: r.id }, select: { questionId: true } })
      expect(new Set(asked.map(a => a.questionId)).size).toBe(10)
      await expect(prepareBankAttempt(r.id, owner, previous)).rejects.toMatchObject({ code: 'QUESTION_BANK_EXHAUSTED' })
      const options = await request(app).get('/practice/options').auth(token(owner), { type: 'bearer' })
      expect(options.body.maxQuestions).toBeNull()
      expect(options.body.evaluationDailyLimit).toBe(30)
      await endPractice(r.id, owner)

      // An earlier practice stored with eight questions cannot gain a ninth, even written directly.
      const template = await prisma.interviewAttempt.findFirstOrThrow({ where: { runId: r.id, index: 9 } })
      const session = await prisma.session.create({ data: { id: randomUUID(), userId: owner, module: 'elevate', purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY' } })
      const legacy = await prisma.interviewRun.create({ data: { sessionId: session.id, ownerId: owner, namespace: 'automation-pilot', track, experienceBand: '2-5',
        startingDifficulty: 'Medium', durationMinutes: 10, maxQuestions: 8, recordingConsentAt: new Date(), recordingConsentVersion: 'interview-recording-1',
        recordingConsentSource: 'PRACTICE_CHECKBOX', voiceConfigSnapshot: stored.voiceConfigSnapshot as never } })
      const attempt = (index: number) => prisma.interviewAttempt.create({ data: { runId: legacy.id, index, questionId: template.questionId,
        questionSnapshot: template.questionSnapshot as never, questionHash: template.questionHash } })
      await expect(attempt(8)).resolves.toMatchObject({ index: 8 })
      await expect(attempt(9)).rejects.toThrow()
      expect(await prisma.interviewRun.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ maxQuestions: 8 })
      // A stored limit other than 8 (or none) is refused for any run.
      const other = await prisma.session.create({ data: { id: randomUUID(), userId: owner, module: 'elevate', purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY' } })
      await expect(prisma.interviewRun.create({ data: { sessionId: other.id, ownerId: owner, namespace: 'automation-pilot', track, experienceBand: '2-5',
        startingDifficulty: 'Medium', durationMinutes: 10, maxQuestions: 1000, recordingConsentAt: new Date(), recordingConsentVersion: 'interview-recording-1',
        voiceConfigSnapshot: stored.voiceConfigSnapshot as never } })).rejects.toThrow()
    } finally {
      await prisma.session.deleteMany({ where: { userId: owner } })
      await prisma.questionBankQuestion.deleteMany({ where: { id: { in: extra } } })
    }
  })
  it('never ends a no-time-limit practice by time and leaves older durations alone', async () => {
    const older = await asked(); expect((await prisma.interviewRun.findUniqueOrThrow({ where: { id: older.r.id } })).durationMinutes).toBe(10)
    await endPractice(older.r.id, owner)
    const r = await startPractice({ ...setup(), durationMinutes: null }, owner)
    const a = await prepareBankAttempt(r.id, owner)
    // Hours of active time would end any timed practice.
    const s = await prisma.sessionSegment.create({ data: { id: randomUUID(), sessionId: r.sessionId, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date(Date.now() - 5 * 3600_000) } })
    await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
    expect((await voiceState(r.sessionId, s.id, s.roomName, `user_${owner}`)).secondsRemaining).toBeNull()
    await captureCommittedTurn(a.id, turn(s.id, testAnswer)); await finish(r.id, a.id)
    const next = await prepareBankAttempt(r.id, owner, a.id)
    expect(next.index).toBe(2)
    // New practices store no question limit at all (NULL), not a large number.
    expect((await prisma.interviewRun.findUniqueOrThrow({ where: { id: r.id } })).maxQuestions).toBeNull()
    expect((await practiceDetail(r.id, owner)).durationMinutes).toBeNull()
  })
  it('replaces the per-practice checkbox only after an explicit, versioned, append-only acknowledgment', async () => {
    const auth = (r: request.Test) => r.auth(token(owner), { type: 'bearer' })
    await prisma.recordingAcknowledgment.deleteMany({ where: { userId: owner } })
    try {
      expect((await auth(request(app).get('/practice/recording-acknowledgment'))).body).toMatchObject({ current: { version: RECORDING_ACKNOWLEDGMENT.version }, accepted: null })
      const { recordingConsent: _c, ...noCheckbox } = setup()
      const refused = await auth(request(app).post('/practice/runs')).send(noCheckbox)
      expect(refused.status).toBe(409); expect(refused.body.code).toBe('RECORDING_ACKNOWLEDGMENT_REQUIRED')
      expect((await auth(request(app).post('/practice/recording-acknowledgment')).send({ version: 'interview-recording-ai-0' })).status).toBe(409)
      // An acceptance of the earlier wording is kept as it was but does not authorise new practices.
      const earlier = RECORDING_ACKNOWLEDGMENT_VERSIONS['interview-recording-ai-1']
      await prisma.recordingAcknowledgment.create({ data: { userId: owner, version: 'interview-recording-ai-1', scope: [...earlier.scope],
        textHash: hash(earlier.text), source: 'INTERVIEWS_PAGE' } })
      expect((await auth(request(app).get('/practice/recording-acknowledgment'))).body.accepted).toBeNull()
      expect((await auth(request(app).post('/practice/runs')).send(noCheckbox)).body.code).toBe('RECORDING_ACKNOWLEDGMENT_REQUIRED')
      expect((await auth(request(app).post('/practice/recording-acknowledgment')).send({ version: 'interview-recording-ai-1' })).status).toBe(409)
      // The current wording names no service provider.
      expect(RECORDING_ACKNOWLEDGMENT.version).toBe('interview-recording-ai-2')
      expect(RECORDING_ACKNOWLEDGMENT.text).not.toMatch(/Amazon|AWS|Bedrock|Transcribe|Polly|Nova/)
      expect(RECORDING_ACKNOWLEDGMENT.text).toContain('third-party cloud services')
      const accepted = await auth(request(app).post('/practice/recording-acknowledgment')).send({ version: RECORDING_ACKNOWLEDGMENT.version })
      expect(accepted.body).toMatchObject({ version: RECORDING_ACKNOWLEDGMENT.version, reused: false })
      const again = await auth(request(app).post('/practice/recording-acknowledgment')).send({ version: RECORDING_ACKNOWLEDGMENT.version })
      expect(again.body).toMatchObject({ reused: true, acceptedAt: accepted.body.acceptedAt })
      const row = await prisma.recordingAcknowledgment.findUniqueOrThrow({ where: { userId_version: { userId: owner, version: RECORDING_ACKNOWLEDGMENT.version } } })
      expect(row).toMatchObject({ scope: [...RECORDING_ACKNOWLEDGMENT.scope], textHash: hash(RECORDING_ACKNOWLEDGMENT.text), source: 'INTERVIEWS_PAGE' })
      await expect(prisma.recordingAcknowledgment.update({ where: { id: row.id }, data: { source: 'EDITED' } })).rejects.toThrow()
      // With a valid acknowledgment the practice starts without the checkbox and records where consent came from.
      const started = await auth(request(app).post('/practice/runs')).send(noCheckbox)
      expect(started.status).toBe(201)
      const run = await prisma.interviewRun.findUniqueOrThrow({ where: { id: started.body.id } })
      expect(run).toMatchObject({ recordingConsentVersion: RECORDING_ACKNOWLEDGMENT.version, recordingConsentSource: 'ACCOUNT_ACKNOWLEDGMENT', recordingAcknowledgmentId: row.id })
      const a = await prepareBankAttempt(run.id, owner); const s = await segment(run.sessionId)
      await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
      expect((await voiceState(run.sessionId, s.id, s.roomName, `user_${owner}`)).attempt.id).toBe(a.id)
      await endPractice(run.id, owner)
      // The legacy checkbox still works and is labelled as such.
      const legacy = await run_()
      expect(await prisma.interviewRun.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ recordingConsentVersion: 'interview-recording-1', recordingConsentSource: 'PRACTICE_CHECKBOX', recordingAcknowledgmentId: null })
      await endPractice(legacy.id, owner)
      // The database refuses acknowledgment provenance that does not exist.
      const session = await prisma.session.create({ data: { id: randomUUID(), userId: owner, module: 'elevate', purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY' } })
      await expect(prisma.interviewRun.create({ data: { sessionId: session.id, ownerId: owner, namespace: 'automation-pilot', track: fixture, experienceBand: '2-5',
        startingDifficulty: 'Medium', durationMinutes: 10, maxQuestions: 8, recordingConsentAt: new Date(), recordingConsentVersion: RECORDING_ACKNOWLEDGMENT.version,
        recordingConsentSource: 'ACCOUNT_ACKNOWLEDGMENT', recordingAcknowledgmentId: 'not-an-acknowledgment', voiceConfigSnapshot: run.voiceConfigSnapshot as never } })).rejects.toThrow()
      await prisma.session.delete({ where: { id: session.id } })
    } finally { await prisma.recordingAcknowledgment.deleteMany({ where: { userId: owner } }) }
  })
  it('pages history with honest totals and applies search and status to the whole owned history', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) { const { r } = await asked(); await endPractice(r.id, owner); ids.push(r.id) }
    const get = async (query: string, who = owner) => (await request(app).get(`/practice/runs?${query}`).auth(token(who), { type: 'bearer' })).body
    const ownerTotal = (await get('limit=1')).ownerTotal
    const first = await get('limit=2'); const second = await get(`limit=2&offset=${first.nextOffset}`)
    expect(first.runs).toHaveLength(2); expect(first.total).toBe(ownerTotal); expect(first.nextOffset).toBe(2)
    expect(new Set([...first.runs, ...second.runs].map((r: { id: string }) => r.id)).size).toBe(first.runs.length + second.runs.length)
    expect(ids.slice().reverse().slice(0, 2)).toEqual(first.runs.map((r: { id: string }) => r.id))
    expect((await get(`limit=100`)).nextOffset).toBeNull()
    expect((await get('status=active&limit=100')).runs.some((r: { id: string }) => ids.includes(r.id))).toBe(false)
    const ended = await get('status=ended&limit=100'); expect(ended.total).toBe(ended.runs.length)
    expect((await get('q=no-such-track-xyz')).total).toBe(0)
    expect((await get(`q=${encodeURIComponent(ownerTrackFragment())}&limit=100`)).runs.some((r: { id: string }) => ids.includes(r.id))).toBe(true)
    expect((await get('sort=date&dir=asc&limit=1')).runs[0].id).not.toBe(ids[2])
    // Ownership: another learner sees none of these, and bad parameters are refused.
    expect((await get('limit=100', other)).runs.some((r: { id: string }) => ids.includes(r.id))).toBe(false)
    expect((await request(app).get('/practice/runs?limit=1000').auth(token(owner), { type: 'bearer' })).status).toBe(400)
  })
  it('deletes only an owned interview from history, fences a late result and keeps usage accounting', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); const saved = await finish(r.id, a.id)
    await endPractice(r.id, owner)
    const job = await learnerClaim()
    // Ownership: another learner (and an Admin role) cannot delete it; nothing changes.
    expect((await request(app).delete(`/sessions/${r.sessionId}`).auth(token(other), { type: 'bearer' })).status).toBe(404)
    expect((await request(app).delete(`/sessions/${r.sessionId}`).auth(token(other, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(404)
    expect((await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).discardedAt).toBeNull()
    expect((await request(app).delete(`/sessions/${r.sessionId}`).auth(token(owner), { type: 'bearer' })).status).toBe(202)
    expect((await request(app).get('/practice/runs').auth(token(owner), { type: 'bearer' })).body.runs.some((h: { id: string }) => h.id === r.id)).toBe(false)
    // A worker finishing after the delete cannot publish a grade.
    await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: saved.id! } })).toMatchObject({ status: 'CANCELLED', errorCode: 'SESSION_DISCARDED', result: null })
    // The durable worker's final step: the hard delete cascades through every interview row.
    expect((await prisma.session.deleteMany({ where: { id: r.sessionId, discardedAt: { not: null } } })).count).toBe(1)
    expect(await prisma.interviewRun.findUnique({ where: { id: r.id } })).toBeNull()
    expect(await prisma.interviewAttempt.count({ where: { runId: r.id } })).toBe(0)
    expect(await prisma.interviewAnswerChunk.count({ where: { attemptId: a.id } })).toBe(0)
    expect(await prisma.interviewAnswerSnapshot.count({ where: { id: saved.id! } })).toBe(0)
    expect(await prisma.interviewAssessment.count({ where: { snapshotId: saved.id! } })).toBe(0)
    // Usage accounting survives, detached from the deleted assessment.
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: job.leaseToken } })).toMatchObject({ assessmentId: null })
  })
  it('records a ledger row at claim that survives lease expiry and takes the late actual usage', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); await finish(r.id, a.id)
    const job = await learnerClaim()
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: job.leaseToken } })).toMatchObject({ outcome: 'STARTED', inputTokens: null, outputTokens: null, assessmentId: job.id })
    await prisma.interviewAssessment.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 1000) } })
    expect(await claimLearnerAssessment()).toBeNull()
    expect(await prisma.interviewAssessment.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', errorCode: 'LEASE_EXPIRED', leaseToken: null })
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: job.leaseToken } })).toMatchObject({ outcome: 'LEASE_EXPIRED', inputTokens: null })
    await finishLearnerAssessment(job, { result: correctEvaluation(), inputTokens: 1400, outputTokens: 400, latencyMs: 61_000 })
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: job.leaseToken } })).toMatchObject({ outcome: 'SUCCESS', inputTokens: 1400, outputTokens: 400 })
    expect(await prisma.interviewAssessment.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'FAILED', result: null })
  })
  it('caps concurrent learner claims at two, independently of running Admin tests', async () => {
    await enableLearner()
    for (let i = 0; i < 2; i++) {
      const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); await finish(r.id, a.id)
      if (i === 0) {
        const next = await prepareBankAttempt(r.id, owner); await markQuestionAsked(next.id, { segmentId: s.id, questionText: next.question.text })
        await captureCommittedTurn(next.id, turn(s.id, testAnswer, 1)); await finish(r.id, next.id)
      }
      await endPractice(r.id, owner)
    }
    // Two running Admin tests occupy the Admin ceiling only.
    const adminRows: string[] = []
    for (let i = 0; i < 2; i++) {
      const q = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id: questionId } })
      const snap = await prisma.interviewAnswerSnapshot.create({ data: { ownerId: admin, questionId, questionSnapshot: { id: q.id } as never, questionHash: randomUUID(), answerText: testAnswer, answerHash: randomUUID(),
        assessment: { create: { inputKey: randomUUID(), config: {}, status: 'RUNNING', attempts: 1, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) } } } })
      adminRows.push(snap.id)
    }
    try {
      const claims = (await Promise.all([0, 1, 2].map(() => claimLearnerAssessment()))).filter(Boolean)
      learnerUsage.push(...claims.map(c => c!.leaseToken))
      expect(claims).toHaveLength(2)
      expect(await prisma.interviewAssessment.count({ where: { status: 'PENDING', snapshot: { ownerId: owner } } })).toBe(1)
    } finally { await prisma.interviewAnswerSnapshot.deleteMany({ where: { id: { in: adminRows } } }) }
  })
  it('cancels queued and running learner work when the capability is disabled through the Admin endpoint', async () => {
    await enableLearner()
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer)); const saved = await finish(r.id, a.id)
    const next = await prepareBankAttempt(r.id, owner); await markQuestionAsked(next.id, { segmentId: s.id, questionText: next.question.text })
    await captureCommittedTurn(next.id, turn(s.id, testAnswer, 1)); const queued = await finish(r.id, next.id)
    const running = await learnerClaim(); expect(running.snapshotId).toBe(saved.id)
    const reply = await request(app).put('/flags/interview_adaptive').auth(token(admin, 'SUPER_ADMIN'), { type: 'bearer' }).send({ disabled: true })
    expect(reply.status).toBe(200)
    for (const id of [saved.id!, queued.id!]) expect(await prisma.interviewAssessment.findUnique({ where: { snapshotId: id } })).toMatchObject({ status: 'CANCELLED', result: null, leaseToken: null })
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: running.leaseToken } })).toMatchObject({ outcome: 'CANCELLED', inputTokens: null })
    await finishLearnerAssessment(running, { result: correctEvaluation(), inputTokens: 100, outputTokens: 30, latencyMs: 5 })
    expect(await prisma.interviewAssessment.findUnique({ where: { id: running.id } })).toMatchObject({ status: 'CANCELLED', result: null })
    expect(await prisma.interviewEvaluatorUsage.findUnique({ where: { invocationKey: running.leaseToken } })).toMatchObject({ outcome: 'SUCCESS', inputTokens: 100 })
  })
  it('distinguishes open answers in an evaluated run from a capture-only run', async () => {
    const legacy = await asked()
    expect((await request(app).get(`/practice/runs/${legacy.r.id}/assessments`).auth(token(owner), { type: 'bearer' })).body.assessments[0].status).toBe('NOT_ENABLED')
    await endPractice(legacy.r.id, owner)
    await enableLearner()
    const { r } = await asked()
    // During practice an evaluated run reveals nothing; an open answer left at End reads as incomplete.
    expect((await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })).body.assessments[0].status).toBe('AFTER_PRACTICE')
    await endPractice(r.id, owner)
    expect((await request(app).get(`/practice/runs/${r.id}/assessments`).auth(token(owner), { type: 'bearer' })).body.assessments[0].status).toBe('INCOMPLETE')
  })
  it('pins conversation mode only with Interview conversation access and falls back to manual when it is revoked', async () => {
    const manual = await asked()
    expect((await practiceDetail(manual.r.id, owner)).conversationMode).toBe(false)
    expect((await voiceState(manual.r.sessionId, manual.s.id, manual.s.roomName, `user_${owner}`)).conversation).toEqual({ enabled: false, policy: null })
    await endPractice(manual.r.id, owner)
    await enableConversation()
    expect((await request(app).get('/practice/options').auth(token(owner), { type: 'bearer' })).body.conversationAvailable).toBe(true)
    const { r, a, s } = await asked()
    expect((await prisma.interviewRun.findUniqueOrThrow({ where: { id: r.id } })).conversationPolicySnapshot).toMatchObject({ version: 'conversation-1', handoffSilenceMs: 5000 })
    expect((await practiceDetail(r.id, owner)).conversationMode).toBe(true)
    let state = await voiceState(r.sessionId, s.id, s.roomName, `user_${owner}`)
    expect(state).toMatchObject({ conversation: { enabled: true, policy: { version: 'conversation-1' } }, attemptHasSpeech: false, unfinishedReceipt: null })
    await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    expect((await voiceState(r.sessionId, s.id, s.roomName, `user_${owner}`)).attemptHasSpeech).toBe(true)
    // Revoking only the conversation grant keeps the practice usable in manual mode.
    await request(app).put(`/flags/interview_conversation/grants/${owner}`).auth(token(admin, 'SUPER_ADMIN'), { type: 'bearer' }).send({ granted: false })
    state = await voiceState(r.sessionId, s.id, s.roomName, `user_${owner}`)
    expect(state.conversation.enabled).toBe(false)
    // The browser follows the same rule, so it shows manual controls to match the manual agent.
    expect((await practiceDetail(r.id, owner)).conversationMode).toBe(false)
    expect((await finish(r.id, a.id)).status).toBe('ANSWERED')
  })
  it('never offers an older completion receipt once the learner has said more for that answer', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    await receipt(a.id, s.id)
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    const next = await segment(r.sessionId, 1)
    await captureCommittedTurn(a.id, turn(next.id, 'More after reconnecting.'))
    expect((await voiceState(r.sessionId, next.id, next.roomName, `user_${owner}`)).unfinishedReceipt).toBeNull()
  })
  it('lets a FINISH receipt complete an answer whose segment closed before the finish call', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    const ack = await receipt(a.id, s.id)
    // Reload or disconnect: the open segment closes while the attempt is still ASKED.
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    expect((await prisma.sessionSegment.findUniqueOrThrow({ where: { id: s.id } })).interviewDrainAttemptId).toBe(a.id)
    expect((await voiceState(r.sessionId, (await segment(r.sessionId, 1)).id, (await prisma.sessionSegment.findFirstOrThrow({ where: { sessionId: r.sessionId, segmentIndex: 1 } })).roomName, `user_${owner}`)).unfinishedReceipt)
      .toMatchObject({ id: ack.id, action: 'FINISH', segmentId: s.id })
    const saved = await finishAnswer(r.id, a.id, owner, false, ack.id)
    expect(saved).toMatchObject({ status: 'ANSWERED', answerText: testAnswer })
  })
  it('still blocks Finish while a closed segment without a FINISH receipt may hold unsaved speech', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    const next = await segment(r.sessionId, 1)
    const ack = await receipt(a.id, next.id)
    await expect(finishAnswer(r.id, a.id, owner, false, ack.id)).rejects.toMatchObject({ status: 409 })
  })
  it('advances only from the named attempt and returns the existing next question on a repeat', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
    await expect(prepareBankAttempt(r.id, owner, a.id)).rejects.toMatchObject({ code: 'ANSWER_OPEN' })
    await finish(r.id, a.id)
    const second = await prepareBankAttempt(r.id, owner, a.id)
    expect(second.index).toBe(2)
    expect((await prepareBankAttempt(r.id, owner, a.id)).id).toBe(second.id)
    expect((await request(app).post(`/practice/runs/${r.id}/next`).auth(token(owner), { type: 'bearer' }).send({ afterAttemptId: a.id })).body.id).toBe(second.id)
    await expect(prepareBankAttempt(r.id, owner, 'not-an-attempt')).rejects.toMatchObject({ code: 'STALE_ADVANCE' })
    await markQuestionAsked(second.id, { segmentId: s.id, questionText: second.question.text })
    await finish(r.id, second.id, true)
    await expect(prepareBankAttempt(r.id, owner, a.id)).rejects.toMatchObject({ code: 'STALE_ADVANCE' })
    // Without a precondition the existing learner contract is unchanged.
    expect((await request(app).post(`/practice/runs/${r.id}/next`).auth(token(owner), { type: 'bearer' }).send({})).status).toBe(409)
  })
  it('exposes internal finish and next only for conversation-enabled runs, independent of evaluation', async () => {
    const previousToken = process.env.INTERNAL_AGENT_TOKEN
    process.env.INTERNAL_AGENT_TOKEN = `${fixture}-internal`
    const agent = (path: string, body: unknown) => request(app).post(`/agent${path}`).set('x-internal-agent-token', `${fixture}-internal`).send(body)
    try {
      const manual = await asked(); await captureCommittedTurn(manual.a.id, turn(manual.s.id, testAnswer))
      const manualAck = await receipt(manual.a.id, manual.s.id)
      const refused = await agent(`/attempts/${manual.a.id}/finish`, { receiptId: manualAck.id })
      expect(refused.status).toBe(403); expect(refused.body.code).toBe('CONVERSATION_UNAVAILABLE')
      await endPractice(manual.r.id, owner)
      // Evaluation is pinned but its budget is exhausted: progression must not depend on it.
      await enableLearner(); await enableConversation()
      await prisma.interviewEvaluatorBudget.upsert({ where: { scope_day: { scope: `learner-${hash(owner)}`, day: learnerDay() } },
        create: { scope: `learner-${hash(owner)}`, day: learnerDay(), used: LEARNER_LIMITS.perUser }, update: { used: LEARNER_LIMITS.perUser } })
      const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, testAnswer))
      const ack = await receipt(a.id, s.id)
      const done = await agent(`/attempts/${a.id}/finish`, { receiptId: ack.id })
      expect(done.status).toBe(200); expect(done.body).toMatchObject({ status: 'ANSWERED', reused: false }); expect(done.body.ownerId).toBeUndefined()
      expect((await agent(`/attempts/${a.id}/finish`, { receiptId: ack.id })).body.reused).toBe(true)
      expect(await prisma.interviewAssessment.findFirst({ where: { snapshot: { attemptId: a.id } } })).toMatchObject({ status: 'FAILED', errorCode: 'EVALUATION_USER_BUDGET_REACHED' })
      const next = await agent(`/runs/${r.id}/next`, { afterAttemptId: a.id })
      expect(next.status).toBe(200); expect(next.body.index).toBe(2)
      expect((await agent(`/runs/${r.id}/next`, { afterAttemptId: a.id })).body.id).toBe(next.body.id)
      expect((await agent(`/runs/${r.id}/next`, {})).status).toBe(400)
    } finally {
      if (previousToken === undefined) delete process.env.INTERNAL_AGENT_TOKEN
      else process.env.INTERNAL_AGENT_TOKEN = previousToken
    }
  })
  it('creates, retries and reads a multi-selection run through PostgreSQL, including long combined tracks', async () => {
    const longTrack = `${fixture}-${'long-track-'.repeat(9)}`
    const q = await createQuestion({ namespace: 'automation-pilot', externalQid: `${fixture}-multi` },
      { ...readyDraft(), track: longTrack, difficulty: 'Simple', experienceBand: '0-2' }, admin)
    questions.push(q)
    await confirmProvenance({ questions: [{ id: q, revision: 1 }], confirmed: true, note: 'Original disposable multi-selection integration test content.' }, admin)
    await questionAction(q, 1, 'approve_activate', admin)
    const body = { ...setup(), track: [longTrack, fixture], experienceBand: ['2-5', '0-2'], startingDifficulty: ['Medium', 'Simple'] }
    const response = await request(app).post('/practice/runs').auth(token(owner), { type: 'bearer' }).send(body)
    expect(response.status).toBe(201)
    const r = response.body
    expect((await startPractice({ ...body, track: [fixture, longTrack, fixture], startingDifficulty: ['Simple', 'Medium'] }, owner)).id).toBe(r.id)
    const detail = await practiceDetail(r.id, owner)
    expect(detail.track.length).toBeGreaterThan(120)
    expect(detail.track.split('|')).toEqual([fixture, longTrack].sort())
    expect(detail.startingDifficulty).toBe('Medium|Simple')
    const s = await segment(r.sessionId)
    const selected = []
    for (let i = 0; i < 3; i++) {
      const a = await prepareBankAttempt(r.id, owner)
      selected.push(a.question.track)
      expect(['Simple', 'Medium']).toContain(a.question.difficulty)
      expect([fixture, longTrack]).toContain(a.question.track)
      await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
      await finish(r.id, a.id, true)
    }
    expect(selected).toContain(longTrack)
    expect((await practiceHistory(owner)).runs.find(h => h.id === r.id)?.startingDifficulty).toBe(detail.startingDifficulty)
    await expect(prepareBankAttempt(r.id, owner)).rejects.toMatchObject({ code: 'QUESTION_BANK_EXHAUSTED' })
  })
  it('rejects malformed stored selections independently of request parsing', async () => {
    const rows = await prisma.$queryRaw<Array<{ empty: boolean; duplicate: boolean; invalid: boolean; valid: boolean }>>`
      SELECT public.valid_interview_selection('Simple|', ARRAY['Simple','Medium'], 4, 12) AS empty,
        public.valid_interview_selection('Simple|Simple', ARRAY['Simple','Medium'], 4, 12) AS duplicate,
        public.valid_interview_selection('Simple|Unknown', ARRAY['Simple','Medium'], 4, 12) AS invalid,
        public.valid_interview_selection('Medium|Simple', ARRAY['Simple','Medium'], 4, 12) AS valid`
    expect(rows[0]).toEqual({ empty: false, duplicate: false, invalid: false, valid: true })
  })
  it('uses server purpose and current rollout/grants; deduplicates concurrent starts', async () => {
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { disabled: true } })
    await expect(run()).rejects.toMatchObject({ status: 403 })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { disabled: false } })
    await prisma.userFeatureGrant.deleteMany({ where: { userId: owner, feature: 'interviews' } })
    await expect(run()).rejects.toMatchObject({ status: 403 })
    await prisma.userFeatureGrant.create({ data: { userId: owner, feature: 'interviews' } })
    const body = setup(); const [a, b] = await Promise.all([startPractice(body, owner), startPractice(body, owner)])
    expect(a.id).toBe(b.id); expect([a.reused, b.reused].sort()).toEqual([false, true])
    const session = await prisma.session.findUniqueOrThrow({ where: { id: a.sessionId } })
    expect(session).toMatchObject({ purpose: 'INTERVIEW', contextScope: 'SESSION_ONLY', sessionPointsAwarded: false })
    expect(isPulseEligible(session)).toBe(false)
    await expect(startPractice({ ...body, purpose: 'COMMUNICATION' }, owner)).rejects.toThrow()
    await expect(startPractice({ ...body, track: 'changed' }, owner)).rejects.toMatchObject({ status: 409 })
    await expect(run()).rejects.toMatchObject({ status: 409 })
    await expect(startPractice(body, other)).rejects.toMatchObject({ status: 404 })
  })
  it('limits the Session ownership trigger to policy columns and still rejects ownership changes', async () => {
    const columns = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT a.attname AS name FROM pg_trigger t
      JOIN pg_attribute a ON a.attrelid=t.tgrelid AND a.attnum=ANY(t.tgattr::smallint[])
      WHERE t.tgname='Session_interview_run_policy' ORDER BY a.attname`
    expect(columns.map(c => c.name)).toEqual(['contextScope', 'module', 'purpose', 'userId'])
    const r = await run()
    await prisma.session.update({ where: { id: r.sessionId }, data: { sessionName: 'Renamed practice', viewCount: 1 } })
    await expect(prisma.session.update({ where: { id: r.sessionId }, data: { userId: other } })).rejects.toThrow()
  })
  it('retains Interviews without releasing the owner’s retained Elevate session', async () => {
    const r = await run()
    const communication = await prisma.session.create({ data: { userId: owner, module: 'elevate', purpose: 'COMMUNICATION', retainedAt: new Date() } })
    const earlierInterview = await prisma.session.create({ data: { userId: owner, module: 'elevate', purpose: 'INTERVIEW', retainedAt: new Date() } })
    const res = await request(app).put(`/retain/${r.sessionId}`).auth(token(owner), { type: 'bearer' }).send({ retain: true })
    expect(res.status).toBe(200)
    expect(res.body.releasedSessionIds).toEqual([earlierInterview.id])
    expect((await prisma.session.findUniqueOrThrow({ where: { id: communication.id } })).retainedAt).not.toBeNull()
    expect((await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).retainedAt).not.toBeNull()
    const back = await request(app).put(`/retain/${communication.id}`).auth(token(owner), { type: 'bearer' }).send({ retain: true })
    expect(back.status).toBe(200); expect(back.body.releasedSessionIds).toEqual([])
    expect((await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).retainedAt).not.toBeNull()
  })
  it('separates authenticated learner actions from internal speech/assistance producers', async () => {
    expect((await request(app).post('/practice/runs').send(setup())).status).toBe(401)
    const r = await run(); const a = await prepareBankAttempt(r.id, owner); const s = await segment(r.sessionId)
    const body = { segmentId: s.id, questionText: a.question.text }
    expect((await request(app).post(`/agent/attempts/${a.id}/asked`).auth(token(owner), { type: 'bearer' }).send(body)).status).toBe(401)
    const previousToken = process.env.INTERNAL_AGENT_TOKEN
    process.env.INTERNAL_AGENT_TOKEN = `${fixture}-internal`
    try {
      expect((await request(app).post(`/agent/attempts/${a.id}/asked`).set('x-internal-agent-token', `${fixture}-internal`).send(body)).status).toBe(200)
      expect((await request(app).post(`/practice/runs/${r.id}/attempts/${a.id}/finish`).auth(token(owner), { type: 'bearer' }).send({ skip: true, assistance: 'NONE' })).status).toBe(400)
      expect((await request(app).get(`/practice/runs/${r.id}`).auth(token(other, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(404)
      expect((await request(app).post(`/practice/runs/${r.id}/attempts/${a.id}/finish`).auth(token(owner), { type: 'bearer' }).send({ skip: true, receiptId: (await receipt(a.id,s.id,'SKIP')).id })).status).toBe(200)
    } finally {
      if (previousToken === undefined) delete process.env.INTERNAL_AGENT_TOKEN
      else process.env.INTERNAL_AGENT_TOKEN = previousToken
    }
  })
  it('returns learner-safe captured questions; keeps them stable across bank edits', async () => {
    const r = await run(); const a = await prepareBankAttempt(r.id, owner)
    const b = await prepareBankAttempt(r.id, owner); expect(a.id).toBe(b.id)
    expect(JSON.stringify(a)).not.toContain('Fresh fixtures'); expect(a).not.toHaveProperty('questionSnapshot')
    const selected = await prisma.interviewAttempt.findUniqueOrThrow({ where: { id: a.id } })
    const q = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id: selected.questionId! } })
    await editQuestion(q.id, q.revision, { ...readyDraft(), track: fixture, questionText: 'A newly edited bank question?' }, admin)
    expect((await prepareBankAttempt(r.id, owner)).question.text).toBe(a.question.text)
    await expect(prisma.interviewAttempt.update({ where: { id: a.id }, data: { questionSnapshot: {} } })).rejects.toThrow()
    await expect(prisma.session.update({ where: { id: r.sessionId }, data: { purpose: 'COMMUNICATION' } })).rejects.toThrow()
    // Restore eligibility for subsequent tests, without restoring old revisions.
    const changed = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id: q.id } })
    await confirmProvenance({ questions: [{ id: q.id, revision: changed.revision }], confirmed: true, note: 'Original test content edited solely for capture immutability verification.' }, admin)
    await questionAction(q.id, changed.revision, 'approve_activate', admin)
  })
  it('stitches multiple final turns in segment order across resume without ID collisions', async () => {
    const { r, a, s } = await asked()
    const first = await captureCommittedTurn(a.id, turn(s.id, 'First part.'))
    expect(await captureCommittedTurn(a.id, turn(s.id, 'First part.'))).toMatchObject({ id: first.id, reused: true })
    await captureCommittedTurn(a.id, turn(s.id, 'Second part.', 1))
    expect((await prisma.interviewAttempt.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ASKED')
    await receipt(a.id,s.id,'PAUSE')
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    const resumed = await segment(r.sessionId, 1)
    await captureCommittedTurn(a.id, turn(resumed.id, 'After reconnect.'))
    await recordAssistance(a.id, { assistance: 'EXAMPLE' }); await recordAssistance(a.id, { assistance: 'HINT' })
    const ack=await receipt(a.id,resumed.id)
    const results = await Promise.all([finishAnswer(r.id, a.id, owner,false,ack.id), finishAnswer(r.id, a.id, owner,false,ack.id)])
    expect(results[0].id).toBe(results[1].id)
    const snapshot = await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: results[0].id! } })
    expect(snapshot).toMatchObject({ source: 'LIVE_ATTEMPT', textSource: 'AGENT_COMMITTED_TURNS', textRevision: 1,
      answerText: 'First part.\nSecond part.\nAfter reconnect.', assistance: 'EXAMPLE', ownerId: owner })
    expect(snapshot.answerHash).toBe(hash(snapshot.answerText))
    expect(await prisma.interviewAssessment.count({ where: { snapshotId: snapshot.id } })).toBe(0)
    await expect(prisma.interviewAnswerSnapshot.update({ where: { id: snapshot.id }, data: { answerText: 'rewrite' } })).rejects.toThrow()
    await expect(captureCommittedTurn(a.id, turn(resumed.id, 'late', 1))).rejects.toMatchObject({ status: 409 })
    expect((await captureCommittedTurn(a.id, turn(s.id, 'First part.'))).reused).toBe(true)
    await endPractice(r.id, owner)
    const playback = await request(app).get(`/sessions/${r.sessionId}/turns`).auth(token(owner), { type: 'bearer' })
    expect(playback.status).toBe(200)
    expect(playback.body.session.purpose).toBe('INTERVIEW')
    expect(playback.body.interviewConversation.map((m: { content: string }) => m.content))
      .toEqual([a.question.text, 'First part. Second part. After reconnect.'])
    // Grouping is a read-only presentation; every original chunk remains.
    expect(playback.body.turns.filter((t: { role: string }) => t.role === 'user')).toHaveLength(3)
    expect(JSON.stringify(playback.body.interviewConversation)).not.toMatch(/privateRubric|goodAnswerPoints|misconceptions/)
    expect((await request(app).get(`/sessions/${r.sessionId}/turns`).auth(token(other, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(404)
    await prisma.user.update({ where: { id: owner }, data: { hideTranscriptText: true } })
    try {
      const hidden = await request(app).get(`/sessions/${r.sessionId}/turns`).auth(token(owner), { type: 'bearer' })
      expect(hidden.status).toBe(200)
      expect(hidden.body.interviewConversation.every((m: { content: string }) => m.content === '')).toBe(true)
    } finally {
      await prisma.user.update({ where: { id: owner }, data: { hideTranscriptText: false } })
    }
  })
  it('rejects cross-user reads/finish and unrelated or closed segment speech', async () => {
    const { r, a, s } = await asked()
    await expect(practiceDetail(r.id, other)).rejects.toMatchObject({ status: 404 })
    await expect(finishAnswer(r.id, a.id, other)).rejects.toMatchObject({ status: 404 })
    const foreignSession = await prisma.session.create({ data: { userId: other, module: 'elevate' } })
    const foreignSegment = await segment(foreignSession.id)
    await expect(captureCommittedTurn(a.id, turn(foreignSegment.id, 'foreign'))).rejects.toMatchObject({ status: 409 })
    await expect(prisma.interviewAnswerChunk.create({ data: { attemptId: a.id, segmentId: foreignSegment.id, text: 'foreign', localTurnIndex: 0, sourceTurnId: 'x' } })).rejects.toThrow()
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    await captureCommittedTurn(a.id, turn(s.id, 'Within bounded disconnect drain'))
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { interviewDrainUntil: new Date(Date.now()-1) } })
    await expect(captureCommittedTurn(a.id, turn(s.id, 'late',1))).rejects.toMatchObject({ status: 409 })
  })
  it('requires exact saved wording and explicit finish or skip; never fabricates an abstention', async () => {
    const r = await run(); const a = await prepareBankAttempt(r.id, owner); const s = await segment(r.sessionId)
    await expect(markQuestionAsked(a.id, { segmentId: s.id, questionText: 'Different question?' })).rejects.toMatchObject({ status: 409 })
    await expect(captureCommittedTurn(a.id, turn(s.id, 'too early'))).rejects.toMatchObject({ status: 409 })
    await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
    await expect(finishAnswer(r.id, a.id, owner)).rejects.toMatchObject({ status: 409 })
    expect(await finish(r.id, a.id, true)).toMatchObject({ status: 'SKIPPED', id: null })
    expect(await prisma.interviewAnswerSnapshot.count({ where: { attemptId: a.id } })).toBe(0)
    const next = await prepareBankAttempt(r.id, owner); expect(next.id).not.toBe(a.id)
    expect(next.index).toBe(2)
    await markQuestionAsked(next.id, { segmentId: s.id, questionText: next.question.text })
    await endPractice(r.id, owner)
    const playback = await request(app).get(`/sessions/${r.sessionId}/turns`).auth(token(owner), { type: 'bearer' })
    expect(playback.status).toBe(200)
    expect(playback.body.interviewConversation).toEqual([
      expect.objectContaining({ content: a.question.text, role: 'assistant', attemptStatus: 'SKIPPED' }),
      expect.objectContaining({ content: next.question.text, role: 'assistant', attemptStatus: 'INCOMPLETE' }),
    ])
    expect(await prisma.interviewAssessment.count({ where: { snapshot: { attemptId: { in: [a.id, next.id] } } } })).toBe(0)
  })
  it('rejects conflicting retries, non-user turns, silent truncation and overwritten chunks', async () => {
    const { a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'x'.repeat(7999)))
    await expect(captureCommittedTurn(a.id, turn(s.id, 'different'))).rejects.toMatchObject({ status: 409 })
    await expect(captureCommittedTurn(a.id, { ...turn(s.id, 'different'), sourceTurnId: 'other-id' })).rejects.toMatchObject({ status: 409 })
    await expect(captureCommittedTurn(a.id, { ...turn(s.id, 'assistant', 1), role: 'assistant' })).rejects.toThrow()
    await expect(captureCommittedTurn(a.id, turn(s.id, 'extra', 1))).rejects.toMatchObject({ status: 413 })
    const c = await prisma.interviewAnswerChunk.findFirstOrThrow({ where: { attemptId: a.id } })
    await expect(prisma.interviewAnswerChunk.update({ where: { id: c.id }, data: { text: 'overwrite' } })).rejects.toThrow()
  })
  it('fences discarded sessions, even for retries or reads with the flag disabled', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'saved'))
    await prisma.session.update({ where: { id: r.sessionId }, data: { discardedAt: new Date() } })
    await expect(captureCommittedTurn(a.id, turn(s.id, 'saved'))).rejects.toMatchObject({ status: 410 })
    await expect(finishAnswer(r.id, a.id, owner)).rejects.toMatchObject({ status: 410 })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { disabled: true } })
    await expect(practiceDetail(r.id, owner)).rejects.toMatchObject({ status: 410 })
  })
  it('blocks forged live snapshots and recordings and cascades owned capture on session deletion', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Exact answer'))
    const completed = await finish(r.id, a.id)
    const saved = await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: completed.id! } })
    const { id: _id, createdAt: _at, ...payload } = saved
    await expect(prisma.interviewAnswerSnapshot.create({ data: { ...payload, ownerId: other } })).rejects.toThrow()
    await expect(prisma.interviewAnswerSnapshot.create({ data: { ...payload, source: 'RECORDING', attemptId: null } })).rejects.toThrow()
    await prisma.session.delete({ where: { id: r.sessionId } })
    expect(await prisma.interviewRun.count({ where: { id: r.id } })).toBe(0)
    expect(await prisma.interviewAnswerChunk.count({ where: { attemptId: a.id } })).toBe(0)
    expect(await prisma.interviewAnswerSnapshot.count({ where: { id: saved.id } })).toBe(0)
  })
  it('allows owned history/end after access withdrawal without writing points or inventing grades', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Saved answer'))
    await finish(r.id, a.id)
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { disabled: true } })
    await expect(prepareBankAttempt(r.id, owner)).rejects.toMatchObject({ status: 403 })
    expect((await practiceDetail(r.id, owner)).attempts[0].answer?.answerText).toBe('Saved answer')
    expect((await endPractice(r.id, owner)).reused).toBe(false)
    expect((await endPractice(r.id, owner)).reused).toBe(true)
    expect(await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).toMatchObject({ sessionPointsAwarded: false, progressPulseStatus: 'skipped' })
  })
  it('keeps the Admin worker and Super Admin test reports isolated from learner assessments', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Saved answer'))
    const capture = await finish(r.id, a.id)
    const pending = await prisma.interviewAssessment.create({ data: { snapshotId: capture.id!, inputKey: randomUUID(), config: {} } })
    await expect(assessmentDetail(pending.id, admin)).rejects.toMatchObject({ status: 404 })
    const flag = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interview_evaluator' } })
    try {
      await prisma.platformFeatureFlag.upsert({ where: { feature: 'interview_evaluator' }, create: { feature: 'interview_evaluator', label: 'Test', enabled: true, hidden: false, disabled: false }, update: { hidden: false, disabled: false, enabled: true } })
      expect(await claimAssessment()).toBeNull()
      expect((await prisma.interviewAssessment.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('PENDING')
    } finally {
      if (flag) await prisma.platformFeatureFlag.update({ where: { feature: 'interview_evaluator' }, data: { hidden: flag.hidden, disabled: flag.disabled, enabled: flag.enabled } })
      else await prisma.platformFeatureFlag.delete({ where: { feature: 'interview_evaluator' } })
    }
  })
  it('cascades an account deletion through sessions, attempts, speech and snapshots', async () => {
    const u = await prisma.user.create({ data: { email: `${fixture}-deleted@example.invalid` } }); users.push(u.id)
    for (const feature of ['interviews','interview_voice']) await prisma.userFeatureGrant.create({ data: { userId: u.id, feature } })
    const r = await startPractice(setup(), u.id); const a = await prepareBankAttempt(r.id, u.id); const s = await segment(r.sessionId)
    await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
    await captureCommittedTurn(a.id, turn(s.id, 'Delete this answer'))
    const ack = await receipt(a.id,s.id)
    const capture = await finishAnswer(r.id, a.id, u.id,false,ack.id)
    await prisma.user.delete({ where: { id: u.id } })
    expect(await prisma.interviewAttempt.count({ where: { id: a.id } })).toBe(0)
    expect(await prisma.interviewAnswerChunk.count({ where: { attemptId: a.id } })).toBe(0)
    expect(await prisma.interviewAnswerSnapshot.count({ where: { id: capture.id! } })).toBe(0)
  })
  it('excludes active duplicate namespaces and unconfirmed content rather than silently substituting questions', async () => {
    for (const id of [questionId, alternate]) {
      await prisma.questionBankQuestion.update({ where: { id }, data: { provenanceConfirmedAt: null, provenanceConfirmedById: null, provenanceNote: '' } })
    }
    try {
      // The otherwise eligible C fixture has the same track, but is outside automation-pilot.
      await expect(run()).rejects.toMatchObject({ status: 409 })
      expect(await prisma.interviewRun.count({ where: { ownerId: owner } })).toBe(0)
    } finally {
      for (const id of [questionId, alternate]) {
        const q = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id } })
        await confirmProvenance({ confirmed: true, note: 'Original disposable test content; restoring deliberately removed test confirmation.', questions: [{ id, revision: q.revision }] }, admin)
      }
    }
  })
  it('stops new questions at the duration limit while allowing the current answer to finish', async () => {
    const { r, a, s } = await asked()
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 11 * 60_000) } })
    expect((await prepareBankAttempt(r.id, owner)).id).toBe(a.id)
    await captureCommittedTurn(a.id, turn(s.id, 'Finish this answer'))
    await finish(r.id, a.id)
    await expect(prepareBankAttempt(r.id, owner)).rejects.toMatchObject({ status: 409, code: 'PRACTICE_DURATION_REACHED' })
  })
  it('reports exhausted bank coverage as normal completion without losing completed answers', async () => {
    const { r, a, s } = await asked()
    await captureCommittedTurn(a.id, turn(s.id, 'First answer.'))
    await finish(r.id, a.id)
    const second = await prepareBankAttempt(r.id, owner)
    await markQuestionAsked(second.id, { segmentId: s.id, questionText: second.question.text })
    await captureCommittedTurn(second.id, turn(s.id, 'Second answer.', 1))
    const ack = await receipt(second.id, s.id)
    await finishAnswer(r.id, second.id, owner, false, ack.id)
    const response = await request(app).post(`/practice/runs/${r.id}/next`).auth(token(owner), { type: 'bearer' }).send({})
    expect(response.status).toBe(409)
    expect(response.body.code).toBe('QUESTION_BANK_EXHAUSTED')
    expect((await practiceDetail(r.id, owner)).attempts.map(attempt => attempt.status)).toEqual(['ANSWERED', 'ANSWERED'])
    // End closes a completed interview, rather than marking an answer incomplete.
    await endPractice(r.id, owner)
    expect((await practiceDetail(r.id, owner)).attempts.map(attempt => attempt.status)).toEqual(['ANSWERED', 'ANSWERED'])
  })
  it('fences legacy session paths and token access; permits owned history after rollout withdrawal', async () => {
    const {r,s}=await asked()
    const elevation=await prisma.platformFeatureFlag.findUnique({where:{feature:'elevate'}})
    try {
      await prisma.platformFeatureFlag.upsert({where:{feature:'elevate'},create:{feature:'elevate',label:'Test',hidden:false,disabled:true},update:{disabled:true}})
      invalidateFeatureFlagCache()
      expect((await request(app).get(`/sessions/${r.sessionId}`).auth(token(owner),{type:'bearer'})).status).toBe(200)
      expect((await request(app).get(`/sessions/${r.sessionId}`).auth(token(other,'SUPER_ADMIN'),{type:'bearer'})).status).toBe(404)
      expect((await request(app).get(`/sessions/${r.sessionId}?access_token=${token(owner)}`)).status).toBe(200)
      const req={user:{userId:owner}} as Parameters<typeof resolveLivekitAccess>[0]
      expect(await resolveLivekitAccess(req,{sessionId:r.sessionId,segmentId:s.id,room:s.roomName})).toMatchObject({identity:`user_${owner}`})
      await prisma.platformFeatureFlag.update({where:{feature:'interview_voice'},data:{disabled:true}})
      invalidateFeatureFlagCache()
      expect((await request(app).post(`/sessions/${r.sessionId}/segments`).auth(token(owner),{type:'bearer'}).send({})).status).toBe(403)
      expect(await resolveLivekitAccess(req,{sessionId:r.sessionId,segmentId:s.id,room:s.roomName})).toMatchObject({status:403})
      expect((await request(app).get(`/sessions/${r.sessionId}`).auth(token(owner),{type:'bearer'})).status).toBe(200)
      expect((await request(app).post(`/practice/runs/${r.id}/end`).auth(token(owner),{type:'bearer'}).send({})).status).toBe(200)
    } finally {
      if (elevation) await prisma.platformFeatureFlag.update({where:{feature:'elevate'},data:{disabled:elevation.disabled}})
      else await prisma.platformFeatureFlag.delete({where:{feature:'elevate'}})
      invalidateFeatureFlagCache()
    }
  })
  it('does not expose interview speech to privileged communication-chat callers or invent teaching',async()=> {
    const {r}=await asked()
    const original=await prisma.platformFeatureFlag.findUnique({where:{feature:'session_chat'}})
    try {
      await prisma.platformFeatureFlag.upsert({where:{feature:'session_chat'},create:{feature:'session_chat',label:'Chat test',hidden:false,disabled:false,enabled:true,audience:'EVERYONE'},update:{hidden:false,disabled:false,enabled:true,audience:'EVERYONE'}})
      invalidateFeatureFlagCache()
      const body={module:'elevate',sessionId:r.sessionId,messages:[{role:'user',content:'What is the right technical answer?'}]}
      expect((await request(app).post('/chat').auth(token(other,'SUPER_ADMIN'),{type:'bearer'}).send(body)).status).toBe(404)
      const response=await request(app).post('/chat').auth(token(owner),{type:'bearer'}).send(body)
      expect(response.status).toBe(409);expect(response.body.code).toBe('INTERVIEW_TEACHING_PENDING')
    } finally {
      if(original) await prisma.platformFeatureFlag.update({where:{feature:'session_chat'},data:{hidden:original.hidden,disabled:original.disabled,enabled:original.enabled,audience:original.audience}})
      else await prisma.platformFeatureFlag.delete({where:{feature:'session_chat'}})
      invalidateFeatureFlagCache()
    }
  })
  it('requires current voice access and consent, and latches the supported profile', async () => {
    const input=setup()
    await expect(startPractice({...input,recordingConsent:false},owner)).rejects.toThrow()
    await prisma.platformFeatureFlag.update({where:{feature:'interview_voice'},data:{disabled:true}})
    await expect(run()).rejects.toMatchObject({status:403})
    await prisma.platformFeatureFlag.update({where:{feature:'interview_voice'},data:{disabled:false}})
    const r=await run(); const a=await prepareBankAttempt(r.id,owner); const seg=await segment(r.sessionId)
    const stored=await prisma.interviewRun.findUniqueOrThrow({where:{id:r.id}})
    expect(stored.recordingConsentAt).not.toBeNull()
    expect(stored.voiceConfigSnapshot).toMatchObject({backend:'pipeline-bedrock',sttProvider:'transcribe',ttsProvider:'polly'})
    await expect(voiceState(r.sessionId,seg.id,seg.roomName,`user_${other}`)).rejects.toMatchObject({status:404})
    expect((await voiceState(r.sessionId,seg.id,seg.roomName,`user_${owner}`)).attempt.id).toBe(a.id)
    await prisma.voiceConfig.update({where:{id:testVoiceId},data:{sttProvider:'whisper'}})
    try {
      expect((await voiceState(r.sessionId,seg.id,seg.roomName,`user_${owner}`)).voiceProfile.sttProvider).toBe('transcribe')
      await endPractice(r.id,owner)
      await expect(run()).rejects.toMatchObject({status:409})
    } finally { await prisma.voiceConfig.update({where:{id:testVoiceId},data:{sttProvider:'transcribe'}}) }
  })
  it('requires the matching durable receipt and blocks speech after a finish barrier', async () => {
    const {r,a,s}=await asked(); await captureCommittedTurn(a.id,turn(s.id,'Stored first.'))
    await expect(finishAnswer(r.id,a.id,owner,false,randomUUID())).rejects.toMatchObject({status:409})
    await expect(saveCaptureReceipt(a.id,{id:randomUUID(),segmentId:s.id,action:'FINISH',lastTurnIndex:-1})).rejects.toMatchObject({status:409})
    const ack=await receipt(a.id,s.id)
    await expect(captureCommittedTurn(a.id,turn(s.id,'after receipt',1))).rejects.toMatchObject({status:409})
    await expect(finishAnswer(r.id,a.id,owner,true,ack.id)).rejects.toMatchObject({status:409})
    await finishAnswer(r.id,a.id,owner,false,ack.id)
    const again=await saveCaptureReceipt(a.id,{id:ack.id,segmentId:s.id,action:'FINISH',lastTurnIndex:0})
    expect(again.reused).toBe(true)
    await expect(saveCaptureReceipt(a.id,{id:ack.id,segmentId:s.id,action:'SKIP',lastTurnIndex:0})).rejects.toMatchObject({status:409})
  })
  it('will not finish across an unconfirmed old disconnect segment', async () => {
    const {r,a,s}=await asked(); await captureCommittedTurn(a.id,turn(s.id,'Before loss.'))
    await prisma.sessionSegment.update({where:{id:s.id},data:{endedAt:new Date()}})
    const resumed=await segment(r.sessionId,1)
    await captureCommittedTurn(a.id,turn(resumed.id,'After reconnect.'))
    const ack=await receipt(a.id,resumed.id)
    await expect(finishAnswer(r.id,a.id,owner,false,ack.id)).rejects.toMatchObject({status:409})
    await receipt(a.id,s.id,'PAUSE')
    await finishAnswer(r.id,a.id,owner,false,ack.id)
    await expect(prisma.sessionSegment.update({where:{id:s.id},data:{endedAt:null}})).rejects.toThrow()
  })
  it('end preserves confirmed speech as replay data and closes uncompleted answers honestly', async () => {
    const {r,a,s}=await asked(); await captureCommittedTurn(a.id,turn(s.id,'Confirmed but unfinished.'))
    await endPractice(r.id,owner)
    const report=await practiceDetail(r.id,owner)
    expect(report.attempts[0]).toMatchObject({status:'INCOMPLETE',completionReason:'USER_ENDED',capturedText:'Confirmed but unfinished.',answer:null})
    const transcript=await prisma.sessionTranscript.findUniqueOrThrow({where:{sessionId:r.sessionId}})
    expect(transcript.conversationData).toMatchObject({source:'interview-capture-1',messages:[{role:'assistant',content:a.question.text},{role:'user',content:'Confirmed but unfinished.'}]})
    const turns=await prisma.sessionTurn.findMany({where:{sessionId:r.sessionId},orderBy:{sequenceNo:'asc'}})
    expect(turns.map(t=>t.text)).toEqual([a.question.text,'Confirmed but unfinished.'])
    expect(turns.every(t=>t.audioStart===null && t.audioEnd===null)).toBe(true)
    expect((await practiceHistory(owner)).runs.some(row=>row.id===r.id)).toBe(true)
    expect((await practiceHistory(other)).runs.some(row=>row.id===r.id)).toBe(false)
  })
  it('prefers an unseen bank question after a completed practice', async () => {
    const first=await asked(); await receipt(first.a.id,first.s.id,'SKIP')
    await endPractice(first.r.id,owner)
    const r=await run(); const next=await prepareBankAttempt(r.id,owner)
    const previous=await prisma.interviewAttempt.findUniqueOrThrow({where:{id:first.a.id}})
    const following=await prisma.interviewAttempt.findUniqueOrThrow({where:{id:next.id}})
    expect(following.questionId).not.toBe(previous.questionId)
  })
  it('preserves captured answers/guidance if the mutable bank item is deleted', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Keep this answer'))
    const result = await finish(r.id, a.id)
    const attempt = await prisma.interviewAttempt.findUniqueOrThrow({ where: { id: a.id } })
    await prisma.questionBankQuestion.delete({ where: { id: attempt.questionId! } })
    const report = await practiceDetail(r.id, owner)
    expect(report.attempts[0].question.text).toBe(a.question.text)
    expect(report.attempts[0].answer?.answerText).toBe('Keep this answer')
    expect((await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: result.id! } })).questionId).toBeNull()
  })
})
