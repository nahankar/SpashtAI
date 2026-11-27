import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config = await vi.hoisted(async () => {
  const url = process.env.REVIEW_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55443/spasht_review_access_test') throw Error('Use only the isolated review test database')
  const fs = await import('node:fs'), os = await import('node:os'), p = await import('node:path')
  const media = url ? fs.mkdtempSync(p.join(os.tmpdir(), 'spasht-review-media-')) : ''
  if (url) { process.env.LOCAL_AUDIO_PATH = media; process.env.REPLAY_UPLOAD_PATH = p.join(media, 'replay') }
  return { url, media }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client'), { createScopedPrisma } = await import('../src/lib/scopedPrisma')
  return { prisma: createScopedPrisma(new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') || 'postgresql://unused:5432/unused' })) }
})
import { prisma } from '../src/lib/prisma'
import { workspaceRouter } from '../src/workspaces/routes'
import { bindWorkspaceRequest } from '../src/workspaces/requestScope'
import { runWithDataScope } from '../src/lib/dataScope'
import { requireAuth } from '../src/middleware/auth'
import { requireFeature } from '../src/lib/featureFlags'
import { guardInterviewSession, requireSessionFeature } from '../src/middleware/interviewSessionAccess'
import { practiceRouter } from '../src/routes/interview-practice'
import replayRouter from '../src/routes/replay'
import preparationsRouter from '../src/routes/preparations'
import { listSessions, getSession, deleteSession } from '../src/routes/sessions'
import { getSessionMetrics, getSessionTranscript } from '../src/routes/metrics'
import { getSessionTurns } from '../src/routes/turns'
import { createSessionRecordingTicket, streamSessionRecording } from '../src/routes/recordings'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
const admin = new PrismaClient({ datasourceUrl: config.url || 'postgresql://unused:5432/unused' })
const tag = 'review-' + randomUUID().slice(0, 8)
const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter)
app.use(bindWorkspaceRequest, requireAuth)
app.use('/api/interviews', practiceRouter)
app.use('/api/replay', requireFeature('replay'), replayRouter)
app.use('/api/preparations', requireFeature('prepare'), preparationsRouter)
app.use(guardInterviewSession)
app.get('/sessions', requireFeature('elevate'), listSessions)
app.get('/sessions/:id', requireSessionFeature(), getSession)
app.delete('/sessions/:id', requireSessionFeature(), deleteSession)
app.get('/sessions/:sessionId/metrics', requireSessionFeature(), getSessionMetrics)
app.get('/sessions/:sessionId/transcript', requireSessionFeature(), getSessionTranscript)
app.get('/sessions/:sessionId/turns', requireSessionFeature(), getSessionTurns)
app.post('/sessions/:sessionId/recording/ticket', requireSessionFeature(), createSessionRecordingTicket)
app.get('/sessions/:sessionId/recording/stream', requireSessionFeature(), streamSessionRecording)
let workspace = '', beta = '', owner = '', manager = '', learner = '', peer = '', ownerMember = '', managerMember = '', learnerMember = '', betaMember = ''
let elevate = '', interview = '', replay = '', preparation = '', gone = '', foreign = '', personal = '', runId = '', attemptId = '', snapshotId = '', linked = '', recorded = ''
const token = (who = owner, membershipId = ownerMember, workspaceId = workspace) => signWorkspaceToken({ userId: who, membershipId, workspaceId })
const auth = (who = owner, membershipId = ownerMember, workspaceId = workspace) => ({ Authorization: 'Bearer ' + signToken({ userId: who, email: `${tag}@example.invalid`, role: 'USER' }), 'x-spasht-workspace': token(who, membershipId, workspaceId) })
const question = { id: 'q', namespace: 'pilot', externalQid: 'Q1', revision: 1, questionText: 'Explain a transaction.', track: 'General', category: 'Database', topic: 'ACID', difficulty: 'Medium', experienceBand: '2-5', goodAnswerPoints: 'PRIVATE-RUBRIC', exampleAnswer: 'PRIVATE-EXAMPLE', expectedDepth: '', followUpGuidance: '' }
const wav = Buffer.alloc(16044); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40)

