import { prepareWorkspaceTestRole } from './workspace-test-role'
import { RESTRICTED_TEST_URL, workspaceTestUrls } from './workspace-test-db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient, type Prisma } from '@prisma/client'
import express from 'express'
import supertest from 'supertest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { signToken, signWorkspaceReviewMediaToken, signWorkspaceToken } from '../src/lib/jwt'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
workspaceTestUrls(url)
const suite = url ? describe : describe.skip

suite('read-only Owner/Admin review of organization learner sessions', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED, audio: process.env.LOCAL_AUDIO_PATH,
    replay: process.env.REPLAY_UPLOAD_PATH, archive: process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED }
  const tag = 'rv-' + randomUUID().replaceAll('-', '').slice(0, 10)
  const tz = 'Asia/Kolkata'
  const SECRETS = ['SECRET-AUDIO-PATH', 'SECRET-PROVIDER', 'SECRET-EXAMPLE', 'SECRET-GOOD-POINTS', 'SECRET-FOLLOWUP', 'SECRET-VALIDATION',
    'SECRET-MODEL', 'SECRET-EVIDENCE-PATH', 'SECRET-DEPTH', 'SECRET-GUIDANCE']
  const CONTENT = ['Learner words about quarterly planning', 'Interviewer prompt about caching', 'Replay transcript about the roadmap', 'My cache answer']
  let db: PrismaClient
  let api: ReturnType<typeof supertest>
  let audioRoot = '', replayRoot = ''
  let alpha = '', beta = ''
  const users: Record<string, string> = {}
  const members: Record<string, string> = {}
  const ids: Record<string, string> = {}
  const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  const token = (workspaceId: string, who: string) =>
    ({ Authorization: `Bearer ${signWorkspaceToken({ userId: users[who], workspaceId, membershipId: members[`${workspaceId}:${who}`] })}` })
  const list = (who: string, query = '', ws = alpha) => api.get(`/api/workspaces/current/review/sessions${query ? `?${query}` : ''}`).set(token(ws, who))
  const detail = (who: string, product: string, id: string, ws = alpha) => api.get(`/api/workspaces/current/review/sessions/${product}/${id}`).set(token(ws, who))
  const streamPath = (product: string, session: string, recording: string) => `/api/workspaces/current/review/sessions/${product}/${session}/recordings/${recording}/stream`
  const ticket = (who: string, product: string, session: string, recording: string, ws = alpha) =>
    api.post(`${streamPath(product, session, recording).replace(/\/stream$/, '/ticket')}`).set(token(ws, who))

  /** Raw database access in an explicit context, bypassing the application checks. */
  const raw = <T>(who: string, workspaceId: string, work: (tx: Prisma.TransactionClient) => Promise<T>, options: { readOnly?: boolean; reader?: string } = {}) =>
    db.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.workspace_actor_id', ${users[who]}, true), set_config('app.workspace_id', ${workspaceId}, true),
        set_config('app.workspace_platform_admin', 'false', true), set_config('app.workspace_reader', ${options.reader ?? 'reviewer'}, true)`
      if (options.readOnly ?? true) await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      return work(tx)
    })
  const visibleSessions = (tx: Prisma.TransactionClient) => tx.session.findMany({ where: { userId: { in: Object.values(users) } }, select: { id: true } })
    .then(rows => rows.map(row => row.id).sort())

  async function media(root: string, workspaceId: string, kind: 'sessions' | 'replay', activity: string, name: string, content = bytes) {
    const dir = path.join(root, 'workspaces', workspaceId, kind, activity)
    await mkdir(dir, { recursive: true })
    const file = path.join(dir, name)
    await writeFile(file, content)
    return file
  }
  async function elevate(workspaceId: string, who: string, name: string, options: { discarded?: boolean; startedAt?: Date } = {}) {
    const session = await admin.session.create({ data: { ...(workspaceId ? { workspaceId } : {}), userId: users[who], module: 'elevate', sessionName: name,
      startedAt: options.startedAt ?? new Date('2026-11-02T06:00:00Z'), endedAt: new Date('2026-11-02T06:10:00Z'), durationSec: 600,
      ...(options.discarded ? { discardedAt: new Date() } : {}) } })
    const segment = await admin.sessionSegment.create({ data: { id: randomUUID(), sessionId: session.id, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date(), audioStatus: 'available' } })
    const wsId = session.workspaceId
    const file = await media(audioRoot, wsId, 'sessions', session.id, `elevate-segment-${segment.id}.audio`)
    const recording = await admin.sessionRecording.create({ data: { sessionId: session.id, segmentId: segment.id, egressId: `client-segment-${segment.id}`,
      filePath: file, duration: 5, fileSize: bytes.length, mimeType: 'audio/webm;codecs=opus', status: 'completed', recordingType: 'user' } })
    return { session: session.id, segment: segment.id, recording: recording.id, file }
  }

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    process.env.DATABASE_URL = RESTRICTED_TEST_URL
    process.env.WORKSPACES_ENABLED = 'true'
    process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED = 'true'
    audioRoot = await mkdtemp(path.join(os.tmpdir(), 'spasht-review-audio-'))
    replayRoot = await mkdtemp(path.join(os.tmpdir(), 'spasht-review-replay-'))
    process.env.LOCAL_AUDIO_PATH = audioRoot
    process.env.REPLAY_UPLOAD_PATH = replayRoot
    db = (await import('../src/lib/prisma')).prisma
    const { workspaceRouter } = await import('../src/workspaces/routes')
    const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter)
    api = supertest(app)

    for (const who of ['owner', 'admin', 'demoted', 'suspended', 'learner', 'second', 'bulk', 'betaOwner', 'staff']) {
      users[who] = (await admin.user.create({ data: { email: `${tag}-${who}@example.invalid`, firstName: who, emailVerified: true, role: who === 'staff' ? 'SUPER_ADMIN' : 'USER' } })).id
    }
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY', timeZone: tz } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
    }
    await admin.workspaceFeature.create({ data: { workspaceId: alpha, feature: 'pro', entitled: true, enabled: true } })
    const join = async (workspaceId: string, who: string, role: 'OWNER' | 'ADMIN' | 'LEARNER') => {
      members[`${workspaceId}:${who}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId: users[who], role, state: 'ACTIVE', acceptedAt: new Date() } })).id
    }
    await join(alpha, 'owner', 'OWNER'); await join(alpha, 'admin', 'ADMIN'); await join(alpha, 'demoted', 'ADMIN'); await join(alpha, 'suspended', 'ADMIN')
    await join(alpha, 'learner', 'LEARNER'); await join(alpha, 'second', 'LEARNER'); await join(alpha, 'bulk', 'LEARNER')
    await join(beta, 'betaOwner', 'OWNER'); await join(beta, 'learner', 'LEARNER')

    // Elevate with turns, legacy conversation JSON holding an internal path, metrics and a recording.
    const e1 = await elevate(alpha, 'learner', 'Alpha elevate')
    Object.assign(ids, { e1: e1.session, e1Recording: e1.recording, e1Segment: e1.segment })
    await admin.sessionTurn.createMany({ data: [
      { sessionId: e1.session, segmentId: e1.segment, turnIndex: 0, localTurnIndex: 0, sequenceNo: 0, role: 'assistant', text: 'Interviewer prompt about caching', audioStart: 0, audioEnd: 2 },
      { sessionId: e1.session, segmentId: e1.segment, turnIndex: 1, localTurnIndex: 1, sequenceNo: 1, role: 'user', text: 'Learner words about quarterly planning',
        audioStart: 2, audioEnd: 5, score: { stars: 4, tags: ['clear'], model: 'SECRET-MODEL' }, coachNote: 'Lead with the outcome.' },
    ] })
    await admin.sessionTranscript.create({ data: { sessionId: e1.session, conversationData: { messages: [{ id: 'm1', role: 'user', content: 'Learner words about quarterly planning' }], audioFiles: ['SECRET-AUDIO-PATH'] } } })
    await admin.sessionMetrics.create({ data: { sessionId: e1.session, userWpm: 132, userFillerCount: 3, totalTurns: 2,
      skillScores: { scores: { clarity: 7.5, confidence: 6 }, components: { clarity: { raw: 1 } } },
      coachingInsights: { topStrength: 'Clear opening', primaryImprovement: 'Pace', practicePlan: [{ title: 'Drill', description: 'Pause', focusSkill: 'pacing' }],
        promptTokens: 99, insightProvider: 'SECRET-PROVIDER', error: 'SECRET-PROVIDER failure' } } })
    ids.e2 = (await elevate(alpha, 'second', 'Second elevate', { startedAt: new Date('2026-10-20T06:00:00Z') })).session
    ids.discarded = (await elevate(alpha, 'learner', 'Discarded', { discarded: true })).session
    const b1 = await elevate(beta, 'learner', 'Beta elevate'); ids.b1 = b1.session; ids.b1Recording = b1.recording
    const personal = await elevate('', 'learner', 'Personal elevate'); ids.personal = personal.session; ids.personalRecording = personal.recording

    // A recording row of another alpha session pointing at e1's file, and a symlink into beta: neither may be served.
    const crossSegment = await admin.sessionSegment.create({ data: { id: randomUUID(), sessionId: ids.e2, segmentIndex: 1, roomName: randomUUID(), startedAt: new Date() } })
    ids.crossRecording = (await admin.sessionRecording.create({ data: { sessionId: ids.e2, segmentId: crossSegment.id, egressId: `cross-${crossSegment.id}`,
      filePath: e1.file, mimeType: 'audio/webm', status: 'completed' } })).id
    const linkSegment = await admin.sessionSegment.create({ data: { id: randomUUID(), sessionId: e1.session, segmentIndex: 1, roomName: randomUUID(), startedAt: new Date() } })
    const link = path.join(audioRoot, 'workspaces', alpha, 'sessions', e1.session, 'linked.audio')
    await symlink(b1.file, link)
    ids.linkRecording = (await admin.sessionRecording.create({ data: { sessionId: e1.session, segmentId: linkSegment.id, egressId: `link-${linkSegment.id}`,
      filePath: link, mimeType: 'audio/webm', status: 'completed' } })).id

    // Prepare practice is not reviewable yet.
    const preparation = await admin.preparation.create({ data: { workspaceId: alpha, userId: users.learner, title: 'Journey' } })
    ids.prepare = (await admin.session.create({ data: { workspaceId: alpha, userId: users.learner, module: 'elevate', purpose: 'INTERVIEW', contextScope: 'JOURNEY', sessionName: 'Prepare practice' } })).id
    await admin.preparationPractice.create({ data: { preparationId: preparation.id, sessionId: ids.prepare } })

    // Interviews: run, attempt, committed speech, receipt, answer and completed technical feedback.
    const interview = await admin.session.create({ data: { workspaceId: alpha, userId: users.learner, module: 'elevate', purpose: 'INTERVIEW', sessionName: 'Alpha interview',
      startedAt: new Date('2026-11-03T06:00:00Z') } })
    ids.interview = interview.id
    const run = await admin.interviewRun.create({ data: { sessionId: interview.id, ownerId: users.learner, track: 'backend', experienceBand: '2-5', startingDifficulty: 'Medium',
      recordingConsentAt: new Date(), recordingConsentVersion: 'interview-recording-1',
      voiceConfigSnapshot: { backend: 'pipeline-bedrock', sttProvider: 'transcribe', ttsProvider: 'polly' }, evaluationPolicySnapshot: { version: 'test', config: {} } } })
    const questionSnapshot = { id: 'q1', namespace: 'automation-pilot', externalQid: 'Q1', revision: 1, questionText: 'How would you design a cache?', track: 'backend',
      category: 'design', topic: 'caching', difficulty: 'Medium', experienceBand: '2-5', goodAnswerPoints: 'SECRET-GOOD-POINTS', exampleAnswer: 'SECRET-EXAMPLE',
      expectedDepth: 'SECRET-DEPTH', followUpGuidance: 'SECRET-GUIDANCE' }
    const segment = await admin.sessionSegment.create({ data: { id: randomUUID(), sessionId: interview.id, segmentIndex: 0, roomName: randomUUID(), startedAt: new Date() } })
    const attempt = await admin.interviewAttempt.create({ data: { runId: run.id, index: 1, questionSnapshot, questionHash: 'qh', status: 'ASKED', askedAt: new Date() } })
    await admin.interviewAnswerChunk.create({ data: { attemptId: attempt.id, segmentId: segment.id, sourceTurnId: 'user_turn_0', localTurnIndex: 0, text: 'My cache answer' } })
    await admin.interviewCaptureReceipt.create({ data: { id: randomUUID(), attemptId: attempt.id, segmentId: segment.id, action: 'FINISH', lastTurnIndex: 0 } })
    await admin.interviewAttempt.update({ where: { id: attempt.id }, data: { status: 'ANSWERED', completedAt: new Date() } })
    const snapshot = await admin.interviewAnswerSnapshot.create({ data: { ownerId: users.learner, source: 'LIVE_ATTEMPT', attemptId: attempt.id, questionSnapshot,
      questionHash: 'qh', answerText: 'My cache answer', answerHash: 'ah', textSource: 'AGENT_COMMITTED_TURNS' } })
    const criterion = (name: string) => ({ criterion: name, finding: 'PARTIAL', evidence: ['My cache answer'], explanation: `${name} explanation` })
    await admin.interviewAssessment.create({ data: { snapshotId: snapshot.id, inputKey: `${tag}-input`, config: { model: 'SECRET-MODEL' }, status: 'COMPLETED', completedAt: new Date(),
      result: { classification: 'PARTIAL', criteria: ['ACCURACY', 'REASONING', 'DEPTH'].map(criterion), strengths: ['Named eviction'], gaps: ['No invalidation'],
        misconceptions: [], guidance: 'Discuss invalidation.', uncertainty: [], followUpQuestion: 'SECRET-FOLLOWUP', validationNotes: ['SECRET-VALIDATION'] } } })
    await admin.session.update({ where: { id: interview.id }, data: { endedAt: new Date('2026-11-03T06:20:00Z'), durationSec: 1200 } })

    // Replay with a result (internal model/evidence fields), an audio upload and a video upload outside the plan.
    const replay = await admin.replaySession.create({ data: { workspaceId: alpha, userId: users.learner, sessionName: 'Alpha replay', meetingType: 'standup', userRole: 'host',
      status: 'completed', createdAt: new Date('2026-11-01T06:00:00Z') } })
    ids.replay = replay.id
    await admin.replayResult.create({ data: { replaySessionId: replay.id, transcriptText: 'Replay transcript about the roadmap', transcriptionSource: 'uploaded',
      structuredTranscript: [{ speaker: 'Learner', text: 'Replay transcript about the roadmap', startTime: 0, endTime: 4 }],
      modelUsed: 'SECRET-MODEL', deliveryEvidence: { version: 'legacy', storedPath: 'SECRET-EVIDENCE-PATH' } } })
    ids.replayAudio = (await admin.replayUpload.create({ data: { replaySessionId: replay.id, fileType: 'audio', originalName: 'meeting.webm',
      storedPath: await media(replayRoot, alpha, 'replay', replay.id, 'meeting.webm'), fileSize: bytes.length, mimeType: 'audio/webm' } })).id
    ids.replayVideo = (await admin.replayUpload.create({ data: { replaySessionId: replay.id, fileType: 'video', originalName: 'meeting.mp4',
      storedPath: await media(replayRoot, alpha, 'replay', replay.id, 'meeting.mp4'), fileSize: bytes.length, mimeType: 'video/mp4' } })).id

    // A learner with more sessions than one page.
    await admin.session.createMany({ data: Array.from({ length: 53 }, (_, i) => ({ workspaceId: alpha, userId: users.bulk, module: 'elevate',
      sessionName: `Bulk ${i}`, startedAt: new Date(Date.UTC(2026, 9, 1, 0, i)) })) })
  }, 120000)

  afterAll(async () => {
    const all = Object.values(users)
    await admin.session.deleteMany({ where: { userId: { in: all } } })
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: all } }] } })
    await admin.user.deleteMany({ where: { id: { in: all } } })
    await db?.$disconnect(); await admin.$disconnect()
    for (const root of [audioRoot, replayRoot]) if (root) await rm(root, { recursive: true, force: true })
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled, LOCAL_AUDIO_PATH: env.audio,
      REPLAY_UPLOAD_PATH: env.replay, WORKSPACE_SESSION_ARCHIVE_ENABLED: env.archive })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  it('tells learners on entry and on the workspace home that Owners and Admins can review their organization sessions', async () => {
    const entry = await api.post(`/api/workspaces/entry/${tag}-alpha`).set({ Authorization: `Bearer ${signToken({ userId: users.learner, email: `${tag}-learner@example.invalid`, role: 'USER' })}` })
    expect(entry.status).toBe(200)
    expect(entry.body.notice).toMatch(/Owners and Admins can review your sessions/)
    expect(entry.body.notice).toMatch(/Personal history remains separate and private/)
    expect((await api.get('/api/workspaces/current').set(token(alpha, 'learner'))).body.notice).toMatch(/Owners and Admins can review your sessions/)
  })

  it('refuses learners, outsiders and platform staff without an active Owner/Admin membership', async () => {
    expect((await list('learner')).status).toBe(403)
    expect((await detail('learner', 'elevate', ids.e2)).status).toBe(403)
    expect((await ticket('learner', 'elevate', ids.e2, 'x')).status).toBe(403)
    expect((await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'second'))).status).toBe(403)
    expect((await api.get('/api/workspaces/current/review/sessions')).status).toBe(401)
    // Platform staff hold no organization role; borrowing an Owner membership id fails.
    const forged = { Authorization: `Bearer ${signWorkspaceToken({ userId: users.staff, workspaceId: alpha, membershipId: members[`${alpha}:owner`] })}` }
    expect((await api.get('/api/workspaces/current/review/sessions').set(forged)).status).toBe(403)
    // The beta Owner cannot reach alpha with a beta token.
    expect((await detail('betaOwner', 'elevate', ids.e1, beta)).status).toBe(404)
  })

  it('lists only this organization (no Personal, other organization, discarded or Prepare activity) with filters and paging', async () => {
    const response = await list('owner')
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const pageIds = response.body.items.map((item: { id: string }) => item.id)
    const all = [...pageIds]
    let cursor = response.body.nextCursor
    while (cursor) {
      const next = await list('owner', `after=${encodeURIComponent(cursor)}`)
      expect(next.status).toBe(200)
      all.push(...next.body.items.map((item: { id: string }) => item.id)); cursor = next.body.nextCursor
    }
    expect(new Set(all).size).toBe(all.length)
    expect(all).toEqual(expect.arrayContaining([ids.e1, ids.e2, ids.interview, ids.replay]))
    for (const hidden of [ids.b1, ids.personal, ids.discarded, ids.prepare]) expect(all).not.toContain(hidden)
    expect(all).toHaveLength(4 + 53)
    const first = response.body.items.find((item: { id: string }) => item.id === ids.interview)
    expect(first).toMatchObject({ product: 'interviews', name: 'Alpha interview', status: 'completed', durationSeconds: 1200,
      learner: { memberId: members[`${alpha}:learner`], name: 'learner', email: `${tag}-learner@example.invalid` } })

    const byLearner = await list('admin', `learner=${members[`${alpha}:second`]}`)
    expect(byLearner.body.items.map((item: { id: string }) => item.id)).toEqual([ids.e2])
    expect((await list('owner', 'product=replay')).body.items.map((item: { id: string }) => item.id)).toEqual([ids.replay])
    expect((await list('owner', `product=interviews&learner=${members[`${alpha}:learner`]}`)).body.items.map((item: { id: string }) => item.id)).toEqual([ids.interview])
    const dated = await list('owner', `from=2026-11-02&to=2026-11-02&learner=${members[`${alpha}:learner`]}`)
    expect(dated.body.items.map((item: { id: string }) => item.id)).toEqual([ids.e1])
    expect((await list('owner', 'status=in_progress&product=elevate')).body.items.every((item: { status: string }) => item.status === 'in_progress')).toBe(true)
    const bulk = await list('owner', `learner=${members[`${alpha}:bulk`]}`)
    expect(bulk.body.items).toHaveLength(50); expect(bulk.body.nextCursor).toBeTruthy()
    // A member of another organization is not a learner here; malformed input is rejected.
    expect((await list('owner', `learner=${members[`${beta}:betaOwner`]}`)).status).toBe(404)
    expect((await list('owner', 'after=not-a-cursor')).status).toBe(400)
    expect((await list('owner', 'from=2026-11-03&to=2026-11-01')).status).toBe(400)
    expect((await list('owner', 'product=prepare')).status).toBe(400)
  })

  it('shows Elevate transcript, results and recordings without internal paths, providers or token counts', async () => {
    const response = await detail('admin', 'elevate', ids.e1)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const body = response.body
    expect(body.readOnly).toBe(true)
    expect(body.transcript.map((turn: { text: string }) => turn.text)).toEqual(['Interviewer prompt about caching', 'Learner words about quarterly planning'])
    expect(body.transcript[1]).toMatchObject({ role: 'user', coachNote: 'Lead with the outcome.', score: { stars: 4, tags: ['clear'] }, audioStart: 2 })
    expect(body.results.metrics).toMatchObject({ wordsPerMinute: 132, fillerCount: 3 })
    expect(body.results.skillScores).toMatchObject({ clarity: 7.5, confidence: 6, pacing: null })
    expect(body.results.coachingInsights).toMatchObject({ topStrength: 'Clear opening', practicePlan: [{ title: 'Drill', focusSkill: 'pacing' }] })
    expect(body.recordings).toEqual(expect.arrayContaining([expect.objectContaining({ id: ids.e1Recording, mimeType: 'audio/webm', segmentIndex: 0 })]))
    const json = JSON.stringify(body)
    for (const secret of [...SECRETS, audioRoot, 'filePath', 'egressId', 'promptTokens']) expect(json).not.toContain(secret)
  })

  it('shows Interviews questions, answers and technical feedback but never authoring or evaluator material', async () => {
    const response = await detail('owner', 'interviews', ids.interview)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    const [attempt] = response.body.interview.attempts
    expect(attempt).toMatchObject({ status: 'ANSWERED', question: { text: 'How would you design a cache?', topic: 'caching' },
      capturedText: 'My cache answer', answer: { text: 'My cache answer' } })
    expect(attempt.feedback).toMatchObject({ status: 'COMPLETED', result: { classification: 'PARTIAL', gaps: ['No invalidation'], guidance: 'Discuss invalidation.' } })
    expect(attempt.feedback.result.criteria).toHaveLength(3)
    const json = JSON.stringify(response.body)
    for (const secret of SECRETS) expect(json).not.toContain(secret)
    // Product and id must agree: an Interviews session is not an Elevate session and vice versa.
    expect((await detail('owner', 'elevate', ids.interview)).status).toBe(404)
    expect((await detail('owner', 'interviews', ids.e1)).status).toBe(404)
  })

  it('shows Replay transcript and results and serves only plan-included recordings', async () => {
    const response = await detail('owner', 'replay', ids.replay)
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.body.replay.transcriptText).toBe('Replay transcript about the roadmap')
    expect(response.body.replay.structuredTranscript).toEqual([{ speaker: 'Learner', text: 'Replay transcript about the roadmap', startTime: 0, endTime: 4 }])
    expect(response.body.recordings).toEqual([
      expect.objectContaining({ id: ids.replayAudio, kind: 'audio', available: true }),
      expect.objectContaining({ id: ids.replayVideo, kind: 'video', available: false }),
    ])
    const json = JSON.stringify(response.body)
    for (const secret of [...SECRETS, replayRoot, 'storedPath', 'modelUsed', 'promptTokens', 'deliveryEvidence']) expect(json).not.toContain(secret)
    const audio = await api.get(streamPath('replay', ids.replay, ids.replayAudio)).set(token(alpha, 'owner')).set('Range', 'bytes=10-19')
    expect(audio.status).toBe(206); expect(audio.headers['content-range']).toBe('bytes 10-19/1000'); expect(audio.headers['content-type']).toBe('audio/webm')
    expect((await api.get(streamPath('replay', ids.replay, ids.replayVideo)).set(token(alpha, 'owner'))).status).toBe(403)
  })

  it('streams recordings with byte ranges through the header and through a bound playback ticket', async () => {
    const full = await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'admin')).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = []; res.on('data', (c: Buffer) => chunks.push(c)); res.on('end', () => done(null, Buffer.concat(chunks)))
    })
    expect(full.status).toBe(200); expect(Buffer.compare(full.body, bytes)).toBe(0)
    expect(full.headers).toMatchObject({ 'accept-ranges': 'bytes', 'cache-control': 'private, no-store', 'content-type': 'audio/webm', 'x-content-type-options': 'nosniff' })
    const part = await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'admin')).set('Range', 'bytes=0-99')
    expect(part.status).toBe(206); expect(part.headers['content-range']).toBe('bytes 0-99/1000'); expect(part.headers['content-length']).toBe('100')
    const tail = await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'admin')).set('Range', 'bytes=-10')
    expect(tail.status).toBe(206); expect(tail.headers['content-range']).toBe('bytes 990-999/1000')
    const beyond = await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'admin')).set('Range', 'bytes=5000-')
    expect(beyond.status).toBe(416); expect(beyond.headers['content-range']).toBe('bytes */1000')
    expect((await api.head(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'admin'))).headers['content-length']).toBe('1000')

    const issued = await ticket('admin', 'elevate', ids.e1, ids.e1Recording)
    expect(issued.status, JSON.stringify(issued.body)).toBe(200)
    expect(issued.body.url).toMatch(/^\/api\/workspaces\/current\/review\/sessions\/elevate\/.+\/stream\?review_media=/)
    const viaTicket = await api.get(issued.body.url).set('Range', 'bytes=100-199')
    expect(viaTicket.status).toBe(206); expect(viaTicket.headers['content-range']).toBe('bytes 100-199/1000')
    const ticketValue = new URL(issued.body.url, 'http://x').searchParams.get('review_media')!
    // A ticket names exactly one recording; it cannot be moved to another path, and a forged one is refused.
    expect((await api.get(`${streamPath('elevate', ids.e1, ids.linkRecording)}?review_media=${encodeURIComponent(ticketValue)}`)).status).toBe(403)
    expect((await api.get(`${streamPath('elevate', ids.e1, ids.e1Recording)}?review_media=forged`)).status).toBe(401)
    const learnerTicket = signWorkspaceReviewMediaToken({ userId: users.learner, workspaceId: alpha, membershipId: members[`${alpha}:learner`],
      product: 'elevate', sessionId: ids.e2, recordingId: ids.crossRecording })
    expect((await api.get(`${streamPath('elevate', ids.e2, ids.crossRecording)}?review_media=${learnerTicket}`)).status).toBe(403)
  })

  it('refuses a playback ticket once it expires, even for a reviewer who still has access', async () => {
    const issued = await ticket('owner', 'elevate', ids.e1, ids.e1Recording)
    expect(issued.status).toBe(200)
    const issuedAt = Date.now()
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(issuedAt + 59 * 60_000)
      expect((await api.get(issued.body.url).set('Range', 'bytes=0-9')).status).toBe(206)
      vi.setSystemTime(issuedAt + 61 * 60_000)
      const expired = await api.get(issued.body.url).set('Range', 'bytes=0-9')
      expect(expired.status).toBe(401)
      expect(expired.headers['content-range']).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
    // A fresh ticket works again for the same, still-authorized reviewer.
    expect((await api.get((await ticket('owner', 'elevate', ids.e1, ids.e1Recording)).body.url).set('Range', 'bytes=0-9')).status).toBe(206)
  })

  it('answers direct requests with known ids from another organization, Personal or the wrong path as not found', async () => {
    for (const [product, id] of [['elevate', ids.b1], ['elevate', ids.personal], ['elevate', ids.discarded], ['interviews', ids.prepare], ['replay', ids.e1]]) {
      expect((await detail('owner', product, id)).status, `${product}/${id}`).toBe(404)
    }
    const probes: Array<[string, string, string]> = [
      ['elevate', ids.b1, ids.b1Recording], ['elevate', ids.personal, ids.personalRecording], ['elevate', ids.e1, ids.b1Recording],
      ['elevate', ids.e2, ids.crossRecording], ['elevate', ids.e1, ids.linkRecording], ['replay', ids.replay, ids.e1Recording],
    ]
    for (const [product, session, recording] of probes) {
      expect((await api.get(streamPath(product, session, recording)).set(token(alpha, 'owner'))).status, `${session}/${recording}`).toBe(404)
      expect((await ticket('owner', product, session, recording)).status).toBe(404)
    }
    // The beta Owner cannot see alpha activity even though the learner belongs to both.
    expect((await detail('betaOwner', 'elevate', ids.e1, beta)).status).toBe(404)
    const betaList = await list('betaOwner', '', beta)
    expect(betaList.body.items.map((item: { id: string }) => item.id)).toEqual([ids.b1])
  })

  it('is enforced by the database: reviewer visibility needs a read-only transaction, the current workspace and an active Owner/Admin', async () => {
    const own = [ids.e1, ids.e2, ids.interview].sort()
    const seen = await raw('owner', alpha, visibleSessions)
    expect(seen).toEqual(expect.arrayContaining(own))
    for (const hidden of [ids.b1, ids.personal, ids.discarded, ids.prepare]) expect(seen).not.toContain(hidden)
    expect(await raw('owner', alpha, tx => tx.sessionTranscript.count({ where: { sessionId: ids.e1 } }))).toBe(1)
    expect(await raw('owner', alpha, tx => tx.interviewAssessment.count({ where: { snapshot: { attempt: { run: { sessionId: ids.interview } } } } }))).toBe(1)
    expect(await raw('owner', alpha, tx => tx.replayResult.count({ where: { replaySessionId: ids.replay } }))).toBe(1)
    // Writes are impossible in review mode.
    await expect(raw('owner', alpha, tx => tx.$executeRaw`UPDATE "Session" SET "sessionName"='changed' WHERE id=${ids.e1}`)).rejects.toThrow(/read-only/)
    await expect(raw('owner', alpha, tx => tx.$executeRaw`DELETE FROM "SessionTranscript" WHERE "sessionId"=${ids.e1}`)).rejects.toThrow(/read-only/)
    await expect(raw('owner', alpha, tx => tx.$executeRaw`UPDATE "ReplayResult" SET "transcriptText"='x' WHERE "replaySessionId"=${ids.replay}`)).rejects.toThrow(/read-only/)
    // The same reader in a writable transaction sees and changes nothing of another learner.
    const writable = { readOnly: false }
    expect(await raw('owner', alpha, visibleSessions, writable)).toEqual([])
    expect(await raw('owner', alpha, tx => tx.$executeRaw`UPDATE "SessionTranscript" SET "conversationData"='{}' WHERE "sessionId"=${ids.e1}`, writable)).toBe(0)
    expect(await raw('owner', alpha, tx => tx.$executeRaw`DELETE FROM "SessionRecording" WHERE "sessionId"=${ids.e1}`, writable)).toBe(0)
    expect(await raw('owner', alpha, tx => tx.$executeRaw`UPDATE "ReplayResult" SET "transcriptText"='x' WHERE "replaySessionId"=${ids.replay}`, writable)).toBe(0)
    // A learner, another workspace context and the manager reader see no other learner's raw content.
    expect(await raw('second', alpha, visibleSessions)).toEqual([ids.e2])
    expect(await raw('owner', beta, visibleSessions)).toEqual([])
    expect(await raw('owner', alpha, tx => tx.sessionTranscript.count({ where: { sessionId: ids.e1 } }), { reader: 'manager' })).toBe(0)
    expect(await admin.session.findUniqueOrThrow({ where: { id: ids.e1 } })).toMatchObject({ sessionName: 'Alpha elevate' })
  })

  it('records who reviewed which session and when, with ids only', async () => {
    const audits = await admin.workspaceAudit.findMany({ where: { workspaceId: alpha, action: { startsWith: 'session_review' } }, orderBy: { createdAt: 'asc' } })
    expect(audits.find(row => row.action === 'session_review_detail' && row.subjectId === ids.e1)).toMatchObject({ actorUserId: users.admin, metadata: { product: 'elevate' } })
    expect(audits.find(row => row.action === 'session_review_media_ticket' && row.subjectId === ids.e1)).toMatchObject({ metadata: { recordingId: ids.e1Recording } })
    expect(audits.find(row => row.action === 'session_review_recording' && row.subjectId === ids.replay)).toMatchObject({ actorUserId: users.owner })
    expect(audits.find(row => row.action === 'session_review_list')).toBeTruthy()
    const json = JSON.stringify(audits)
    for (const text of [...CONTENT, ...SECRETS, 'Lead with the outcome', 'Discuss invalidation']) expect(json).not.toContain(text)
    // Refused and not-found requests leave no review record.
    for (const probe of [ids.b1, ids.personal, ids.prepare]) expect(audits.some(row => row.subjectId === probe)).toBe(false)
    expect(audits.some(row => row.actorUserId === users.learner || row.actorUserId === users.betaOwner)).toBe(false)
    expect(await admin.workspaceAudit.count({ where: { workspaceId: beta, action: { startsWith: 'session_review' }, subjectId: ids.e1 } })).toBe(0)
  })

  it('ignores the learner self-view flags for review and keeps the learner archive working', async () => {
    await admin.user.update({ where: { id: users.learner }, data: { hideTranscriptText: true, hideAudioDownload: true } })
    try {
      const review = await detail('owner', 'elevate', ids.e1)
      expect(review.body.transcript).toHaveLength(2)
      expect((await api.get(streamPath('elevate', ids.e1, ids.e1Recording)).set(token(alpha, 'owner')).set('Range', 'bytes=0-9')).status).toBe(206)
      // The learner's own archive lists only their activity and still applies their own flags.
      const archive = await api.get('/api/workspaces/current/sessions').set(token(alpha, 'learner'))
      expect(archive.status).toBe(200)
      const archived = archive.body.items.map((item: { id: string }) => item.id)
      expect(archived).toEqual(expect.arrayContaining([ids.e1, ids.interview])); expect(archived).not.toContain(ids.e2)
      expect((await api.get(`/api/workspaces/current/sessions/${ids.e1}/transcript`).set(token(alpha, 'learner'))).status).toBe(403)
      expect((await api.get(`/api/workspaces/current/sessions/${ids.e2}`).set(token(alpha, 'learner'))).status).toBe(404)
    } finally {
      await admin.user.update({ where: { id: users.learner }, data: { hideTranscriptText: false, hideAudioDownload: false } })
    }
    const own = await api.get(`/api/workspaces/current/sessions/${ids.e1}/transcript`).set(token(alpha, 'learner'))
    expect(own.status).toBe(200); expect(own.body.messages[0].content).toBe('Learner words about quarterly planning')
  })

  it('ends access immediately when an Admin is demoted, including issued tickets and direct database reads', async () => {
    expect((await list('demoted')).status).toBe(200)
    const issued = await ticket('demoted', 'elevate', ids.e1, ids.e1Recording)
    expect(issued.status).toBe(200)
    const demote = await api.patch(`/api/workspaces/current/members/${members[`${alpha}:demoted`]}`).set(token(alpha, 'owner')).send({ role: 'LEARNER' })
    expect(demote.status, JSON.stringify(demote.body)).toBe(200)
    expect((await list('demoted')).status).toBe(403)
    expect((await detail('demoted', 'elevate', ids.e1)).status).toBe(403)
    expect((await api.get(issued.body.url).set('Range', 'bytes=0-9')).status).toBe(403)
    expect(await raw('demoted', alpha, visibleSessions)).toEqual([])
  })

  it('ends access for a suspended Admin and for everyone in a suspended workspace', async () => {
    const issued = await ticket('suspended', 'elevate', ids.e1, ids.e1Recording)
    expect(issued.status).toBe(200)
    await api.patch(`/api/workspaces/current/members/${members[`${alpha}:suspended`]}`).set(token(alpha, 'owner')).send({ state: 'SUSPENDED' }).expect(200)
    expect((await list('suspended')).status).toBe(403)
    expect((await api.get(issued.body.url)).status).toBe(403)
    expect(await raw('suspended', alpha, visibleSessions)).toEqual([])

    const ownerTicket = await ticket('owner', 'elevate', ids.e1, ids.e1Recording)
    await admin.workspace.update({ where: { id: alpha }, data: { state: 'SUSPENDED' } })
    try {
      expect((await list('owner')).status).toBe(403)
      expect((await detail('owner', 'elevate', ids.e1)).status).toBe(403)
      expect((await api.get(ownerTicket.body.url)).status).toBe(403)
      expect(await raw('owner', alpha, visibleSessions)).toEqual([])
    } finally {
      await admin.workspace.update({ where: { id: alpha }, data: { state: 'ACTIVE' } })
    }
    expect((await list('owner')).status).toBe(200)
  })
})
