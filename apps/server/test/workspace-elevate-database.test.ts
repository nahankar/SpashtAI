import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { signAgentScopeToken, signToken, signWorkspaceToken } from '../src/lib/jwt'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

/** One second of silent 8 kHz mono PCM; decodable by ffprobe. */
function wav(seconds = 1) {
  const samples = 8000 * seconds, data = Buffer.alloc(samples * 2), header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12)
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(8000, 24)
  header.writeUInt32LE(16000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

suite('organization Elevate voice path', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED, audio: process.env.LOCAL_AUDIO_PATH }
  const tag = 'ev-' + randomUUID().replaceAll('-', '').slice(0, 10)
  let audioRoot = ''
  let db: PrismaClient
  let app: express.Express
  let subscriptions: typeof import('../src/lib/sessionSubscriptions')
  let jobs: typeof import('../src/workspaces/jobScopes')
  let scopes: typeof import('../src/lib/dataScope')
  let alpha = '', beta = '', learner = '', other = '', suspended = ''
  const members: Record<string, string> = {}
  const identity = (id: string) => signToken({ userId: id, email: `${id}@example.invalid`, role: 'USER' })
  const headers = (workspaceId: string | null, userId: string) => ({
    Authorization: `Bearer ${identity(userId)}`,
    ...(workspaceId ? { 'x-spasht-workspace': signWorkspaceToken({ userId, workspaceId, membershipId: members[`${workspaceId}:${userId}`] }) } : {}),
  })
  const orgSession = async (workspaceId: string, userId: string, data: Record<string, unknown> = {}) => {
    const scope = { actorId: userId, workspaceId, membershipId: members[`${workspaceId}:${userId}`], role: 'LEARNER' as const, slug: '', timeZone: 'UTC', features: {}, origin: 'request' as const }
    return scopes.runWithDataScope(scope, () => db.session.create({ data: { userId, module: 'elevate', ...data } }))
  }

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    audioRoot = await mkdtemp(path.join(tmpdir(), 'spasht-elevate-'))
    process.env.LOCAL_AUDIO_PATH = audioRoot
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'
    process.env.AUTO_DELIVERY_ALIGNMENT_ENABLED = 'false'
    db = (await import('../src/lib/prisma')).prisma
    scopes = await import('../src/lib/dataScope')
    subscriptions = await import('../src/lib/sessionSubscriptions')
    jobs = await import('../src/workspaces/jobScopes')
    const { bindWorkspaceRequest, reenterDataScope, requireWorkspaceProduct } = await import('../src/workspaces/requestScope')
    const { requireAuth, requireAuthOrMediaToken } = await import('../src/middleware/auth')
    const { createSessionSegment, closeSessionSegment } = await import('../src/routes/session-segments')
    const recordings = await import('../src/routes/recordings')
    const conversations = await import('../src/routes/conversations')
    app = express(); app.use(express.json()); app.use(bindWorkspaceRequest)
    app.post('/sessions/:sessionId/segments', requireAuth, createSessionSegment)
    app.patch('/sessions/:sessionId/segments/:segmentId', requireAuth, closeSessionSegment)
    app.post('/sessions/:sessionId/recording/upload', requireAuth, recordings.recordingUpload.single('audio'), reenterDataScope, recordings.uploadSessionRecording)
    app.post('/sessions/:sessionId/recording/ticket', requireAuth, recordings.createSessionRecordingTicket)
    app.get('/sessions/:sessionId/recording/stream', requireAuthOrMediaToken, recordings.streamSessionRecording)
    app.post('/internal/sessions/:sessionId/messages', conversations.addConversationMessageForAgent)
    app.get('/api/coach/threads', requireAuth, requireWorkspaceProduct('coach'), (_req, res) => { res.json({ personal: true }) })
    const user = async (suffix: string) => (await admin.user.create({ data: { email: `${tag}-${suffix}@example.invalid`, emailVerified: true } })).id
    learner = await user('learner'); other = await user('other'); suspended = await user('suspended')
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY', concurrentVoice: 1 } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
    }
    const join = async (workspaceId: string, userId: string, state: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
      members[`${workspaceId}:${userId}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId, role: 'LEARNER', state, acceptedAt: new Date() } })).id
    }
    await join(alpha, learner); await join(alpha, other); await join(alpha, suspended); await join(beta, learner)
  }, 30000)

  afterAll(async () => {
    const ids = [learner, other, suspended].filter(Boolean)
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    await db?.$disconnect(); await admin.$disconnect()
    if (audioRoot) await rm(audioRoot, { recursive: true, force: true })
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled, LOCAL_AUDIO_PATH: env.audio })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
    delete process.env.AUTO_DELIVERY_ALIGNMENT_ENABLED
  })

  it('stores organization recordings under the workspace prefix and serves them only in that workspace', async () => {
    const session = await orgSession(alpha, learner)
    const segment = await request(app).post(`/sessions/${session.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-seg-1`, roomName: `${tag}-room-1` })
    expect(segment.status).toBe(201)
    const upload = await request(app).post(`/sessions/${session.id}/recording/upload`).set(headers(alpha, learner))
      .field('segmentId', `${tag}-seg-1`).field('durationSec', '1').attach('audio', wav(), { filename: 'take.wav', contentType: 'audio/wav' })
    expect(upload.status).toBe(201)
    const stored = await admin.sessionRecording.findUniqueOrThrow({ where: { segmentId: `${tag}-seg-1` } })
    expect(stored.filePath.startsWith(path.join(audioRoot, 'workspaces', alpha, 'sessions', session.id) + path.sep)).toBe(true)
    await request(app).patch(`/sessions/${session.id}/segments/${tag}-seg-1`)
    await admin.sessionSegment.update({ where: { id: `${tag}-seg-1` }, data: { endedAt: new Date() } })
    const played = await request(app).get(`/sessions/${session.id}/recording/stream`).set(headers(alpha, learner))
    expect(played.status).toBe(200)
    expect(played.headers['content-type']).toContain('audio')
    expect((await request(app).get(`/sessions/${session.id}/recording/stream`).set(headers(null, learner))).status).toBe(404)
    expect((await request(app).get(`/sessions/${session.id}/recording/stream`).set(headers(beta, learner))).status).toBe(404)
    expect((await request(app).get(`/sessions/${session.id}/recording/stream`).set(headers(alpha, other))).status).toBe(404)

    // <audio src> playback: a session-bound ticket, with membership rechecked on every range request.
    expect((await request(app).post(`/sessions/${session.id}/recording/ticket`).set(headers(null, learner))).status).toBe(400)
    expect((await request(app).post(`/sessions/${session.id}/recording/ticket`).set(headers(alpha, other))).status).toBe(404)
    expect((await request(app).post(`/sessions/${session.id}/recording/ticket`).set(headers(beta, learner))).status).toBe(404)
    const issued = await request(app).post(`/sessions/${session.id}/recording/ticket`).set(headers(alpha, learner))
    expect(issued.status).toBe(200)
    const media = (userId: string, ticket: string, id = session.id) =>
      request(app).get(`/sessions/${id}/recording/stream`).query({ access_token: identity(userId), workspace_media: ticket }).set('Range', 'bytes=0-15')
    const ranged = await media(learner, issued.body.ticket)
    expect(ranged.status).toBe(206)
    expect(ranged.headers['content-type']).toContain('audio')
    expect((await media(other, issued.body.ticket)).status).toBe(403)
    expect((await media(learner, issued.body.ticket, (await orgSession(alpha, learner)).id)).status).toBe(403)
    expect((await media(learner, issued.body.ticket.slice(0, -2) + 'xx')).status).toBe(401)
    expect((await media(learner, signWorkspaceToken({ userId: learner, workspaceId: alpha, membershipId: members[`${alpha}:${learner}`] }))).status).toBe(401)
    expect((await media(learner, issued.body.ticket).set('x-spasht-workspace', 'x')).status).toBe(400)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${learner}`] }, data: { state: 'SUSPENDED' } })
    try {
      const revoked = await media(learner, issued.body.ticket)
      expect(revoked.status).toBe(404)
      expect(revoked.body.code).toMatch(/^WORKSPACE_|^MEMBERSHIP_/)
    } finally {
      await admin.workspaceMember.update({ where: { id: members[`${alpha}:${learner}`] }, data: { state: 'ACTIVE' } })
    }
  })

  it('keeps Personal-only Coach closed inside an organization', async () => {
    const inside = await request(app).get('/api/coach/threads').set(headers(alpha, learner))
    expect(inside.status).toBe(403)
    expect(inside.body.code).toBe('WORKSPACE_FEATURE_UNAVAILABLE')
    expect((await request(app).get('/api/coach/threads').set(headers(null, learner))).body).toEqual({ personal: true })
  })

  it('refuses organization playback of a stored path outside its workspace prefix', async () => {
    const session = await orgSession(alpha, learner)
    await admin.sessionRecording.create({ data: { sessionId: session.id, egressId: `${tag}-foreign`, filePath: path.join(audioRoot, 'personal.wav'), status: 'completed', recordingType: 'user' } })
    const { writeFile } = await import('node:fs/promises'); await writeFile(path.join(audioRoot, 'personal.wav'), wav())
    expect((await request(app).get(`/sessions/${session.id}/recording/stream`).set(headers(alpha, learner))).status).toBe(404)
  })

  it('refuses to close a recent leftover session unless the learner takes it over', async () => {
    const first = await orgSession(alpha, learner)
    const started = await request(app).post(`/sessions/${first.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-own-a`, roomName: `${tag}-own-a` })
    expect(started.status).toBe(201)
    const second = await orgSession(alpha, learner)
    const blocked = await request(app).post(`/sessions/${second.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-own-b`, roomName: `${tag}-own-b` })
    expect(blocked.status).toBe(409)
    expect(blocked.body).toMatchObject({ code: 'VOICE_SESSION_ACTIVE', openSessions: [first.id] })
    expect((await admin.sessionSegment.findUniqueOrThrow({ where: { id: `${tag}-own-a` } })).endedAt).toBeNull()

    const rooms = await import('../src/lib/livekitRooms')
    const released = vi.spyOn(rooms, 'releaseLivekitRooms').mockResolvedValue(undefined)
    const taken = await request(app).post(`/sessions/${second.id}/segments`).set(headers(alpha, learner))
      .send({ segmentId: `${tag}-own-c`, roomName: `${tag}-own-c`, takeover: true })
    expect(taken.status).toBe(201)
    expect(released).toHaveBeenCalledWith(expect.arrayContaining([`${tag}-own-a`]))
    const closed = await admin.sessionSegment.findUniqueOrThrow({ where: { id: `${tag}-own-a` } })
    expect(closed.endedAt).not.toBeNull()
    expect(closed.activeDurationSec).toBeGreaterThanOrEqual(0)
    expect(closed.audioStatus).toBe('pending')
    const late = await request(app).patch(`/sessions/${first.id}/segments/${tag}-own-a`).set(headers(alpha, learner))
      .send({ endedAt: new Date(closed.endedAt!.getTime() + 120_000).toISOString(), audioStatus: 'available' })
    expect(late.status).toBe(200)
    const afterLate = await admin.sessionSegment.findUniqueOrThrow({ where: { id: `${tag}-own-a` } })
    expect(afterLate.endedAt?.getTime()).toBe(closed.endedAt!.getTime())
    expect(afterLate.activeDurationSec).toBe(closed.activeDurationSec)
    expect(afterLate.audioStatus).toBe('available')
    const upload = await request(app).post(`/sessions/${first.id}/recording/upload`).set(headers(alpha, learner))
      .field('segmentId', `${tag}-own-a`).field('durationSec', '1').attach('audio', wav(), { filename: 'takeover.wav', contentType: 'audio/wav' })
    expect(upload.status).toBe(201)
    expect((await admin.sessionSegment.findUniqueOrThrow({ where: { id: `${tag}-own-c` } })).endedAt).toBeNull()
    await admin.sessionSegment.update({ where: { id: `${tag}-own-c` }, data: { endedAt: new Date() } })
    released.mockRestore()

    const stale = await orgSession(alpha, learner)
    await request(app).post(`/sessions/${stale.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-own-d`, roomName: `${tag}-own-d` })
    await admin.$executeRaw`UPDATE "SessionSegment" SET "updatedAt" = NOW() - interval '7 hours' WHERE id = ${`${tag}-own-d`}`
    const third = await orgSession(alpha, learner)
    const abandoned = await request(app).post(`/sessions/${third.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-own-e`, roomName: `${tag}-own-e` })
    expect(abandoned.status).toBe(201)
    expect((await admin.sessionSegment.findUniqueOrThrow({ where: { id: `${tag}-own-d` } })).endedAt).not.toBeNull()
    await admin.sessionSegment.updateMany({ where: { id: { in: [`${tag}-own-c`, `${tag}-own-e`] } }, data: { endedAt: new Date() } })
  })

  it('enforces organization voice concurrency under a race', async () => {
    const [first, second] = [await orgSession(alpha, learner), await orgSession(alpha, other)]
    const responses = await Promise.all([
      request(app).post(`/sessions/${first.id}/segments`).set(headers(alpha, learner)).send({ segmentId: `${tag}-race-a`, roomName: `${tag}-race-a` }),
      request(app).post(`/sessions/${second.id}/segments`).set(headers(alpha, other)).send({ segmentId: `${tag}-race-b`, roomName: `${tag}-race-b` }),
    ])
    // The earlier test's segment has ended; capacity is one.
    const statuses = responses.map(r => r.status).sort()
    expect(statuses[0]).toBe(201)
    expect([409, 429]).toContain(statuses[1])
    expect(await admin.sessionSegment.count({ where: { id: { in: [`${tag}-race-a`, `${tag}-race-b`] } } })).toBe(1)
    // Another organization has its own capacity.
    const elsewhere = await orgSession(beta, learner)
    expect((await request(app).post(`/sessions/${elsewhere.id}/segments`).set(headers(beta, learner)).send({ segmentId: `${tag}-beta`, roomName: `${tag}-beta` })).status).toBe(201)
    await admin.sessionSegment.updateMany({ where: { id: { in: [`${tag}-race-a`, `${tag}-race-b`, `${tag}-beta`] } }, data: { endedAt: new Date() } })
  })

  it('accepts agent callbacks only with the internal token and a scope for the same session', async () => {
    const session = await orgSession(alpha, learner)
    const scope = signAgentScopeToken({ sessionId: session.id, userId: learner, workspaceId: alpha, membershipId: members[`${alpha}:${learner}`] })
    const agent = { 'x-internal-agent-token': 'dev-internal-agent-token', 'x-spasht-workspace-scope': scope }
    const body = { role: 'assistant', content: 'Welcome back.' }
    expect((await request(app).post(`/internal/sessions/${session.id}/messages`).set(agent).send(body)).status).toBeLessThan(300)
    expect((await request(app).post(`/internal/sessions/${session.id}/messages`).set({ 'x-spasht-workspace-scope': scope }).send(body)).status).toBe(401)
    const another = await orgSession(alpha, learner)
    expect((await request(app).post(`/internal/sessions/${another.id}/messages`).set(agent).send(body)).status).toBe(403)
    // Without the scope the organization session is invisible to the agent.
    expect((await request(app).post(`/internal/sessions/${session.id}/messages`).set({ 'x-internal-agent-token': 'dev-internal-agent-token' }).send(body)).status).toBe(404)
    // A scope signed before suspension stops working.
    const stale = await orgSession(alpha, suspended)
    const staleScope = signAgentScopeToken({ sessionId: stale.id, userId: suspended, workspaceId: alpha, membershipId: members[`${alpha}:${suspended}`] })
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'SUSPENDED' } })
    expect((await request(app).post(`/internal/sessions/${stale.id}/messages`).set({ ...agent, 'x-spasht-workspace-scope': staleScope }).send(body)).status).toBe(404)
  })

  it('delivers live updates only to current members viewing their own organization session', async () => {
    const session = await orgSession(alpha, other)
    const workspaceToken = signWorkspaceToken({ userId: other, workspaceId: alpha, membershipId: members[`${alpha}:${other}`] })
    expect(await subscriptions.canSubscribeToWorkspaceSession(identity(other), workspaceToken, session.id)).toBe(true)
    expect(await subscriptions.canSubscribeToPersonalSession(identity(other), session.id)).toBe(false)
    expect(await subscriptions.canSubscribeToWorkspaceSession(identity(learner), workspaceToken, session.id)).toBe(false)
    const learnerToken = signWorkspaceToken({ userId: learner, workspaceId: alpha, membershipId: members[`${alpha}:${learner}`] })
    expect(await subscriptions.canSubscribeToWorkspaceSession(identity(learner), learnerToken, session.id)).toBe(false)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${other}`] }, data: { state: 'SUSPENDED' } })
    expect(await subscriptions.canSubscribeToWorkspaceSession(identity(other), workspaceToken, session.id)).toBe(false)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${other}`] }, data: { state: 'ACTIVE' } })
  })

  it('destroys a discarded organization session, its Pulse and media after the membership ended', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { existsSync } = await import('node:fs')
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'ACTIVE' } })
    const session = await orgSession(alpha, suspended, { endedAt: new Date() })
    const dir = path.join(audioRoot, 'workspaces', alpha, 'sessions', session.id); await mkdir(dir, { recursive: true })
    const file = path.join(dir, 'take.wav'); await writeFile(file, wav())
    const scope = { actorId: suspended, workspaceId: alpha, membershipId: members[`${alpha}:${suspended}`], role: 'LEARNER' as const, slug: '', timeZone: 'UTC', features: {}, origin: 'request' as const }
    await scopes.runWithDataScope(scope, async () => {
      await db.sessionRecording.create({ data: { sessionId: session.id, egressId: `client-${tag}-del`, filePath: file, status: 'completed', recordingType: 'user' } })
      await db.progressPulse.create({ data: { userId: suspended, skill: 'clarity', score: 6, source: 'elevate', sessionId: session.id } })
      await db.session.update({ where: { id: session.id }, data: { discardedAt: new Date() } })
    })
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'SUSPENDED' } })
    const { processSessionDeletion } = await import('../src/lib/sessionDeletionWorker')
    const { withCleanupScope } = await import('../src/workspaces/requestScope')
    expect(await withCleanupScope(beta, () => processSessionDeletion(session.id))).toBe(false)
    expect(await withCleanupScope(alpha, () => processSessionDeletion(session.id))).toBe(true)
    expect(await admin.session.count({ where: { id: session.id } })).toBe(0)
    expect(await admin.progressPulse.count({ where: { sessionId: session.id } })).toBe(0)
    expect(existsSync(file)).toBe(false)
  })

  it('runs worker sweeps for Personal and each active organization learner in their own scope', async () => {
    await orgSession(alpha, learner, { endedAt: new Date(), paceReconciliationStatus: 'pending' })
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'ACTIVE' } })
    await orgSession(alpha, suspended, { endedAt: new Date(), paceReconciliationStatus: 'pending' })
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'SUSPENDED' } })
    const seen: string[] = []
    await jobs.sweepAllScopes('pace_reconciliation', async () => {
      const scope = scopes.currentDataScope()
      seen.push(scope ? `${scope.workspaceId}:${scope.actorId}` : 'personal')
    })
    expect(seen[0]).toBe('personal')
    expect(seen).toContain(`${alpha}:${learner}`)
    expect(seen).not.toContain(`${alpha}:${suspended}`)
  })
})
