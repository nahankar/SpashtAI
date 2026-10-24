import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import express from 'express'
import request from 'supertest'
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Evaluator integration tests use only the isolated simple_bank database')
  return { url }
})
vi.mock('../src/lib/prisma', async () => { const { PrismaClient } = await import('@prisma/client'); return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) } })
import { prisma } from '../src/lib/prisma'
import { LEARNER_POLICIES, hash, parseResult } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, claimAssessment, deleteAssessment, enqueueAssessment, finishAssessment, retryAssessment } from '../src/interviews/evaluator/service'
import { EvaluationFailure } from '../src/interviews/evaluator/model'
import { readyDraft } from './fixtures/bank-draft'
import { correctEvaluation, testAnswer } from './fixtures/interview-evaluation'
import { createQuestion, editQuestion, confirmProvenance, questionAction } from '../src/interviews/bank/service'
import router from '../src/routes/admin/interview-evaluator'
import featureRouter from '../src/routes/admin/feature-flags'
import { requireAuth } from '../src/middleware/auth'
import { signToken } from '../src/lib/jwt'
const app = express(); app.use(express.json()); app.use('/eval', requireAuth, router); app.use('/flags', requireAuth, featureRouter)
const namespace = `eval_${randomUUID().replaceAll('-', '')}`
let actor: string; let other: string; let superAdmin: string; let questionId: string
let originalFlag: Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>
let originalGlobalBudget: Awaited<ReturnType<typeof prisma.interviewEvaluatorBudget.findUnique>>
const ids: string[] = []; const usageKeys: string[] = []
const token = (id = actor, role = 'ADMIN') => signToken({ userId: id, role, email: `${namespace}@example.invalid` })
const input = (answer = testAnswer) => ({ questionId, revision: 1, answer })
async function submit(answer = testAnswer, extra = {}) { return enqueueAssessment({ ...input(answer), ...extra }, actor) }
async function claim() { const job = await claimAssessment(); expect(job).not.toBeNull(); usageKeys.push(job!.leaseToken); return job! }
async function finish(job: Awaited<ReturnType<typeof claim>>, answer = testAnswer) { await finishAssessment(job, { result: correctEvaluation(answer), inputTokens: 100, outputTokens: 30, latencyMs: 25 }) }
describe.skipIf(!testDb.url)('durable Admin evaluator PostgreSQL contracts', () => {
  beforeAll(async () => {
    originalFlag = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interview_evaluator' } })
    originalGlobalBudget = await prisma.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: 'global', day: new Date().toISOString().slice(0,10) } } })
    await prisma.interviewEvaluatorBudget.upsert({ where: { scope_day: { scope: 'global', day: new Date().toISOString().slice(0,10) } }, create: { scope: 'global', day: new Date().toISOString().slice(0,10) }, update: { used: 0 } })
    await prisma.platformFeatureFlag.upsert({ where: { feature: 'interview_evaluator' }, create: { feature: 'interview_evaluator', label: 'Test', hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' }, update: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
    for (const [name, role] of [['owner','ADMIN'], ['other','ADMIN'], ['super','SUPER_ADMIN']] as const) {
      const user = await prisma.user.create({ data: { email: `${namespace}-${name}@example.invalid`, role } }); ids.push(user.id)
      await prisma.userFeatureGrant.create({ data: { userId: user.id, feature: 'interview_evaluator' } })
    }
    ;[actor, other, superAdmin] = ids
    questionId = await createQuestion({ namespace, externalQid: 'Q-1' }, { ...readyDraft(), topic: 'Isolation' }, actor)
  })
  afterEach(async () => {
    await prisma.interviewAnswerSnapshot.deleteMany({ where: { ownerId: { in: ids } } })
    await prisma.interviewEvaluatorBudget.deleteMany({ where: { scope: { in: ids.map(hash) } } })
    await prisma.user.update({ where: { id: actor }, data: { role: 'ADMIN' } })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_evaluator' }, data: { hidden: false, disabled: false, enabled: true } })
    await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: actor, feature: 'interview_evaluator' } }, create: { userId: actor, feature: 'interview_evaluator' }, update: {} })
  })
  afterAll(async () => {
    await prisma.questionBankQuestion.deleteMany({ where: { namespace } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
    await prisma.interviewEvaluatorUsage.deleteMany({ where: { invocationKey: { in: usageKeys } } })
    if (originalFlag) await prisma.platformFeatureFlag.update({ where: { feature: 'interview_evaluator' }, data: { hidden: originalFlag.hidden, disabled: originalFlag.disabled, enabled: originalFlag.enabled, audience: originalFlag.audience } })
    const globalKey = { scope: 'global', day: new Date().toISOString().slice(0,10) }
    if (originalGlobalBudget) await prisma.interviewEvaluatorBudget.update({ where: { scope_day: globalKey }, data: { used: originalGlobalBudget.used } })
    else await prisma.interviewEvaluatorBudget.deleteMany({ where: globalKey })
    await prisma.$disconnect()
  })
  it('requires current role and evaluator grant; rejects live sources', async () => {
    expect((await request(app).post('/eval/tests').send(input())).status).toBe(401)
    const stale = token(); await prisma.user.update({ where: { id: actor }, data: { role: 'USER' } })
    expect((await request(app).get('/eval/config').auth(stale, { type: 'bearer' })).status).toBe(403)
    expect((await request(app).put(`/flags/interview_evaluator/grants/${other}`).auth(stale, { type: 'bearer' }).send({ granted: true })).status).toBe(403)
    await prisma.user.update({ where: { id: actor }, data: { role: 'ADMIN' } })
    await prisma.userFeatureGrant.deleteMany({ where: { userId: actor, feature: 'interview_evaluator' } })
    expect((await request(app).post('/eval/tests').auth(stale, { type: 'bearer' }).send(input())).status).toBe(403)
    await prisma.userFeatureGrant.create({ data: { userId: actor, feature: 'interview_evaluator' } })
    expect((await request(app).get('/flags/interview_evaluator/grants').auth(stale, { type: 'bearer' })).status).toBe(200)
    expect((await request(app).post('/eval/tests').auth(stale, { type: 'bearer' }).send({ ...input(), source: 'LIVE_ATTEMPT' })).status).toBe(400)
  })
  it('deduplicates concurrent submissions, preserves authoritative inputs and assistance', async () => {
    const submitted = await Promise.all([submit(), submit()]); expect(submitted[0].id).toBe(submitted[1].id)
    const row = await assessmentDetail(submitted[0].id, actor)
    expect(row.snapshot).toMatchObject({ source: 'ADMIN_TEST', textSource: 'ADMIN_TYPED', textRevision: 1, attemptId: null, recordingId: null, answerText: testAnswer })
    expect(await prisma.interviewAnswerSnapshot.count({ where: { ownerId: actor } })).toBe(1)
    const another = await submit(testAnswer, { assistance: 'EXAMPLE' }); expect(another.id).not.toBe(row.id)
    await finish(await claim())
    const completed = await assessmentDetail(row.id, actor); expect(completed.status).toBe('COMPLETED')
    expect((completed.result as any).next.action).toBe('DEEPEN')
    await finish(await claim())
    expect((await assessmentDetail(another.id, actor)).result).toMatchObject({ afterExample: true, assistance: 'EXAMPLE' })
    expect((await submit()).reused).toBe(true)
    await expect(prisma.interviewAnswerSnapshot.update({ where: { id: row.snapshotId }, data: { answerText: 'Altered' } })).rejects.toThrow()
    await expect(prisma.interviewAnswerSnapshot.create({ data: { ownerId: actor, source: 'RECORDING', answerText: 'x', answerHash: 'x', questionHash: 'q', questionSnapshot: {} } })).rejects.toThrow()
  })
  it('restricts reads/deletion to owner or current Super Admin', async () => {
    const saved = await submit()
    expect((await request(app).get(`/eval/tests/${saved.id}`).auth(token(other), { type: 'bearer' })).status).toBe(404)
    expect((await request(app).delete(`/eval/tests/${saved.id}`).auth(token(other), { type: 'bearer' })).status).toBe(404)
    expect((await request(app).get(`/eval/tests/${saved.id}`).auth(token(superAdmin, 'SUPER_ADMIN'), { type: 'bearer' })).status).toBe(200)
    await deleteAssessment(saved.id, superAdmin)
    expect(await prisma.interviewAssessment.findUnique({ where: { id: saved.id } })).toBeNull()
  })
  it('persists validation notes and preserves old failed tests across evaluator upgrades', async () => {
    const old = await submit(); const oldJob = await claim()
    await finishAssessment(oldJob, new EvaluationFailure('INVALID_OUTPUT', false, { inputTokens: 100, outputTokens: 30, latencyMs: 25 }))
    const oldConfig = { ...(oldJob.config as any), prompt: 'interview-answer-2', schema: 'interview-result-1' }
    const { source, questionHash, answerHash, assistance, language, textSource, textRevision } = oldJob.snapshot
    await prisma.interviewAssessment.update({ where: { id: old.id }, data: { config: oldConfig,
      inputKey: hash({ ownerId: actor, source, questionHash, answerHash, config: oldConfig, assistance, language, textSource, textRevision }) } })
    expect(await assessmentDetail(old.id, actor)).toMatchObject({ configCurrent: false, status: 'FAILED', result: null })
    await expect(retryAssessment(old.id, actor)).rejects.toMatchObject({ status: 409 })
    const current = await submit(); expect(current.id).not.toBe(old.id)
    const output = correctEvaluation(); output.criteria[2].finding = 'NOT_MET'
    await finishAssessment(await claim(), { result: parseResult(JSON.stringify(output), testAnswer), inputTokens: 120, outputTokens: 40, latencyMs: 30 })
    const saved = await assessmentDetail(current.id, actor)
    expect(saved).toMatchObject({ configCurrent: true, status: 'COMPLETED', snapshot: { answerText: testAnswer } })
    expect(saved.result).toMatchObject({ validationNotes: [expect.stringContaining('Answer depth')], classification: 'CORRECT' })
    expect((await assessmentDetail(old.id, actor)).status).toBe('FAILED')
    expect((await submit()).id).toBe(current.id)
  })
  it('fences deleted content from a finishing worker while preserving anonymous usage', async () => {
    const saved = await submit(); const job = await claim()
    await deleteAssessment(saved.id, actor); await finish(job)
    expect(await prisma.interviewAssessment.findUnique({ where: { id: saved.id } })).toBeNull()
    const usage = await prisma.interviewEvaluatorUsage.findUniqueOrThrow({ where: { invocationKey: job.leaseToken } })
    expect(usage).toMatchObject({ assessmentId: null, inputTokens: 100, outputTokens: 30 })
    expect(JSON.stringify(usage)).not.toContain(testAnswer)
  })
  it('blocks processing and late writes when access is revoked', async () => {
    const saved = await submit(); const job = await claim()
    await prisma.userFeatureGrant.deleteMany({ where: { userId: actor, feature: 'interview_evaluator' } })
    await finish(job)
    expect(await assessmentDetail(saved.id, actor)).toMatchObject({ status: 'CANCELLED', result: null })
    await expect(retryAssessment(saved.id, actor)).rejects.toMatchObject({ status: 403 })
    await prisma.platformFeatureFlag.update({ where: { feature: 'interview_evaluator' }, data: { disabled: true, enabled: false } })
    expect(await claimAssessment()).toBeNull()
  })
  it('caps concurrent leases, fences expired leases, and bounds timeout retries', async () => {
    await submit('One'); await submit('Two'); await submit('Three')
    const jobs = await Promise.all([claimAssessment(), claimAssessment(), claimAssessment()])
    expect(jobs.filter(Boolean)).toHaveLength(2); jobs.filter(Boolean).forEach(j => usageKeys.push(j!.leaseToken))
    const job = jobs.find(Boolean)!
    await prisma.interviewAssessment.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } })
    const replacement = await claimAssessment(); if (replacement) usageKeys.push(replacement.leaseToken)
    await finish(job, job.snapshot.answerText)
    expect((await assessmentDetail(job.id, actor)).status).toBe('FAILED')
    // Clear other jobs so a retried job is the next queued item.
    await prisma.interviewAnswerSnapshot.deleteMany({ where: { ownerId: actor, id: { not: job.snapshotId } } })
    await retryAssessment(job.id, actor)
    const retry = await claim(); await finishAssessment(retry, new EvaluationFailure('TIMEOUT', true, { inputTokens: 0, outputTokens: 0, latencyMs: 20_000 }))
    await prisma.interviewAssessment.update({ where: { id: job.id }, data: { nextAt: new Date(0) } })
    const last = await claim(); await finishAssessment(last, new EvaluationFailure('TIMEOUT', true, { inputTokens: 0, outputTokens: 0, latencyMs: 20_000 }))
    expect(await assessmentDetail(job.id, actor)).toMatchObject({ status: 'FAILED', attempts: 3, errorCode: 'TIMEOUT', result: null })
    await expect(retryAssessment(job.id, actor)).rejects.toMatchObject({ status: 409 })
  })
  it('switches to an active different topic for abstentions and never invents a fallback', async () => {
    const nextId = await createQuestion({ namespace, externalQid: 'Q-2' }, { ...readyDraft(), topic: 'Selectors', difficulty: 'Simple' }, actor)
    await confirmProvenance({ confirmed: true, note: 'This disposable fixture was authored specifically for this evaluator test.', questions: [{ id: nextId, revision: 1 }] }, actor)
    await questionAction(nextId, 1, 'approve_activate', superAdmin)
    const saved = await submit("I don't know."); const job = await claim(); await finish(job, "I don't know.")
    const result = (await assessmentDetail(saved.id, actor)).result as any
    expect(result.classification).toBe('NOT_ANSWERED'); expect(result.next).toMatchObject({ action: 'SWITCH_TOPIC', source: 'BANK', questionId: nextId, topic: 'Selectors' })
    expect(result.criteria.every((c: any) => c.finding === 'NOT_ASSESSED')).toBe(true)
    await questionAction(nextId, 2, 'deactivate', actor)
    const missing = await submit('No idea'); await finish(await claim(), 'No idea')
    expect(((await assessmentDetail(missing.id, actor)).result as any).next).toMatchObject({ source: 'NONE_AVAILABLE', questionText: null })
  })
  it('previews a learner policy through the accounted Admin path without an adaptive next step', async () => {
    const budget = async () => (await prisma.interviewEvaluatorBudget.findUnique({ where: { scope_day: { scope: hash(actor), day: new Date().toISOString().slice(0,10) } } }))?.used ?? 0
    const abstained = await submit("I don't know.", { model: 'learner-evaluation-2' })
    const free = await assessmentDetail(abstained.id, actor)
    expect(free).toMatchObject({ status: 'COMPLETED', attempts: 0, configCurrent: true, config: LEARNER_POLICIES['learner-evaluation-2'].config })
    expect(free.usage).toHaveLength(0); expect((free.result as any)).toMatchObject({ classification: 'NOT_ANSWERED', next: null })
    expect(await budget()).toBe(0)
    const graded = await submit(testAnswer, { model: 'learner-evaluation-2' })
    expect(graded.id).not.toBe((await submit()).id) // a preview never reuses the Admin test of the same answer
    expect(await budget()).toBe(2)
    for (let i = 0; i < 2; i++) { const job = await claim(); await finish(job) }
    expect(((await assessmentDetail(graded.id, actor)).result as any).next).toBeNull()
    const config = await request(app).get('/eval/config').auth(token(), { type: 'bearer' })
    expect(config.body.models.map((m: { key: string; id: string }) => `${m.key}:${m.id}`)).toEqual(['nova2_lite:nova2-lite-pilot-1', 'nova_pro:nova-pro-comparison-1', 'learner-evaluation-2:nova2-lite-learner-2'])
  })
  it('does not reset daily limits when tests are deleted', async () => {
    await prisma.interviewEvaluatorBudget.create({ data: { scope: hash(actor), day: new Date().toISOString().slice(0,10), used: 19 } })
    const saved = await submit(); await deleteAssessment(saved.id, actor)
    await expect(submit('Another answer')).rejects.toMatchObject({ status: 429 })
    expect(await prisma.interviewAnswerSnapshot.count({ where: { ownerId: actor } })).toBe(0)
  })
  it('retains captured guidance after bank edits/deletion and cascades owner deletion', async () => {
    const saved = await submit(); const job = await claim()
    await editQuestion(questionId, 1, { ...readyDraft(), questionText: 'A different question?' }, actor)
    await expect(submit()).rejects.toMatchObject({ status: 409 })
    await finish(job)
    expect(await assessmentDetail(saved.id, actor)).toMatchObject({ bankChanged: true })
    await prisma.questionBankQuestion.delete({ where: { id: questionId } })
    const row = await assessmentDetail(saved.id, actor)
    expect(row.snapshot.questionId).toBeNull(); expect((row.snapshot.questionSnapshot as any).questionText).toBe(readyDraft().questionText)
    await prisma.user.delete({ where: { id: actor } })
    expect(await prisma.interviewAssessment.findUnique({ where: { id: saved.id } })).toBeNull()
    // Recreate actor for the cleanup hooks.
    await prisma.user.create({ data: { id: actor, email: `${namespace}-owner@example.invalid`, role: 'ADMIN' } })
  })
})
