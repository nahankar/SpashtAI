import { randomUUID } from 'crypto'
import express from 'express'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55441/simple_bank') throw new Error('Practice integration tests require the isolated simple_bank database')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: db.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
import { prisma } from '../src/lib/prisma'
import { createQuestion, confirmProvenance, editQuestion, questionAction } from '../src/interviews/bank/service'
import { readyDraft } from './fixtures/bank-draft'
import { captureCommittedTurn, endPractice, finishAnswer, markQuestionAsked, practiceDetail, prepareBankAttempt, recordAssistance, startPractice } from '../src/interviews/practice/service'
import { hash } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, claimAssessment } from '../src/interviews/evaluator/service'
import { isPulseEligible } from '../src/lib/activityPolicy'
import { practiceAgentRouter, practiceRouter } from '../src/routes/interview-practice'
import { signToken } from '../src/lib/jwt'

const app = express(); app.use(express.json()); app.use('/practice', practiceRouter); app.use('/agent', practiceAgentRouter)
const token = (id: string, role = 'USER') => signToken({ userId: id, role, email: `${fixture}@example.invalid` })

const fixture = `practice_${randomUUID().replaceAll('-', '')}`
let admin: string; let owner: string; let other: string; let questionId: string; let alternate: string
let originalFlag: Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>
const users: string[] = []; const questions: string[] = []
const setup = () => ({ sessionId: randomUUID(), track: fixture, experienceBand: '2-5', startingDifficulty: 'Medium', durationMinutes: 10 })
async function run() { return startPractice(setup(), owner) }
async function segment(sessionId: string, index = 0) {
  return prisma.sessionSegment.create({ data: { id: randomUUID(), sessionId, segmentIndex: index, roomName: randomUUID(), startedAt: new Date() } })
}
async function asked() {
  const r = await run(); const a = await prepareBankAttempt(r.id, owner); const s = await segment(r.sessionId)
  await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
  return { r, a, s }
}
const turn = (segmentId: string, text: string, localTurnIndex = 0) => ({ segmentId, text, localTurnIndex, sourceTurnId: `user_turn_${localTurnIndex}`, role: 'user' })
describe.skipIf(!db.url)('owned interview capture PostgreSQL contracts', () => {
  beforeAll(async () => {
    originalFlag = await prisma.platformFeatureFlag.findUnique({ where: { feature: 'interviews' } })
    await prisma.platformFeatureFlag.upsert({ where: { feature: 'interviews' }, create: { feature: 'interviews', label: 'Test', hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' }, update: { hidden: false, disabled: false, enabled: true, audience: 'SELECTED_USERS' } })
    for (const [suffix, role] of [['admin', 'SUPER_ADMIN'], ['owner', 'USER'], ['other', 'SUPER_ADMIN']] as const) {
      const u = await prisma.user.create({ data: { email: `${fixture}-${suffix}@example.invalid`, role } }); users.push(u.id)
      await prisma.userFeatureGrant.create({ data: { userId: u.id, feature: 'interviews' } })
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
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { hidden: false, disabled: false } })
    await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: owner, feature: 'interviews' } }, create: { userId: owner, feature: 'interviews' }, update: {} })
  })
  afterAll(async () => {
    await prisma.questionBankQuestion.deleteMany({ where: { id: { in: questions } } })
    await prisma.user.deleteMany({ where: { id: { in: users } } })
    if (originalFlag) await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { hidden: originalFlag.hidden, disabled: originalFlag.disabled, enabled: originalFlag.enabled, audience: originalFlag.audience } })
    else await prisma.platformFeatureFlag.delete({ where: { feature: 'interviews' } })
    await prisma.$disconnect()
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
      expect((await request(app).post(`/practice/runs/${r.id}/attempts/${a.id}/finish`).auth(token(owner), { type: 'bearer' }).send({ skip: true })).status).toBe(200)
    } finally {
      if (previousToken === undefined) delete process.env.INTERNAL_AGENT_TOKEN
      else process.env.INTERNAL_AGENT_TOKEN = previousToken
    }
  })
  it('returns learner-safe captured questions; keeps them stable across bank edits', async () => {
    const r = await run(); const a = await prepareBankAttempt(r.id, owner)
    const b = await prepareBankAttempt(r.id, owner); expect(a.id).toBe(b.id)
    expect(JSON.stringify(a)).not.toContain('Fresh fixtures'); expect(a).not.toHaveProperty('questionSnapshot')
    const q = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id: questionId } })
    await editQuestion(questionId, q.revision, { ...readyDraft(), track: fixture, questionText: 'A newly edited bank question?' }, admin)
    expect((await prepareBankAttempt(r.id, owner)).question.text).toBe(a.question.text)
    await expect(prisma.interviewAttempt.update({ where: { id: a.id }, data: { questionSnapshot: {} } })).rejects.toThrow()
    await expect(prisma.session.update({ where: { id: r.sessionId }, data: { purpose: 'COMMUNICATION' } })).rejects.toThrow()
    // Restore eligibility for subsequent tests, without restoring old revisions.
    const changed = await prisma.questionBankQuestion.findUniqueOrThrow({ where: { id: questionId } })
    await confirmProvenance({ questions: [{ id: questionId, revision: changed.revision }], confirmed: true, note: 'Original test content edited solely for capture immutability verification.' }, admin)
    await questionAction(questionId, changed.revision, 'approve_activate', admin)
  })
  it('stitches multiple final turns in segment order across resume without ID collisions', async () => {
    const { r, a, s } = await asked()
    const first = await captureCommittedTurn(a.id, turn(s.id, 'First part.'))
    expect(await captureCommittedTurn(a.id, turn(s.id, 'First part.'))).toMatchObject({ id: first.id, reused: true })
    await captureCommittedTurn(a.id, turn(s.id, 'Second part.', 1))
    expect((await prisma.interviewAttempt.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('ASKED')
    await prisma.sessionSegment.update({ where: { id: s.id }, data: { endedAt: new Date() } })
    const resumed = await segment(r.sessionId, 1)
    await captureCommittedTurn(a.id, turn(resumed.id, 'After reconnect.'))
    await recordAssistance(a.id, { assistance: 'EXAMPLE' }); await recordAssistance(a.id, { assistance: 'HINT' })
    const results = await Promise.all([finishAnswer(r.id, a.id, owner), finishAnswer(r.id, a.id, owner)])
    expect(results[0].id).toBe(results[1].id)
    const snapshot = await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: results[0].id! } })
    expect(snapshot).toMatchObject({ source: 'LIVE_ATTEMPT', textSource: 'AGENT_COMMITTED_TURNS', textRevision: 1,
      answerText: 'First part.\nSecond part.\nAfter reconnect.', assistance: 'EXAMPLE', ownerId: owner })
    expect(snapshot.answerHash).toBe(hash(snapshot.answerText))
    expect(await prisma.interviewAssessment.count({ where: { snapshotId: snapshot.id } })).toBe(0)
    await expect(prisma.interviewAnswerSnapshot.update({ where: { id: snapshot.id }, data: { answerText: 'rewrite' } })).rejects.toThrow()
    await expect(captureCommittedTurn(a.id, turn(resumed.id, 'late', 1))).rejects.toMatchObject({ status: 409 })
    expect((await captureCommittedTurn(a.id, turn(s.id, 'First part.'))).reused).toBe(true)
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
    await expect(captureCommittedTurn(a.id, turn(s.id, 'late'))).rejects.toMatchObject({ status: 409 })
  })
  it('requires exact saved wording and explicit finish or skip; never fabricates an abstention', async () => {
    const r = await run(); const a = await prepareBankAttempt(r.id, owner); const s = await segment(r.sessionId)
    await expect(markQuestionAsked(a.id, { segmentId: s.id, questionText: 'Different question?' })).rejects.toMatchObject({ status: 409 })
    await expect(captureCommittedTurn(a.id, turn(s.id, 'too early'))).rejects.toMatchObject({ status: 409 })
    await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
    await expect(finishAnswer(r.id, a.id, owner)).rejects.toMatchObject({ status: 409 })
    expect(await finishAnswer(r.id, a.id, owner, true)).toMatchObject({ status: 'SKIPPED', id: null })
    expect(await prisma.interviewAnswerSnapshot.count({ where: { attemptId: a.id } })).toBe(0)
    const next = await prepareBankAttempt(r.id, owner); expect(next.id).not.toBe(a.id)
    expect(next.index).toBe(2)
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
    const completed = await finishAnswer(r.id, a.id, owner)
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
    await finishAnswer(r.id, a.id, owner)
    await prisma.platformFeatureFlag.update({ where: { feature: 'interviews' }, data: { disabled: true } })
    await expect(prepareBankAttempt(r.id, owner)).rejects.toMatchObject({ status: 403 })
    expect((await practiceDetail(r.id, owner)).attempts[0].answer?.answerText).toBe('Saved answer')
    expect((await endPractice(r.id, owner)).reused).toBe(false)
    expect((await endPractice(r.id, owner)).reused).toBe(true)
    expect(await prisma.session.findUniqueOrThrow({ where: { id: r.sessionId } })).toMatchObject({ sessionPointsAwarded: false, progressPulseStatus: 'skipped' })
  })
  it('keeps the Admin worker and Super Admin test reports isolated from learner assessments', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Saved answer'))
    const capture = await finishAnswer(r.id, a.id, owner)
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
    await prisma.userFeatureGrant.create({ data: { userId: u.id, feature: 'interviews' } })
    const r = await startPractice(setup(), u.id); const a = await prepareBankAttempt(r.id, u.id); const s = await segment(r.sessionId)
    await markQuestionAsked(a.id, { segmentId: s.id, questionText: a.question.text })
    await captureCommittedTurn(a.id, turn(s.id, 'Delete this answer'))
    const capture = await finishAnswer(r.id, a.id, u.id)
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
    await prisma.session.update({ where: { id: r.sessionId }, data: { startedAt: new Date(Date.now() - 11 * 60_000) } })
    expect((await prepareBankAttempt(r.id, owner)).id).toBe(a.id)
    await captureCommittedTurn(a.id, turn(s.id, 'Finish this answer'))
    await finishAnswer(r.id, a.id, owner)
    await expect(prepareBankAttempt(r.id, owner)).rejects.toMatchObject({ status: 409 })
  })
  it('preserves captured answers/guidance if the mutable bank item is deleted', async () => {
    const { r, a, s } = await asked(); await captureCommittedTurn(a.id, turn(s.id, 'Keep this answer'))
    const result = await finishAnswer(r.id, a.id, owner)
    const attempt = await prisma.interviewAttempt.findUniqueOrThrow({ where: { id: a.id } })
    await prisma.questionBankQuestion.delete({ where: { id: attempt.questionId! } })
    const report = await practiceDetail(r.id, owner)
    expect(report.attempts[0].question.text).toBe(a.question.text)
    expect(report.attempts[0].answer?.answerText).toBe('Keep this answer')
    expect((await prisma.interviewAnswerSnapshot.findUniqueOrThrow({ where: { id: result.id! } })).questionId).toBeNull()
  })
})
