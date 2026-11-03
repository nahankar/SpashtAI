import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

suite('organization Replay path', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED, uploads: process.env.REPLAY_UPLOAD_PATH }
  const tag = 'rp-' + randomUUID().replaceAll('-', '').slice(0, 10)
  let uploads = ''
  let app: express.Express
  let readiness: Record<string, boolean>
  let alpha = '', beta = '', learner = '', other = ''
  const members: Record<string, string> = {}
  const identity = (id: string) => signToken({ userId: id, email: `${id}@example.invalid`, role: 'USER' })
  const as = (workspaceId: string | null, userId: string) => ({
    Authorization: `Bearer ${identity(userId)}`,
    ...(workspaceId ? { 'x-spasht-workspace': signWorkspaceToken({ userId, workspaceId, membershipId: members[`${workspaceId}:${userId}`] }) } : {}),
  })
  const create = (workspaceId: string | null, userId: string) =>
    request(app).post('/api/replay/sessions').set(as(workspaceId, userId)).send({ sessionName: 'Weekly sync', meetingType: 'standup', userRole: 'participant' })

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    uploads = await mkdtemp(path.join(tmpdir(), 'spasht-replay-'))
    process.env.REPLAY_UPLOAD_PATH = uploads
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'
    readiness = (await import('../src/workspaces/productAccess')).WORKSPACE_FEATURE_READINESS
    readiness.replay = true
    const { bindWorkspaceRequest } = await import('../src/workspaces/requestScope')
    const { requireAuth } = await import('../src/middleware/auth')
    const { requireFeature } = await import('../src/lib/featureFlags')
    const replayRouter = (await import('../src/routes/replay')).default
    app = express(); app.use(express.json()); app.use(bindWorkspaceRequest)
    app.use('/api/replay', requireAuth, requireFeature('replay'), replayRouter)
    const user = async (suffix: string) => (await admin.user.create({ data: { email: `${tag}-${suffix}@example.invalid`, emailVerified: true } })).id
    learner = await user('learner'); other = await user('other')
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY' } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
      await admin.workspaceFeature.create({ data: { workspaceId: ws.id, feature: 'replay', entitled: true, enabled: true } })
    }
    const join = async (workspaceId: string, userId: string) => {
      members[`${workspaceId}:${userId}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() } })).id
    }
    await join(alpha, learner); await join(alpha, other); await join(beta, learner)
  }, 30000)

  afterAll(async () => {
    if (readiness) readiness.replay = false
    const ids = [learner, other].filter(Boolean)
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    await admin.$disconnect()
    if (uploads) await rm(uploads, { recursive: true, force: true })
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled, REPLAY_UPLOAD_PATH: env.uploads })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  it('requires the organization entitlement, not a Personal grant', async () => {
    await admin.workspaceFeature.update({ where: { workspaceId_feature: { workspaceId: beta, feature: 'replay' } }, data: { enabled: false } })
    expect((await create(beta, learner)).status).toBe(403)
    await admin.workspaceFeature.update({ where: { workspaceId_feature: { workspaceId: beta, feature: 'replay' } }, data: { enabled: true } })
    readiness.replay = false
    expect((await create(alpha, learner)).status).toBe(403)
    readiness.replay = true
  })

  it('keeps organization replays, files and results inside their workspace', async () => {
    const created = await create(alpha, learner)
    expect(created.status).toBe(200)
    const id = created.body.sessionId
    const row = await admin.replaySession.findUniqueOrThrow({ where: { id } })
    expect(row.workspaceId).toBe(alpha)
    const prefix = path.join(uploads, 'workspaces', alpha, 'replay', id) + path.sep
    const pasted = await request(app).post(`/api/replay/sessions/${id}/upload`).set(as(alpha, learner)).field('text', 'Me: Status is green.')
    expect(pasted.status).toBe(200)
    const transcript = await request(app).post(`/api/replay/sessions/${id}/upload`).set(as(alpha, learner))
      .attach('transcript', Buffer.from('Me: We ship Friday.'), { filename: 'notes.txt', contentType: 'text/plain' })
    expect(transcript.status).toBe(200)
    const files = await admin.replayUpload.findMany({ where: { replaySessionId: id } })
    expect(files.length).toBeGreaterThanOrEqual(2)
    for (const file of files) expect(file.storedPath.startsWith(prefix)).toBe(true)

    const list = async (ws: string | null, userId: string) => (await request(app).get('/api/replay/sessions').set(as(ws, userId))).body
    const ids = (body: unknown) => JSON.stringify(body).includes(id)
    expect(ids(await list(alpha, learner))).toBe(true)
    expect(ids(await list(null, learner))).toBe(false)
    expect(ids(await list(beta, learner))).toBe(false)
    expect(ids(await list(alpha, other))).toBe(false)
    for (const [ws, user] of [[null, learner], [beta, learner], [alpha, other]] as const) {
      expect((await request(app).get(`/api/replay/sessions/${id}/results`).set(as(ws, user))).status).toBe(404)
      expect((await request(app).get(`/api/replay/sessions/${id}/download/${files[0].id}`).set(as(ws, user))).status).toBeGreaterThanOrEqual(403)
    }
    expect((await request(app).get(`/api/replay/sessions/${id}/download/${files[0].id}`).set(as(alpha, learner))).status).toBe(200)
  })

  it('processes an organization transcript in the background inside the same workspace', async () => {
    const id = (await create(alpha, learner)).body.sessionId
    await request(app).post(`/api/replay/sessions/${id}/upload`).set(as(alpha, learner))
      .field('text', 'Me: Thanks for joining. Our goal today is to agree on the release date.\nAlex: Friday works.\nMe: Great, I will confirm the scope by Thursday.')
    expect((await request(app).post(`/api/replay/sessions/${id}/process`).set(as(alpha, learner))).status).toBeLessThan(300)
    let status = ''
    for (let i = 0; i < 60 && !['completed', 'failed'].includes(status); i++) {
      await new Promise(resolve => setTimeout(resolve, 250))
      status = (await admin.replaySession.findUniqueOrThrow({ where: { id } })).status
    }
    expect(status).toBe('completed')
    expect(await admin.replayResult.findUnique({ where: { replaySessionId: id } })).not.toBeNull()
    expect((await request(app).get(`/api/replay/sessions/${id}/results`).set(as(alpha, learner))).status).toBe(200)
    expect((await request(app).get(`/api/replay/sessions/${id}/results`).set(as(null, learner))).status).toBe(404)
    const usage = await admin.featureUsage.findMany({ where: { userId: learner, sessionId: id } })
    expect(usage.length).toBeGreaterThan(0)
    expect(usage.every(row => row.workspaceId === alpha)).toBe(true)
  }, 30000)

  it('never serves an organization upload whose stored path left the workspace prefix', async () => {
    const id = (await create(alpha, learner)).body.sessionId
    const outside = path.join(uploads, `${tag}-personal.txt`); await writeFile(outside, 'Personal notes')
    const file = await admin.replayUpload.create({ data: { replaySessionId: id, fileType: 'transcript', originalName: 'x.txt', storedPath: outside, fileSize: 14, mimeType: 'text/plain' } })
    expect((await request(app).get(`/api/replay/sessions/${id}/download/${file.id}`).set(as(alpha, learner))).status).toBe(404)
  })

  it('uses the organization plan for audio upload instead of Personal switches', async () => {
    await admin.user.update({ where: { id: learner }, data: { enableReplayAudioUpload: true, enablePro: true } })
    const id = (await create(alpha, learner)).body.sessionId
    const denied = await request(app).post(`/api/replay/sessions/${id}/upload`).set(as(alpha, learner))
      .attach('audio', Buffer.from('RIFF'), { filename: 'call.wav', contentType: 'audio/wav' })
    expect(denied.status).toBe(403)
    expect(denied.body.code).toBe('REPLAY_AUDIO_UPLOAD_DISABLED')
  })

  it('keeps the workspace when a browser streams the multipart body in several network chunks', async () => {
    const id = (await create(alpha, learner)).body.sessionId
    const server = app.listen(0)
    try {
      const port = (server.address() as { port: number }).port
      const boundary = `b${tag}`
      const head = `--${boundary}\r\nContent-Disposition: form-data; name="transcript"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n`
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = http.request({ port, path: `/api/replay/sessions/${id}/upload`, method: 'POST',
          headers: { ...as(alpha, learner), 'content-type': `multipart/form-data; boundary=${boundary}` } }, res => {
          let body = ''; res.on('data', chunk => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
        })
        req.on('error', reject)
        req.write(head)
        setTimeout(() => { req.write(`Me: ${'We ship Friday. '.repeat(4000)}`); setTimeout(() => req.end(`\r\n--${boundary}--\r\n`), 30) }, 30)
      })
      expect(response.status).toBe(200)
      const [file] = await admin.replayUpload.findMany({ where: { replaySessionId: id } })
      expect(file.storedPath.startsWith(path.join(uploads, 'workspaces', alpha, 'replay', id) + path.sep)).toBe(true)
    } finally { server.close() }
  })

  it('deletes an organization replay with a workspace-tagged outbox and removes its files', async () => {
    const id = (await create(alpha, learner)).body.sessionId
    await request(app).post(`/api/replay/sessions/${id}/upload`).set(as(alpha, learner)).field('text', 'Me: Done.')
    const [file] = await admin.replayUpload.findMany({ where: { replaySessionId: id } })
    expect(existsSync(file.storedPath)).toBe(true)
    expect((await request(app).delete(`/api/replay/sessions/${id}`).set(as(beta, learner))).status).toBe(404)
    expect((await request(app).delete(`/api/replay/sessions/${id}`).set(as(alpha, learner))).status).toBe(200)
    expect(await admin.replaySession.count({ where: { id } })).toBe(0)
    expect(existsSync(file.storedPath)).toBe(false)
  })
})
