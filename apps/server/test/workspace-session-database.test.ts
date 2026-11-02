import { WebSocket, WebSocketServer } from 'ws'
import { once } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { signToken } from '../src/lib/jwt'
import { workspaceRecordingKey } from '../src/workspaces/sessionMedia'
import { assertSafeWorkspaceStartup, assertWorkspaceDatabaseSafety } from '../src/workspaces/databaseSafety'
import { SessionSubscriptions } from '../src/lib/sessionSubscriptions'

vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres' }) }
})
const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip
suite('workspace Session aggregate and media isolation', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, audio: process.env.LOCAL_AUDIO_PATH, enabled: process.env.WORKSPACES_ENABLED, archive: process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED }
  const tag = 'ws-' + randomUUID().replaceAll('-', '').slice(0, 12)
  let db: PrismaClient, api: ReturnType<typeof request>, root = ''
  let alpha = '', beta = '', learner = '', otherLearner = '', operator = '', tokenA = '', tokenB = '', tokenOther = '', identity = '', operatorIdentity = ''
  let personal = '', sessionA = '', sessionB = '', sessionOther = '', recordingA = '', recordingB = '', segmentA = '', segmentB = ''
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })
  const mediaPath = (session: string, recording: string) => `/api/workspaces/current/sessions/${session}/recordings/${recording}/stream`
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'; process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED = 'true'
    // This file is independently runnable, without another test's role setup.
    await admin.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='tenancy_test_app') THEN CREATE ROLE tenancy_test_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`)
    await admin.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO tenancy_test_app')
    await admin.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO tenancy_test_app')
    db = (await import('../src/lib/prisma')).prisma
    const { workspaceRouter, platformWorkspacesRouter } = await import('../src/workspaces/routes')
    const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter); app.use('/api/admin/workspaces', platformWorkspacesRouter); api = request(app)
    root = await mkdtemp(path.join(os.tmpdir(), 'spasht-workspace-recordings-')); process.env.LOCAL_AUDIO_PATH = root
    const makeUser = async (suffix: string, role: 'USER' | 'ADMIN' = 'USER') => (await admin.user.create({ data: { email: `${tag}-${suffix}@example.invalid`, emailVerified: true, role } })).id
    learner = await makeUser('learner'); otherLearner = await makeUser('other'); operator = await makeUser('platform', 'ADMIN')
    const users = await admin.user.findMany({ where: { id: { in: [learner, otherLearner, operator] } } })
    const jwt = (id: string) => { const u = users.find(u => u.id === id)!; return signToken({ userId: u.id, email: u.email, role: u.role }) }
    identity = jwt(learner); operatorIdentity = jwt(operator)
    for (const suffix of ['alpha', 'beta']) {
      const created = await api.post('/api/admin/workspaces').set(bearer(jwt(operator))).send({ name: suffix, slug: `${tag}-${suffix}`, ownerEmail: users.find(u => u.id === learner)!.email })
      expect(created.status, JSON.stringify(created.body)).toBe(200)
      const workspace = created.body.workspace
      if (suffix === 'alpha') alpha = workspace.id; else beta = workspace.id
      await api.post(`/api/workspaces/entry/${workspace.slug}/accept`).set(bearer(identity))
      const entered = await api.post(`/api/workspaces/entry/${workspace.slug}`).set(bearer(identity))
      if (suffix === 'alpha') tokenA = entered.body.accessToken; else tokenB = entered.body.accessToken
    }
    await admin.workspaceMember.create({ data: { workspaceId: alpha, userId: otherLearner, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() } })
    tokenOther = (await api.post(`/api/workspaces/entry/${tag}-alpha`).set(bearer(jwt(otherLearner)))).body.accessToken
    // Only fixture provisioning creates organization sessions in this checkpoint.
    personal = (await admin.session.create({ data: { userId: learner, module: 'elevate', sessionName: `${tag}-personal` } })).id
    sessionA = (await admin.session.create({ data: { workspaceId: alpha, userId: learner, module: 'elevate', sessionName: `${tag}-alpha` } })).id
    sessionB = (await admin.session.create({ data: { workspaceId: beta, userId: learner, module: 'elevate', sessionName: `${tag}-beta` } })).id
    sessionOther = (await admin.session.create({ data: { workspaceId: alpha, userId: otherLearner, module: 'elevate', sessionName: `${tag}-other` } })).id
    segmentA = `${tag}-segment-a`; segmentB = `${tag}-segment-b`
    for (const [id, sessionId] of [[segmentA, sessionA], [segmentB, sessionB]]) {
      await admin.sessionSegment.create({ data: { id, sessionId, segmentIndex: 0, roomName: id, startedAt: new Date() } })
      await admin.sessionTurn.create({ data: { sessionId, segmentId: id, turnIndex: 0, localTurnIndex: 0, sequenceNo: 0, role: 'user', text: 'scoped turn' } })
    }
    for (const [sessionId, label] of [[personal, 'personal'], [sessionA, 'alpha'], [sessionB, 'beta']]) {
      await admin.sessionTranscript.create({ data: { sessionId, conversationData: { messages: [{ id: label, role: 'user', content: `${label}-private-text`, timestamp: '2026-11-02', audio_url: 'SECRET_AUDIO_URL' }], audioFiles: [{ s3Key: 'SECRET_STORAGE_KEY' }] } } })
      await admin.sessionMetrics.create({ data: { sessionId, totalTurns: 1 } })
    }
    recordingA = `${tag}-audio-a`; recordingB = `${tag}-audio-b`
    for (const [workspaceId, sessionId, recordingId, segmentId, text] of [[alpha, sessionA, recordingA, segmentA, 'alpha-private-audio'], [beta, sessionB, recordingB, segmentB, 'beta-private-audio']]) {
      const key = workspaceRecordingKey(workspaceId, sessionId, recordingId, 'webm')
      await mkdir(path.dirname(path.join(root, key)), { recursive: true }); await writeFile(path.join(root, key), text)
      await admin.sessionRecording.create({ data: { id: recordingId, sessionId, segmentId, egressId: recordingId, filePath: key } })
    }
  }, 30000)
  afterAll(async () => {
    await admin.workspace.deleteMany({ where: { id: { in: [alpha, beta] } } })
    await admin.user.deleteMany({ where: { id: { in: [learner, otherLearner, operator] } } })
    if (root) await rm(root, { recursive: true, force: true })
    await db?.$disconnect(); await admin.$disconnect()
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, LOCAL_AUDIO_PATH: env.audio, WORKSPACES_ENABLED: env.enabled, WORKSPACE_SESSION_ARCHIVE_ENABLED: env.archive })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })
  it('keeps legacy ORM, raw SQL, child reads and worker scans Personal-only', async () => {
    expect((await db.session.findMany({ where: { userId: learner } })).map(s => s.id)).toEqual([personal])
    const raw = await db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Session" WHERE "userId"=${learner}`
    expect(raw.map(s => s.id)).toEqual([personal])
    expect(await db.session.findUnique({ where: { id: sessionA } })).toBeNull()
    expect(await db.sessionTranscript.findUnique({ where: { sessionId: sessionA } })).toBeNull()
    expect(await db.sessionRecording.findUnique({ where: { id: recordingA } })).toBeNull()
    expect(await db.sessionSegment.findUnique({ where: { id: segmentA } })).toBeNull()
    expect((await db.session.findMany({ where: { endedAt: null, userId: learner } })).map(s => s.id)).toEqual([personal])
  })
  it('enforces parent ownership for scoped raw queries and child writes', async () => {
    const { withWorkspaceAccess } = await import('../src/workspaces/context')
    const { verifyWorkspaceToken } = await import('../src/lib/jwt')
    await withWorkspaceAccess(verifyWorkspaceToken(tokenA), async tx => {
      expect((await tx.session.findMany({ where: { userId: learner } })).map(s => s.id)).toEqual([sessionA])
      const raw = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Session" WHERE "userId"=${learner}`
      expect(raw.map(s => s.id)).toEqual([sessionA])
      expect((await tx.sessionTranscript.findMany()).map(t => t.sessionId)).toEqual([sessionA])
      expect((await tx.sessionMetrics.findMany()).map(t => t.sessionId)).toEqual([sessionA])
      expect((await tx.sessionTurn.findMany()).map(t => t.sessionId)).toEqual([sessionA])
      expect((await tx.sessionSegment.findMany()).map(t => t.id)).toEqual([segmentA])
    })
    await expect(db.sessionTranscript.update({ where: { sessionId: sessionA }, data: { conversationData: {} } })).rejects.toThrow()
    await expect(db.sessionRecording.create({ data: { sessionId: sessionA, egressId: `${tag}-forged`, filePath: 'forged.webm' } })).rejects.toThrow()
  })
  it('keeps the actual legacy session handlers Personal-only regardless of role or request body', async () => {
    const { getSession, createSession } = await import('../src/routes/sessions')
    const { requireAuth } = await import('../src/middleware/auth')
    const app = express(); app.use(express.json()); app.get('/sessions/:id', requireAuth, getSession); app.post('/sessions', requireAuth, createSession)
    expect((await request(app).get(`/sessions/${sessionA}`).set(bearer(identity))).status).toBe(404)
    expect((await request(app).get(`/sessions/${sessionA}`).set(bearer(operatorIdentity))).status).toBe(404)
    const id = `${tag}-legacy-create`
    try {
      const created = await request(app).post('/sessions').set(bearer(identity)).send({ id, workspaceId: alpha, workspaceKind: 'ORGANIZATION' })
      expect(created.status).toBe(201)
      expect(created.body.session.workspaceKind).toBe('PERSONAL')
      expect(created.body.session.workspaceId).not.toBe(alpha)
    } finally { await admin.session.deleteMany({ where: { id } }) }
  })
  it('preserves legacy inserts for new accounts without a chooser visit', async () => {
    const fresh = await admin.user.create({ data: { email: `${tag}-fresh@example.invalid` } })
    try {
      const session = await db.session.create({ data: { userId: fresh.id, module: 'elevate' } })
      expect(session.workspaceKind).toBe('PERSONAL')
      expect((await admin.workspace.findUniqueOrThrow({ where: { id: session.workspaceId } })).personalOwnerId).toBe(fresh.id)
    } finally { await admin.user.delete({ where: { id: fresh.id } }) }
  })
  it('scopes archive metadata to the current workspace and learner, including for an Owner', async () => {
    expect((await api.get('/api/workspaces/current/sessions').set(bearer(tokenA))).body.items.map((s: { id: string }) => s.id)).toEqual([sessionA])
    expect((await api.get('/api/workspaces/current/sessions').set(bearer(tokenB))).body.items.map((s: { id: string }) => s.id)).toEqual([sessionB])
    for (const id of [sessionB, sessionOther, personal]) expect((await api.get(`/api/workspaces/current/sessions/${id}`).set(bearer(tokenA))).status).toBe(404)
    expect((await api.get('/api/workspaces/current/sessions').set(bearer(identity))).status).toBe(401)
    const detail = await api.get(`/api/workspaces/current/sessions/${sessionA}`).set(bearer(tokenA))
    expect(detail.status).toBe(200); expect(JSON.stringify(detail.body)).not.toMatch(/filePath|egressId|SECRET/)
  })
  it('returns only supported transcript fields and honors viewing restrictions', async () => {
    const response = await api.get(`/api/workspaces/current/sessions/${sessionA}/transcript`).set(bearer(tokenA))
    expect(response.body.messages[0].content).toBe('alpha-private-text')
    expect(JSON.stringify(response.body)).not.toContain('SECRET')
    await admin.user.update({ where: { id: learner }, data: { hideTranscriptText: true } })
    expect((await api.get(`/api/workspaces/current/sessions/${sessionA}/transcript`).set(bearer(tokenA))).status).toBe(403)
    await admin.user.update({ where: { id: learner }, data: { hideTranscriptText: false } })
  })
  it('streams only the parent-bound recording and handles byte ranges', async () => {
    const response = await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA)).set('Range', 'bytes=0-4')
    expect(response.status).toBe(206); expect(response.headers['content-range']).toBe('bytes 0-4/19')
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.body.toString()).toBe('alpha')
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenB))).status).toBe(404)
    expect((await api.get(mediaPath(sessionB, recordingB)).set(bearer(tokenA))).status).toBe(404)
    expect((await api.get(mediaPath(sessionA, recordingB)).set(bearer(tokenA))).status).toBe(404)
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA)).set('Range', 'bytes=999-')).status).toBe(416)
  })
  it('rejects arbitrary storage paths and symlinks into another workspace', async () => {
    const key = workspaceRecordingKey(alpha, sessionA, recordingA, 'webm')
    await admin.sessionRecording.update({ where: { id: recordingA }, data: { filePath: path.join(root, workspaceRecordingKey(beta, sessionB, recordingB, 'webm')) } })
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA))).status).toBe(404)
    await admin.sessionRecording.update({ where: { id: recordingA }, data: { filePath: key } })
    await rm(path.join(root, key)); await symlink(path.join(root, workspaceRecordingKey(beta, sessionB, recordingB, 'webm')), path.join(root, key))
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA))).status).toBe(404)
    await rm(path.join(root, key)); await writeFile(path.join(root, key), 'alpha-private-audio')
  })
  it('rechecks playback restrictions, membership and workspace suspension', async () => {
    await admin.user.update({ where: { id: learner }, data: { hideAudioDownload: true } })
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA))).status).toBe(403)
    await admin.user.update({ where: { id: learner }, data: { hideAudioDownload: false } })
    await admin.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: alpha, userId: learner } }, data: { state: 'SUSPENDED' } })
    expect((await api.get(mediaPath(sessionA, recordingA)).set(bearer(tokenA))).status).toBe(403)
    await admin.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: alpha, userId: learner } }, data: { state: 'ACTIVE' } })
    await admin.workspace.update({ where: { id: alpha }, data: { state: 'SUSPENDED' } })
    expect((await api.get(`/api/workspaces/current/sessions/${sessionA}`).set(bearer(tokenA))).status).toBe(403)
    await admin.workspace.update({ where: { id: alpha }, data: { state: 'ACTIVE' } })
  })
  it('prevents relocation and cross-session segment references below application checks', async () => {
    await expect(admin.session.update({ where: { id: sessionA }, data: { workspaceId: beta } })).rejects.toThrow()
    await expect(admin.sessionRecording.update({ where: { id: recordingA }, data: { sessionId: sessionB } })).rejects.toThrow()
    await expect(admin.sessionRecording.update({ where: { id: recordingA }, data: { segmentId: segmentB } })).rejects.toThrow()
    await expect(admin.sessionTranscript.update({ where: { sessionId: sessionA }, data: { sessionId: sessionB } })).rejects.toThrow()
    await expect(admin.session.create({ data: { userId: otherLearner, workspaceId: beta, module: 'elevate' } })).rejects.toThrow()
  })
  it('refuses unscoped product associations to organization sessions', async () => {
    await expect(admin.bankFollowUpJob.create({ data: { sessionId: sessionA, key: tag, payload: {} } })).rejects.toThrow()
    await expect(admin.progressPulse.create({ data: { userId: learner, source: 'elevate', sessionId: sessionA, skill: 'clarity', score: 5 } })).rejects.toThrow()
  })
  it('delivers an authorized update over a real WebSocket using the HTTP persistence path', async () => {
    const { setWebSocketServer, subscribeClientToSession, addConversationMessage } = await import('../src/routes/conversations')
    const { requireAuth } = await import('../src/middleware/auth')
    const socketServer = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 16 * 1024 })
    await once(socketServer, 'listening')
    setWebSocketServer(socketServer)
    socketServer.on('connection', socket => socket.on('message', async raw => {
      const message = JSON.parse(raw.toString())
      const allowed = await subscribeClientToSession(socket, message.sessionId, message.accessToken)
      socket.send(JSON.stringify({ type: allowed ? 'subscribed' : 'subscription_error' }))
    }))
    const address = socketServer.address() as { port: number }
    const client = new WebSocket(`ws://127.0.0.1:${address.port}`)
    try {
      await once(client, 'open')
      let received = once(client, 'message')
      client.send(JSON.stringify({ type: 'subscribe', sessionId: personal }))
      expect(JSON.parse(String((await received)[0])).type).toBe('subscription_error')
      received = once(client, 'message')
      client.send(JSON.stringify({ type: 'subscribe', sessionId: personal, accessToken: identity }))
      expect(JSON.parse(String((await received)[0])).type).toBe('subscribed')
      const app = express(); app.use(express.json()); app.post('/sessions/:sessionId/messages', requireAuth, addConversationMessage)
      received = once(client, 'message')
      const saved = await request(app).post(`/sessions/${personal}/messages`).set(bearer(identity)).send({ role: 'user', content: 'authorized live answer' })
      expect(saved.status).toBe(201)
      const update = JSON.parse(String((await received)[0]))
      expect(update).toMatchObject({ type: 'conversation_update', sessionId: personal, message: { content: 'authorized live answer' } })
    } finally {
      client.terminate()
      await new Promise<void>(resolve => socketServer.close(() => resolve()))
    }
  })
  it('authenticates Personal subscriptions and rechecks discard before sending content', async () => {
    const registry = new SessionSubscriptions(), sent: string[] = []
    const client = { readyState: 1, send: (message: unknown) => { sent.push(String(message)) } }
    expect(await registry.subscribe(client, personal, '')).toBe(false)
    expect(await registry.subscribe(client, personal, tokenA)).toBe(false)
    expect(await registry.subscribe(client, sessionA, identity)).toBe(false)
    expect(await registry.subscribe(client, personal, identity, db)).toBe(true)
    await registry.publish([client], personal, { message: { content: 'personal-event' } }, db)
    expect(sent.some(message => message.includes('personal-event'))).toBe(true)
    sent.length = 0
    await admin.session.update({ where: { id: personal }, data: { discardedAt: new Date() } })
    await registry.publish([client], personal, { message: { content: 'MUST_NOT_SEND' } }, db)
    expect(sent.join('')).not.toContain('MUST_NOT_SEND')
    expect(sent.join('')).toContain('subscription_error')
  })
  it('refuses privileged runtime startup even after a workspace flag rollback', async () => {
    await expect(assertWorkspaceDatabaseSafety(admin)).rejects.toThrow('non-owner database role')
    process.env.WORKSPACES_ENABLED = 'false'
    await expect(assertSafeWorkspaceStartup(admin)).rejects.toThrow('even when workspace rollout is disabled')
    await expect(assertSafeWorkspaceStartup(db)).resolves.toBeUndefined()
    process.env.WORKSPACES_ENABLED = 'true'
  })
  it('fails closed when archive rollout is disabled', async () => {
    process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED = 'false'
    expect((await api.get('/api/workspaces/current/sessions').set(bearer(tokenA))).status).toBe(403)
    process.env.WORKSPACE_SESSION_ARCHIVE_ENABLED = 'true'
  })
})
