import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
import type { DataScope } from '../src/lib/dataScope'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip

suite('workspace product plane isolation', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED }
  const tag = 'pp-' + randomUUID().replaceAll('-', '').slice(0, 10)
  let db: PrismaClient
  let scopes: typeof import('../src/lib/dataScope')
  let access: typeof import('../src/workspaces/requestScope')
  let alpha = '', beta = '', owner = '', learner = '', other = '', suspended = '', outsider = ''
  const members: Record<string, string> = {}
  const scope = (workspaceId: string, actorId: string, reader?: 'manager'): DataScope => ({
    actorId, workspaceId, membershipId: members[`${workspaceId}:${actorId}`] ?? 'none', role: 'LEARNER', slug: '', timeZone: 'Asia/Kolkata',
    features: {}, reader, origin: 'request',
  })
  const asScope = <T>(s: DataScope, work: () => Promise<T>) => scopes.runWithDataScope(s, work)
  const replay = (userId: string) => db.replaySession.create({ data: { userId, meetingType: 'standup', userRole: 'participant', focusAreas: [] } })

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    process.env.DATABASE_URL = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
    process.env.WORKSPACES_ENABLED = 'true'
    db = (await import('../src/lib/prisma')).prisma
    scopes = await import('../src/lib/dataScope')
    access = await import('../src/workspaces/requestScope')
    const user = async (suffix: string) => (await admin.user.create({ data: { email: `${tag}-${suffix}@example.invalid`, emailVerified: true } })).id
    owner = await user('owner'); learner = await user('learner'); other = await user('other'); suspended = await user('suspended'); outsider = await user('outsider')
    for (const name of ['alpha', 'beta']) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY' } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
      await admin.workspaceFeature.createMany({ data: ['elevate', 'replay', 'interviews'].map(feature => ({ workspaceId: ws.id, feature, entitled: true, enabled: true })) })
    }
    const join = async (workspaceId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'LEARNER', state: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
      members[`${workspaceId}:${userId}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId, role, state, acceptedAt: new Date() } })).id
    }
    await join(alpha, owner, 'OWNER'); await join(alpha, learner, 'LEARNER'); await join(alpha, other, 'LEARNER'); await join(alpha, suspended, 'LEARNER', 'SUSPENDED')
    await join(beta, learner, 'LEARNER'); await join(beta, owner, 'OWNER')
  }, 30000)

  afterAll(async () => {
    const ids = [owner, learner, other, suspended, outsider].filter(Boolean)
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    await db?.$disconnect(); await admin.$disconnect()
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  it('assigns new roots to the verified scope and keeps Personal, other learners and other tenants invisible', async () => {
    const personal = await replay(learner)
    const inAlpha = await asScope(scope(alpha, learner), () => replay(learner))
    const inBeta = await asScope(scope(beta, learner), () => replay(learner))
    const others = await asScope(scope(alpha, other), () => replay(other))
    expect(personal.workspaceKind).toBe('PERSONAL')
    expect([inAlpha.workspaceId, inAlpha.workspaceKind]).toEqual([alpha, 'ORGANIZATION'])
    expect(inBeta.workspaceId).toBe(beta)
    const ids = (rows: Array<{ id: string }>) => rows.map(r => r.id).sort()
    expect(ids(await db.replaySession.findMany({ where: { userId: learner } }))).toEqual([personal.id])
    expect(ids(await asScope(scope(alpha, learner), () => db.replaySession.findMany()))).toEqual([inAlpha.id])
    expect(ids(await asScope(scope(beta, learner), () => db.replaySession.findMany()))).toEqual([inBeta.id])
    // Known foreign identifiers, raw SQL and interactive transactions are filtered identically.
    expect(await asScope(scope(beta, learner), () => db.replaySession.findUnique({ where: { id: inAlpha.id } }))).toBeNull()
    expect(await asScope(scope(alpha, learner), () => db.replaySession.findUnique({ where: { id: others.id } }))).toBeNull()
    const raw = await asScope(scope(alpha, learner), () => db.$queryRaw<Array<{ id: string }>>`SELECT id FROM "ReplaySession"`)
    expect(ids(raw)).toEqual([inAlpha.id])
    const viaTx = await asScope(scope(alpha, learner), () => db.$transaction(tx => tx.replaySession.findMany()))
    expect(ids(viaTx)).toEqual([inAlpha.id])
    const batch = await asScope(scope(alpha, learner), () => db.$transaction([db.replaySession.count(), db.session.count()]))
    expect(batch[0]).toBe(1)
    expect((await db.replaySession.updateMany({ where: { id: inAlpha.id }, data: { sessionName: 'tamper' } })).count).toBe(0)
    expect((await asScope(scope(beta, learner), () => db.replaySession.deleteMany({ where: { id: inAlpha.id } }))).count).toBe(0)
  })

  it('rejects forged scope, ownership moves and inactive learners at the database', async () => {
    await expect(asScope(scope(alpha, learner), () => db.replaySession.create({ data: {
      workspaceId: beta, userId: learner, meetingType: 'x', userRole: 'x', focusAreas: [] } }))).rejects.toThrow()
    await expect(asScope(scope(alpha, learner), () => replay(other))).rejects.toThrow()
    await expect(asScope(scope(alpha, suspended), () => replay(suspended))).rejects.toThrow()
    await expect(asScope(scope(alpha, outsider), () => replay(outsider))).rejects.toThrow()
    const row = await asScope(scope(alpha, learner), () => replay(learner))
    await expect(asScope(scope(alpha, learner), () => db.replaySession.update({ where: { id: row.id }, data: { userId: other } }))).rejects.toThrow()
    await expect(admin.replaySession.update({ where: { id: row.id }, data: { workspaceId: beta } })).rejects.toThrow()
  })

  it('refuses cross-workspace parent and sibling links even with known identifiers', async () => {
    const personalReplay = await replay(learner)
    const alphaReplay = await asScope(scope(alpha, learner), () => replay(learner))
    await expect(asScope(scope(alpha, learner), () => db.progressPulse.create({ data: {
      userId: learner, skill: 'clarity', score: 7, source: 'replay', sessionId: personalReplay.id } }))).rejects.toThrow()
    const pulse = await asScope(scope(alpha, learner), () => db.progressPulse.create({ data: {
      userId: learner, skill: 'clarity', score: 7, source: 'replay', sessionId: alphaReplay.id } }))
    expect(pulse.workspaceId).toBe(alpha)
    const personalPrep = await db.preparation.create({ data: { userId: learner, title: 'Personal journey' } })
    await expect(admin.preparationRecording.create({ data: { preparationId: personalPrep.id, replaySessionId: alphaReplay.id } })).rejects.toThrow()
    await expect(admin.replayResult.create({ data: { replaySessionId: alphaReplay.id, transcriptText: 'x', transcriptionSource: 'pasted' } })).resolves.toBeTruthy()
    const result = await admin.replayResult.findUniqueOrThrow({ where: { replaySessionId: alphaReplay.id } })
    await expect(admin.replayResult.update({ where: { id: result.id }, data: { replaySessionId: personalReplay.id } })).rejects.toThrow()
  })

  it('lets Owners/Admins aggregate their own organization without raw learner content', async () => {
    const learnerReplay = await asScope(scope(alpha, other), () => replay(other))
    await admin.replayResult.create({ data: { replaySessionId: learnerReplay.id, transcriptText: 'private words', transcriptionSource: 'pasted' } })
    await asScope(scope(alpha, other), () => db.featureUsage.create({ data: { userId: other, feature: 'replay', action: 'session_create' } }))
    const managerCount = await asScope(scope(alpha, owner, 'manager'), () => db.replaySession.count())
    expect(managerCount).toBeGreaterThanOrEqual(2)
    expect(await asScope(scope(alpha, owner, 'manager'), () => db.featureUsage.count({ where: { userId: other } }))).toBe(1)
    expect(await asScope(scope(alpha, owner, 'manager'), () => db.replayResult.findUnique({ where: { replaySessionId: learnerReplay.id } }))).toBeNull()
    const voice = await asScope(scope(alpha, other), () => db.session.create({ data: { userId: other, module: 'elevate' } }))
    await asScope(scope(alpha, other), () => db.sessionTranscript.create({ data: { sessionId: voice.id, conversationData: [] } }))
    expect(await asScope(scope(alpha, owner, 'manager'), () => db.session.count({ where: { id: voice.id } }))).toBe(1)
    expect(await asScope(scope(alpha, owner, 'manager'), () => db.sessionTranscript.count({ where: { sessionId: voice.id } }))).toBe(0)
    expect(await asScope(scope(alpha, other), () => db.sessionTranscript.count({ where: { sessionId: voice.id } }))).toBe(1)
    // The reader setting is rechecked against the current role: a learner cannot forge it.
    expect(await asScope(scope(alpha, learner, 'manager'), () => db.featureUsage.count({ where: { userId: other } }))).toBe(0)
    // Manager mode never crosses tenants or reaches Personal.
    expect(await asScope(scope(beta, owner, 'manager'), () => db.replaySession.count({ where: { workspaceId: alpha } }))).toBe(0)
    expect(await asScope(scope(alpha, owner, 'manager'), () => db.replaySession.count({ where: { workspaceKind: 'PERSONAL' } }))).toBe(0)
  })

  it('keeps organization acknowledgments separate from Personal acceptance', async () => {
    await db.recordingAcknowledgment.create({ data: { userId: learner, version: 'v-test', scope: [], textHash: 'h', source: 'test' } })
    expect(await asScope(scope(alpha, learner), () => db.recordingAcknowledgment.findFirst({ where: { userId: learner, version: 'v-test' } }))).toBeNull()
    const org = await asScope(scope(alpha, learner), () => db.recordingAcknowledgment.create({ data: { userId: learner, version: 'v-test', scope: [], textHash: 'h', source: 'test' } }))
    expect(org.workspaceId).toBe(alpha)
  })

  it('discovers organization jobs without content and re-establishes verified job scope', async () => {
    const sessionId = `${tag}-job`
    await asScope(scope(alpha, learner), () => db.session.create({ data: { id: sessionId, userId: learner, module: 'elevate', paceReconciliationStatus: 'pending' } }))
    const due = await db.$queryRaw<Array<{ workspaceId: string; userId: string }>>`SELECT * FROM public.workspace_job_scopes('pace_reconciliation')`
    expect(due).toContainEqual({ workspaceId: alpha, userId: learner })
    expect(await db.session.findUnique({ where: { id: sessionId } })).toBeNull()
    const seen = await access.withJobScope(alpha, learner, () => db.session.findUnique({ where: { id: sessionId } }))
    expect(seen?.id).toBe(sessionId)
    expect(await access.withJobScope(alpha, suspended, async () => 'ran')).toBeNull()
    expect(await access.withJobScope(beta, other, async () => 'ran')).toBeNull()
  })

  it('discovers only due jobs in stable pages so later learners are reached while earlier ones retry', async () => {
    await admin.session.updateMany({
      where: { paceReconciliationStatus: { in: ['pending', 'processing', 'retry', 'waiting_for_evidence'] } },
      data: { nextPaceReconciliationAt: new Date(Date.now() + 24 * 60 * 60_000) },
    })
    const later = `${tag}-later`
    const sooner = `${tag}-sooner`
    await asScope(scope(alpha, learner), () => db.session.create({
      data: { id: sooner, userId: learner, module: 'elevate', endedAt: new Date(),
        paceReconciliationStatus: 'retry', nextPaceReconciliationAt: new Date(Date.now() + 60 * 60_000) },
    }))
    await asScope(scope(alpha, other), () => db.session.create({
      data: { id: later, userId: other, module: 'elevate', endedAt: new Date(), paceReconciliationStatus: 'pending' },
    }))
    const ours = (rows: Array<{ workspaceId: string; userId: string }>) =>
      rows.filter(row => row.workspaceId === alpha && (row.userId === learner || row.userId === other))
    const due = ours(await db.$queryRaw<Array<{ workspaceId: string; userId: string }>>`
      SELECT * FROM public.workspace_job_scopes('pace_reconciliation')`)
    expect(due).toEqual([{ workspaceId: alpha, userId: other }])

    await admin.session.update({ where: { id: sooner }, data: { nextPaceReconciliationAt: new Date(Date.now() - 1_000) } })
    const first = await db.$queryRaw<Array<{ workspaceId: string; userId: string }>>`
      SELECT * FROM public.workspace_job_scopes('pace_reconciliation', NULL, NULL, 1)`
    expect(first).toHaveLength(1)
    const next = await db.$queryRaw<Array<{ workspaceId: string; userId: string }>>`
      SELECT * FROM public.workspace_job_scopes('pace_reconciliation', ${first[0].workspaceId}, ${first[0].userId}, 1)`
    expect(next).toHaveLength(1)
    expect(next[0]).not.toEqual(first[0])
    expect(ours([...first, ...next])).toEqual(expect.arrayContaining([
      { workspaceId: alpha, userId: learner },
      { workspaceId: alpha, userId: other },
    ]))
  })

  it('binds product requests only from a current membership matching the identity', async () => {
    const app = express()
    app.use(access.bindWorkspaceRequest)
    app.get('/probe', async (_req, res) => res.json({ scope: scopes.currentDataScope()?.workspaceId ?? null, rows: (await db.replaySession.findMany()).length }))
    app.get('/api/admin/probe', (_req, res) => res.json({ ok: true }))
    const identity = (id: string) => signToken({ userId: id, email: `${id}@example.invalid`, role: 'USER' })
    const ws = (workspaceId: string, userId: string) => signWorkspaceToken({ userId, workspaceId, membershipId: members[`${workspaceId}:${userId}`] })
    const ok = await request(app).get('/probe').set({ Authorization: `Bearer ${identity(learner)}`, 'x-spasht-workspace': ws(alpha, learner) })
    expect(ok.status).toBe(200); expect(ok.body.scope).toBe(alpha)
    expect((await request(app).get('/probe').set({ Authorization: `Bearer ${identity(learner)}` })).body.scope).toBeNull()
    // Another person's identity cannot use a learner's workspace token.
    expect((await request(app).get('/probe').set({ Authorization: `Bearer ${identity(other)}`, 'x-spasht-workspace': ws(alpha, learner) })).status).toBe(403)
    expect((await request(app).get('/probe').set({ Authorization: `Bearer ${identity(learner)}`, 'x-spasht-workspace': 'forged' })).status).toBe(401)
    expect((await request(app).get('/api/admin/probe').set({ Authorization: `Bearer ${identity(learner)}`, 'x-spasht-workspace': ws(alpha, learner) })).status).toBe(403)
    // A token minted before suspension stops working immediately.
    const stale = ws(alpha, other)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${other}`] }, data: { state: 'SUSPENDED' } })
    expect((await request(app).get('/probe').set({ Authorization: `Bearer ${identity(other)}`, 'x-spasht-workspace': stale })).status).toBe(404)
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${other}`] }, data: { state: 'ACTIVE' } })
    // A forged membership id for the right workspace is refused.
    const forged = signWorkspaceToken({ userId: learner, workspaceId: alpha, membershipId: members[`${beta}:${learner}`] })
    expect((await request(app).get('/probe').set({ Authorization: `Bearer ${identity(learner)}`, 'x-spasht-workspace': forged })).status).toBe(403)
  })
})