describe.skipIf(!config.url)('workspace read-only practice review', () => {
  beforeAll(async () => {
    process.env.WORKSPACES_ENABLED = 'true'
    await prepareWorkspaceTestRole(admin)
    const make = async (name: string) => (await admin.user.create({ data: { email: `${tag}-${name}@example.invalid`, firstName: name, emailVerified: true } })).id
    owner = await make('owner'); manager = await make('manager'); learner = await make('learner'); peer = await make('peer')
    workspace = (await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Review test', slug: tag } })).id
    beta = (await admin.workspace.create({ data: { kind: 'ORGANIZATION', name: 'Other tenant', slug: tag + '-other' } })).id
    const member = async (userId: string, role: 'OWNER' | 'ADMIN' | 'LEARNER', workspaceId = workspace) => (await admin.workspaceMember.create({ data: { workspaceId, userId, role, state: 'ACTIVE', acceptedAt: new Date() } })).id
    ownerMember = await member(owner, 'OWNER'); managerMember = await member(manager, 'ADMIN'); learnerMember = await member(learner, 'LEARNER'); await member(peer, 'LEARNER'); betaMember = await member(learner, 'OWNER', beta)
    for (const feature of ['elevate','replay','interviews','interview_voice']) {
      await admin.platformFeatureFlag.upsert({where:{feature},create:{feature,label:feature,hidden:false,disabled:false},update:{hidden:false,disabled:false}})
    }
    for (const feature of ['elevate','replay','interviews','pro']) await admin.workspaceFeature.create({data:{workspaceId:workspace,feature,entitled:true,enabled:true,memberDefault:true}})
    const voice = async (purpose: 'COMMUNICATION' | 'INTERVIEW' | 'GOAL_PREPARATION', workspaceId = workspace, userId = learner) => (await admin.session.create({ data: { workspaceId, workspaceKind: 'ORGANIZATION', userId, module: 'elevate', purpose: purpose === 'GOAL_PREPARATION' ? 'INTERVIEW' : purpose, contextScope: purpose === 'GOAL_PREPARATION' ? 'JOURNEY' : 'SESSION_ONLY', sessionName: purpose + ' session', endedAt: new Date(), durationSec: 10 } })).id
    elevate = await voice('COMMUNICATION'); interview = await voice('INTERVIEW'); linked = await voice('GOAL_PREPARATION'); gone = await voice('INTERVIEW'); foreign = await voice('INTERVIEW', beta)
    await admin.session.update({ where: { id: gone }, data: { discardedAt: new Date() } })
    personal = (await admin.session.create({ data: { userId: learner, module: 'elevate', purpose: 'INTERVIEW', endedAt: new Date() } })).id
    for (const id of [elevate, interview, linked]) {
      await admin.sessionTranscript.create({ data: { sessionId: id, conversationData: { messages: [{ role: 'user', content: 'My saved transcript' }], audioFiles: ['PRIVATE-STORAGE-PATH'] } } })
      const dir = path.join(config.media, 'workspaces', workspace, 'sessions', id); await mkdir(dir, { recursive: true }); const file = path.join(dir, 'answer.wav'); await writeFile(file, wav)
      await admin.sessionRecording.create({ data: { sessionId: id, egressId: id, filePath: file, mimeType: 'audio/wav', status: 'completed' } })
    }
    await admin.session.update({ where: { id: interview }, data: { endedAt: null } })
    runId = (await admin.interviewRun.create({ data: { sessionId: interview, ownerId: learner, track: 'General', experienceBand: '2-5', startingDifficulty: 'Medium', evaluationPolicySnapshot: { enabled: true }, recordingConsentAt: new Date(), recordingConsentVersion: 'interview-recording-1', voiceConfigSnapshot: { backend: 'pipeline-bedrock', sttProvider: 'transcribe', ttsProvider: 'polly', secret: 'PRIVATE-CONFIG' } } })).id
    attemptId = (await admin.interviewAttempt.create({ data: { runId, index: 1, questionSnapshot: question, questionHash: 'hash', status: 'ASKED', askedAt: new Date() } })).id
    const segmentId = randomUUID()
    await admin.sessionSegment.create({ data: { id: segmentId, sessionId: interview, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date(), audioStatus: 'available', recordingDurationSec: 1 } })
    await admin.sessionRecording.updateMany({ where: { sessionId: interview }, data: { segmentId } })
    await admin.interviewAnswerChunk.create({ data: { attemptId, segmentId, sourceTurnId: randomUUID(), localTurnIndex: 0, text: 'My saved answer' } })
    await admin.interviewCaptureReceipt.create({ data: { id: randomUUID(), attemptId, segmentId, action: 'FINISH', lastTurnIndex: 0 } })
    await admin.interviewAttempt.update({ where: { id: attemptId }, data: { status: 'ANSWERED', completedAt: new Date() } })
    snapshotId = (await admin.interviewAnswerSnapshot.create({ data: { ownerId: learner, attemptId, source: 'LIVE_ATTEMPT', textSource: 'AGENT_COMMITTED_TURNS', questionSnapshot: question, questionHash: 'hash', answerText: 'My saved answer', answerHash: 'answer' } })).id
    await admin.interviewAssessment.create({ data: { snapshotId, inputKey: tag, config: { secret: 'PRIVATE-PROVIDER' }, status: 'COMPLETED', completedAt: new Date(), result: { classification: 'CORRECT', criteria: ['ACCURACY','REASONING','DEPTH'].map(criterion => ({ criterion, finding: 'MET', evidence: ['My saved answer'], explanation: 'Good explanation' })), strengths: ['Clear explanation'], gaps: [], misconceptions: [], guidance: 'Keep practising', uncertainty: [], followUpQuestion: '' } } })
    await admin.session.update({ where: { id: interview }, data: { endedAt: new Date() } })
    const replayRow = async (purpose: 'COMMUNICATION' | 'INTERVIEW') => (await admin.replaySession.create({ data: { workspaceId: workspace, workspaceKind: 'ORGANIZATION', userId: learner, meetingType: 'standup', userRole: 'host', purpose, contextScope: purpose === 'INTERVIEW' ? 'JOURNEY' : 'SESSION_ONLY', sessionName: 'Replay sample', status: 'completed' } })).id
    replay = await replayRow('COMMUNICATION'); recorded = await replayRow('INTERVIEW')
    for (const id of [replay, recorded]) {
      const dir = path.join(config.media, 'replay', 'workspaces', workspace, 'replay', id); await mkdir(dir, { recursive: true }); const file = path.join(dir, 'recording.wav'); await writeFile(file, wav)
      const upload = await admin.replayUpload.create({ data: { replaySessionId: id, fileType: 'audio', originalName: 'recording.wav', storedPath: file, mimeType: 'audio/wav', fileSize: wav.length } })
      await admin.replayResult.create({ data: { replaySessionId: id, transcriptText: 'Recorded interview transcript', transcriptionSource: 'uploaded', structuredTranscript: [{ speaker: 'Speaker 1', text: 'Recorded interview transcript' }], deliveryEvidence: { version: 'replay-delivery-v1', recording: { uploadId: upload.id, signature: createHash('sha256').update(wav).digest('hex') }, transcriptSource: 'uploaded', words: null, transcriptRevision: 'rev', supplementaryTranscript: null }, modelUsed: 'PRIVATE-PROVIDER' } })
    }
    preparation = (await admin.preparation.create({ data: { workspaceId: workspace, workspaceKind: 'ORGANIZATION', userId: learner, title: 'Prepare journey' } })).id
    await admin.interviewPreparation.create({ data: { preparationId: preparation, companyName: 'Example', roleTitle: 'Engineer', resumeText: 'PRIVATE-RESUME' } })
    await admin.preparationPractice.create({ data: { preparationId: preparation, sessionId: linked } })
    await admin.preparationRecording.create({ data: { preparationId: preparation, replaySessionId: recorded } })
  }, 30000)
  afterAll(async () => {
    await admin.workspace.deleteMany({ where: { id: { in: [workspace, beta] } } })
    await admin.session.deleteMany({ where: { id: personal } })
    await admin.user.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.$disconnect(); await admin.$disconnect()
    if (config.media) await rm(config.media, { recursive: true, force: true })
  })
  it('uses the native lists for current Owners/Admins and retains per-product filters', async () => {
    for (const h of [auth(), auth(manager, managerMember)]) {
      const elev = await request(app).get('/sessions').set(h)
      expect(elev.status, elev.text).toBe(200); expect(elev.body.sessions.map((r: { id: string }) => r.id)).toEqual([elevate])
      const interviews = await request(app).get('/api/interviews/runs').set(h)
      expect(interviews.status, interviews.text).toBe(200); expect(interviews.body.runs.map((r: { sessionId: string }) => r.sessionId)).toEqual([interview])
      expect(interviews.body.runs[0]).toMatchObject({ readOnly: true, user: { id: learner } })
      expect((await request(app).get('/api/interviews/runs?user=no-such-user').set(h)).body.runs).toEqual([])
      expect((await request(app).get('/api/interviews/runs?user=learner').set(h)).body.runs).toHaveLength(1)
      expect((await request(app).get('/api/interviews/runs?q='+encodeURIComponent(interview)).set(h)).body.runs).toHaveLength(1)
      expect((await request(app).get('/api/replay/sessions').set(h)).body.sessions.map((r: {id:string})=>r.id)).toEqual([replay])
      expect((await request(app).get('/api/preparations').set(h)).body.preparations.map((r: {id:string})=>r.id)).toEqual([preparation])
    }
    expect((await request(app).get('/api/interviews/runs?scope=mine').set(auth())).body.runs).toEqual([])
    expect((await request(app).get('/api/replay/sessions?scope=mine').set(auth())).body.sessions).toEqual([])
  })
  it('opens native session playback, answers, assessments, Replay results and Prepare journeys read-only', async () => {
    const before = await admin.interviewRun.findUnique({where:{id:runId}})
    for (const route of [`/sessions/${interview}`, `/sessions/${interview}/metrics`, `/sessions/${interview}/transcript`, `/sessions/${interview}/turns`,
      `/api/interviews/runs/${runId}`, `/api/interviews/playback/${interview}/assessments`, `/api/replay/sessions/${replay}/results`, `/api/preparations/${preparation}`]) {
      const response = await request(app).get(route).set(auth())
      expect(response.status, route+' '+response.text).toBe(200)
    }
    const feedback = await request(app).get(`/api/interviews/playback/${interview}/assessments`).set(auth())
    expect(feedback.text).toContain('CORRECT'); expect(feedback.text).toContain('Clear explanation')
    expect((await request(app).get(`/api/replay/sessions/${replay}/results`).set(auth())).body.session.readOnly).toBe(true)
    expect(await admin.interviewRun.findUnique({where:{id:runId}})).toEqual(before)
  })
  it('does not release grades before the practice ends', async () => {
    await admin.session.update({where:{id:interview},data:{endedAt:null}})
    try { const r = await request(app).get(`/api/interviews/playback/${interview}/assessments`).set(auth()); expect(r.status,r.text).toBe(200); expect(r.text).toContain('AFTER_PRACTICE'); expect(r.text).not.toContain('CORRECT') }
    finally { await admin.session.update({where:{id:interview},data:{endedAt:new Date()}}) }
  })
  it('keeps Personal, deleted and other-tenant sessions private and does not grant learner review access', async () => {
    for(const id of [foreign,personal,gone]) {
      const r=await request(app).get(`/sessions/${id}`).set(auth()); expect([404,410]).toContain(r.status)
      expect((await request(app).get(`/api/interviews/playback/${id}/assessments`).set(auth())).status).toBe(404)
    }
    for (const route of [`/sessions/${interview}`, `/api/interviews/runs/${runId}`, `/api/preparations/${preparation}`]) {
      const r=await request(app).get(route).set(auth(peer, (await admin.workspaceMember.findUniqueOrThrow({where:{workspaceId_userId:{workspaceId:workspace,userId:peer}}})).id)); expect([403,404]).toContain(r.status)
    }
    expect((await request(app).get('/api/interviews/runs').set(auth(learner,learnerMember))).body.runs.map((r:{sessionId:string})=>r.sessionId)).toEqual([interview])
  })
  it('revokes review after role demotion or membership suspension', async () => {
    await admin.workspaceMember.update({where:{id:managerMember},data:{role:'LEARNER'}})
    try {
      expect((await request(app).get(`/sessions/${interview}`).set(auth(manager,managerMember))).status).toBe(404)
      await admin.workspaceMember.update({where:{id:managerMember},data:{role:'ADMIN',state:'SUSPENDED'}})
      expect((await request(app).get(`/sessions/${interview}`).set(auth(manager,managerMember))).status).toBe(404)
    } finally { await admin.workspaceMember.update({where:{id:managerMember},data:{role:'ADMIN',state:'ACTIVE'}}) }
  })
  it('issues session-bound recording tickets and streams authorized playback', async () => {
    const ticket=await request(app).post(`/sessions/${interview}/recording/ticket`).set(auth()).send({})
    expect(ticket.status,ticket.text).toBe(200)
    const audio=await request(app).get(`/sessions/${interview}/recording/stream`).set(auth())
    expect(audio.status,audio.text).toBe(200); expect(audio.headers['content-type']).toContain('audio/wav')
    expect((await request(app).post(`/sessions/${foreign}/recording/ticket`).set(auth()).send({})).status).toBe(404)
  })
  it('denies cross-user mutations on the existing endpoints and blocks writes in review-mode transactions', async () => {
    for (const [method, route] of [['delete',`/sessions/${interview}`], ['post',`/api/interviews/runs/${runId}/end`], ['delete',`/api/replay/sessions/${replay}`], ['delete',`/api/preparations/${preparation}`]] as const) {
      const r=await request(app)[method](route).set(auth()).send({}); expect([403,404]).toContain(r.status)
    }
    const scope={actorId:owner,workspaceId:workspace,membershipId:ownerMember,role:'OWNER' as const,slug:tag,timeZone:'Asia/Kolkata',features:{},reader:'practice_review' as const,origin:'request' as const}
    await expect(runWithDataScope(scope,()=>prisma.session.update({where:{id:interview},data:{sessionName:'FORBIDDEN'}}))).rejects.toThrow()
    await expect(runWithDataScope(scope,()=>prisma.$transaction(tx=>tx.preparation.delete({where:{id:preparation}})))).rejects.toThrow()
    expect(await admin.interviewAttempt.findUnique({where:{id:attemptId}})).toMatchObject({status:'ANSWERED'})
    expect(await admin.session.findUnique({where:{id:interview}})).not.toBeNull()
  })
  it('omits a Prepare practice immediately when discarded, before its cleanup job deletes it', async () => {
    await admin.session.update({where:{id:linked},data:{discardedAt:new Date()}})
    const detail=await request(app).get(`/api/preparations/${preparation}`).set(auth())
    expect(detail.status,detail.text).toBe(200)
    expect(detail.body.preparation.practices).toEqual([])
    const list=await request(app).get('/api/preparations').set(auth())
    expect(list.status,list.text).toBe(200)
    expect(list.body.preparations[0].practices).toEqual([])
  })

})
