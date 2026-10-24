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
import { captureCommittedTurn, endPractice, finishAnswer, markQuestionAsked, practiceDetail, prepareBankAttempt, recordAssistance, startPractice, saveCaptureReceipt, voiceState, practiceHistory } from '../src/interviews/practice/service'
import { hash } from '../src/interviews/evaluator/contracts'
import { assessmentDetail, claimAssessment } from '../src/interviews/evaluator/service'
import { isPulseEligible } from '../src/lib/activityPolicy'
import { practiceAgentRouter, practiceRouter } from '../src/routes/interview-practice'
import { signToken } from '../src/lib/jwt'
import { requireAuth } from '../src/middleware/auth'
import { guardInterviewSession, requireSessionFeature } from '../src/middleware/interviewSessionAccess'
import { resolveLivekitAccess } from '../src/lib/livekitAccess'
import { invalidateFeatureFlagCache } from '../src/lib/featureFlags'
import sessionChatRouter from '../src/routes/session-chat'
import { retainSession } from '../src/routes/sessions'
import { getSessionTurns } from '../src/routes/turns'

const app = express(); app.use(express.json()); app.use('/practice', practiceRouter); app.use('/agent', practiceAgentRouter)
app.use('/chat',requireAuth,sessionChatRouter)
app.put('/retain/:id', requireAuth, retainSession)
app.use(guardInterviewSession)
app.get('/sessions/:sessionId/turns', requireAuth, getSessionTurns)
app.get('/sessions/:id', requireAuth, requireSessionFeature(), (_req,res)=>res.json({ok:true}))
app.post('/sessions/:sessionId/segments', requireAuth, (_req,res)=>res.json({ok:true}))
const token = (id: string, role = 'USER') => signToken({ userId: id, role, email: `${fixture}@example.invalid` })

const fixture = `practice_${randomUUID().replaceAll('-', '')}`
let admin: string; let owner: string; let other: string; let questionId: string; let alternate: string
const originalFlags: Array<Awaited<ReturnType<typeof prisma.platformFeatureFlag.findUnique>>> = []
let originalVoices: Awaited<ReturnType<typeof prisma.voiceConfig.findMany>>; let testVoiceId: string
const users: string[] = []; const questions: string[] = []
const setup = () => ({ sessionId: randomUUID(), track: fixture, experienceBand: '2-5', startingDifficulty: 'Medium', durationMinutes: 10, recordingConsent: true })
async function run() { return startPractice(setup(), owner) }
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
    for (const feature of ['interviews','interview_voice']) await prisma.platformFeatureFlag.update({ where: { feature }, data: { hidden: false, disabled: false } })
    await prisma.userFeatureGrant.upsert({ where: { userId_feature: { userId: owner, feature: 'interviews' } }, create: { userId: owner, feature: 'interviews' }, update: {} })
  })
  afterAll(async () => {
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
      await prisma.platformFeatureFlag.upsert({where:{feature:'session_chat'},create:{feature:'session_chat',label:'Chat test',hidden:false,disabled:false,audience:'EVERYONE'},update:{hidden:false,disabled:false,audience:'EVERYONE'}})
      invalidateFeatureFlagCache()
      const body={module:'elevate',sessionId:r.sessionId,messages:[{role:'user',content:'What is the right technical answer?'}]}
      expect((await request(app).post('/chat').auth(token(other,'SUPER_ADMIN'),{type:'bearer'}).send(body)).status).toBe(404)
      const response=await request(app).post('/chat').auth(token(owner),{type:'bearer'}).send(body)
      expect(response.status).toBe(409);expect(response.body.code).toBe('INTERVIEW_TEACHING_PENDING')
    } finally {
      if(original) await prisma.platformFeatureFlag.update({where:{feature:'session_chat'},data:{hidden:original.hidden,disabled:original.disabled,audience:original.audience}})
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
