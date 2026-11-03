import { prepareWorkspaceTestRole } from './workspace-test-role'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
import type { DataScope } from '../src/lib/dataScope'

const url = process.env.WORKSPACE_TEST_DATABASE_URL
if (url && url !== 'postgresql://postgres@127.0.0.1:55443/postgres') throw new Error('Use only the isolated tenancy container')
const suite = url ? describe : describe.skip
const RESTRICTED = 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'

suite('workspace isolation under pooling, concurrency and failure', () => {
  const admin = new PrismaClient({ datasourceUrl: url || 'postgresql://unused:5432/unused' })
  const env = { database: process.env.DATABASE_URL, enabled: process.env.WORKSPACES_ENABLED }
  const tag = 'st-' + randomUUID().replaceAll('-', '').slice(0, 10)
  let db: PrismaClient
  let single: PrismaClient
  let singleBase: PrismaClient
  let scopes: typeof import('../src/lib/dataScope')
  let access: typeof import('../src/workspaces/requestScope')
  let jobs: typeof import('../src/workspaces/jobScopes')
  let alpha = '', beta = '', owner = '', learner = '', suspended = ''
  const members: Record<string, string> = {}
  const scope = (workspaceId: string, actorId: string, reader?: 'manager'): DataScope => ({
    actorId, workspaceId, membershipId: members[`${workspaceId}:${actorId}`] ?? 'none', role: 'LEARNER', slug: '', timeZone: 'UTC',
    features: {}, reader, origin: 'request',
  })
  const as = <T>(s: DataScope | null, work: () => Promise<T>) => s ? scopes.runWithDataScope(s, work) : work()
  const replayData = (userId: string, sessionName: string) => ({ userId, sessionName, meetingType: 'standup', userRole: 'participant', focusAreas: [] })
  const seeded: Record<'personal' | 'alpha' | 'beta', string[]> = { personal: [], alpha: [], beta: [] }

  beforeAll(async () => {
    await prepareWorkspaceTestRole(admin)
    // A small pool forces concurrent requests from different contexts onto shared connections.
    process.env.DATABASE_URL = `${RESTRICTED}?connection_limit=3&pool_timeout=30`
    process.env.WORKSPACES_ENABLED = 'true'
    db = (await import('../src/lib/prisma')).prisma
    const { createScopedPrisma } = await import('../src/lib/scopedPrisma')
    singleBase = new PrismaClient({ datasourceUrl: `${RESTRICTED}?connection_limit=1` })
    single = createScopedPrisma(singleBase)
    scopes = await import('../src/lib/dataScope')
    access = await import('../src/workspaces/requestScope')
    jobs = await import('../src/workspaces/jobScopes')
    const user = async (suffix: string) => (await admin.user.create({ data: { email: `${tag}-${suffix}@example.invalid`, emailVerified: true } })).id
    owner = await user('owner'); learner = await user('learner'); suspended = await user('suspended')
    for (const name of ['alpha', 'beta'] as const) {
      const ws = await admin.workspace.create({ data: { kind: 'ORGANIZATION', name, slug: `${tag}-${name}`, isolationStage: 'FOUNDATION_ONLY' } })
      if (name === 'alpha') alpha = ws.id; else beta = ws.id
    }
    const join = async (workspaceId: string, userId: string, role: 'OWNER' | 'LEARNER') => {
      members[`${workspaceId}:${userId}`] = (await admin.workspaceMember.create({ data: { workspaceId, userId, role, state: 'ACTIVE', acceptedAt: new Date() } })).id
    }
    await join(alpha, owner, 'OWNER'); await join(alpha, learner, 'LEARNER'); await join(alpha, suspended, 'LEARNER')
    await join(beta, owner, 'OWNER'); await join(beta, learner, 'LEARNER')
    // The same learner owns activity in all three contexts.
    for (const [key, s] of [['personal', null], ['alpha', scope(alpha, learner)], ['beta', scope(beta, learner)]] as const) {
      for (let i = 0; i < 3; i += 1) {
        const row = await as(s, () => db.replaySession.create({ data: replayData(learner, `${tag}-${key}-${i}`) }))
        seeded[key].push(row.id)
      }
    }
  }, 60000)

  afterAll(async () => {
    vi.useRealTimers()
    const ids = [owner, learner, suspended].filter(Boolean)
    await admin.workspace.deleteMany({ where: { OR: [{ id: { in: [alpha, beta].filter(Boolean) } }, { personalOwnerId: { in: ids } }] } })
    await admin.user.deleteMany({ where: { id: { in: ids } } })
    await db?.$disconnect(); await singleBase?.$disconnect(); await admin.$disconnect()
    for (const [key, value] of Object.entries({ DATABASE_URL: env.database, WORKSPACES_ENABLED: env.enabled })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value
    }
  })

  const ownIds = (rows: Array<{ id: string; sessionName?: string | null }>) =>
    rows.filter(r => r.sessionName?.startsWith(tag)).map(r => r.id).sort()

  it('never lets a pooled connection carry a workspace into the next request', async () => {
    type Probe = Array<{ ws: string | null; actor: string | null; pid: number }>
    const probe = (client: PrismaClient) => client.$queryRaw<Probe>`SELECT current_setting('app.workspace_id', true) AS ws,
      current_setting('app.workspace_actor_id', true) AS actor, pg_backend_pid() AS pid`
    const [inAlpha] = await as(scope(alpha, learner), () => probe(single))
    expect(inAlpha.ws).toBe(alpha)
    const [after] = await probe(single)
    expect(after.pid).toBe(inAlpha.pid)
    expect(after.ws || '').toBe('')
    expect(after.actor || '').toBe('')
    // A rolled-back interactive transaction and a failed batch also leave nothing behind.
    await expect(as(scope(alpha, learner), () => single.$transaction(async tx => {
      await tx.replaySession.findMany()
      throw new Error('abort')
    }))).rejects.toThrow('abort')
    expect(((await probe(single))[0].ws) || '').toBe('')
    await expect(as(scope(alpha, learner), () => single.$transaction([
      single.replaySession.count(),
      single.replaySession.create({ data: { ...replayData(learner, 'x'), workspaceId: beta } }),
    ]))).rejects.toThrow()
    const [last] = await probe(single)
    expect(last.pid).toBe(inAlpha.pid)
    expect(last.ws || '').toBe('')
    expect(ownIds(await single.replaySession.findMany({ where: { userId: learner } }))).toEqual([...seeded.personal].sort())
  })

  it('keeps concurrent requests for one person in Personal and two organizations apart', async () => {
    const contexts = { personal: null, alpha: scope(alpha, learner), beta: scope(beta, learner) } as const
    const kinds = ['findMany', 'raw', 'interactive', 'batch', 'unique'] as const
    const tasks = Array.from({ length: 90 }, (_, i) => {
      const key = (['personal', 'alpha', 'beta'] as const)[i % 3]
      const kind = kinds[Math.floor(i / 3) % kinds.length]
      const s = contexts[key]
      return as(s, async () => {
        if (kind === 'findMany') return { key, ids: ownIds(await db.replaySession.findMany({ where: { userId: learner } })) }
        if (kind === 'raw') {
          const rows = await db.$queryRaw<Array<{ id: string; sessionName: string }>>`SELECT id, "sessionName" FROM "ReplaySession" WHERE "userId"=${learner}`
          return { key, ids: ownIds(rows) }
        }
        if (kind === 'interactive') {
          return { key, ids: await db.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_sleep(0.02)`
            return ownIds(await tx.replaySession.findMany({ where: { userId: learner } }))
          }) }
        }
        if (kind === 'batch') {
          const [rows] = await db.$transaction([db.replaySession.findMany({ where: { userId: learner } }), db.session.count()])
          return { key, ids: ownIds(rows) }
        }
        // Each context probes every seeded ID and must find only its own.
        const all = [...seeded.personal, ...seeded.alpha, ...seeded.beta]
        const found = await Promise.all(all.map(id => db.replaySession.findUnique({ where: { id } })))
        return { key, ids: found.filter(Boolean).map(r => r!.id).sort() }
      })
    })
    const results = await Promise.all(tasks)
    for (const { key, ids } of results) expect(ids).toEqual([...seeded[key]].sort())
    // Concurrent creates land in the context that issued them.
    const created = await Promise.all((['personal', 'alpha', 'beta'] as const).flatMap(key => [0, 1, 2].map(() =>
      as(contexts[key], () => db.replaySession.create({ data: replayData(learner, `${tag}-c-${key}`) })).then(row => ({ key, row })))))
    for (const { key, row } of created) {
      const s = contexts[key]
      expect([row.workspaceKind, s ? row.workspaceId : 'personal']).toEqual([s ? 'ORGANIZATION' : 'PERSONAL', s ? s.workspaceId : 'personal'])
    }
  }, 60000)

  it('applies the boundary to nested, bulk and upsert writes', async () => {
    const a = scope(alpha, learner), b = scope(beta, learner)
    const nested = await as(a, () => db.replaySession.create({ data: { ...replayData(learner, `${tag}-nested`),
      uploadedFiles: { create: [{ fileType: 'text', originalName: 'n.txt', storedPath: '/nowhere/n.txt', fileSize: 1, mimeType: 'text/plain' }] },
      result: { create: { transcriptText: 'nested private words', transcriptionSource: 'pasted' } } },
      include: { uploadedFiles: true, result: true } }))
    expect(nested.workspaceId).toBe(alpha)
    expect(nested.uploadedFiles).toHaveLength(1)
    expect(await as(b, () => db.replayUpload.count({ where: { replaySessionId: nested.id } }))).toBe(0)
    expect(await db.replayResult.count({ where: { replaySessionId: nested.id } })).toBe(0)
    expect(await as(scope(alpha, owner, 'manager'), () => db.replayResult.count({ where: { replaySessionId: nested.id } }))).toBe(0)
    // A nested write through a foreign parent cannot attach children.
    await expect(as(b, () => db.replaySession.update({ where: { id: nested.id }, data: {
      uploadedFiles: { create: [{ fileType: 'text', originalName: 'x', storedPath: '/x', fileSize: 1, mimeType: 'text/plain' }] } } }))).rejects.toThrow()
    await expect(as(b, () => db.replayUpload.create({ data: { replaySessionId: nested.id, fileType: 'text', originalName: 'x', storedPath: '/x', fileSize: 1, mimeType: 'text/plain' } }))).rejects.toThrow()
    // Bulk writes take the verified workspace; a forged workspace is refused.
    await as(a, () => db.replaySession.createMany({ data: [replayData(learner, `${tag}-bulk-1`), replayData(learner, `${tag}-bulk-2`)] }))
    const bulk = await admin.replaySession.findMany({ where: { sessionName: { startsWith: `${tag}-bulk` } } })
    expect(bulk.map(r => r.workspaceId)).toEqual([alpha, alpha])
    await expect(as(a, () => db.replaySession.createMany({ data: [{ ...replayData(learner, `${tag}-forged`), workspaceId: beta }] }))).rejects.toThrow()
    // An upsert from another organization cannot overwrite a row it cannot see.
    await expect(as(b, () => db.replaySession.upsert({ where: { id: nested.id }, update: { sessionName: 'hijack' },
      create: { ...replayData(learner, 'hijack'), id: nested.id } }))).rejects.toThrow()
    expect((await admin.replaySession.findUniqueOrThrow({ where: { id: nested.id } })).sessionName).toBe(`${tag}-nested`)
    expect((await as(b, () => db.replaySession.updateMany({ where: { id: { in: seeded.alpha } }, data: { sessionName: 'hijack' } }))).count).toBe(0)
    expect((await db.replaySession.deleteMany({ where: { id: { in: seeded.beta } } })).count).toBe(0)
  })

  it('fails closed for missing, invalid and expired credentials and never serves Personal instead', async () => {
    const app = express()
    app.use(access.bindWorkspaceRequest)
    app.get('/probe', async (_req, res) => res.json({ scope: scopes.currentDataScope()?.workspaceId ?? null }))
    const identity = signToken({ userId: learner, email: 'x@example.invalid', role: 'USER' })
    const ws = signWorkspaceToken({ userId: learner, workspaceId: alpha, membershipId: members[`${alpha}:${learner}`] })
    const call = (headers: Record<string, string>) => request(app).get('/probe').set(headers)
    expect((await call({ Authorization: `Bearer ${identity}`, 'x-spasht-workspace': ws })).body.scope).toBe(alpha)
    const cases: Array<[Record<string, string>, number, string]> = [
      [{ 'x-spasht-workspace': ws }, 401, 'IDENTITY_REQUIRED'],
      [{ Authorization: 'Bearer not-a-jwt', 'x-spasht-workspace': ws }, 401, 'IDENTITY_REQUIRED'],
      [{ Authorization: `Bearer ${identity}`, 'x-spasht-workspace': ws.slice(0, -4) + 'AAAA' }, 401, 'WORKSPACE_TOKEN_REQUIRED'],
      // An identity token is not a workspace token.
      [{ Authorization: `Bearer ${identity}`, 'x-spasht-workspace': identity }, 401, 'WORKSPACE_TOKEN_REQUIRED'],
    ]
    for (const [headers, status, code] of cases) {
      const res = await call(headers)
      expect([res.status, res.body.code]).toEqual([status, code])
      expect(res.body.scope).toBeUndefined()
    }
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 16 * 60_000)
    const expired = await call({ Authorization: `Bearer ${identity}`, 'x-spasht-workspace': ws })
    expect([expired.status, expired.body.code]).toEqual([401, 'WORKSPACE_TOKEN_REQUIRED'])
    vi.useRealTimers()
    process.env.WORKSPACES_ENABLED = 'false'
    try {
      const disabled = await call({ Authorization: `Bearer ${identity}`, 'x-spasht-workspace': ws })
      expect([disabled.status, disabled.body.code]).toEqual([404, 'WORKSPACES_DISABLED'])
    } finally { process.env.WORKSPACES_ENABLED = 'true' }
  })

  it('exposes only routing pairs to the unscoped sweep and verifies scope before workers read', async () => {
    const stale = new Date(Date.now() - 30 * 3600_000)
    const mk = (s: DataScope) => as(s, () => db.session.create({ data: { userId: s.actorId, module: 'elevate', sessionName: `${tag}-idle`, startedAt: stale } }))
    const inAlpha = await mk(scope(alpha, learner)), inBeta = await mk(scope(beta, learner)), bySuspended = await mk(scope(alpha, suspended))
    await admin.workspaceMember.update({ where: { id: members[`${alpha}:${suspended}`] }, data: { state: 'SUSPENDED' } })
    const due = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM public.workspace_job_scopes('session_inactivity')`
    for (const row of due) expect(Object.keys(row).sort()).toEqual(['userId', 'workspaceId'])
    expect(due).toContainEqual({ workspaceId: alpha, userId: learner })
    expect(due).toContainEqual({ workspaceId: beta, userId: learner })
    expect(due).not.toContainEqual({ workspaceId: alpha, userId: suspended })
    // Inside any organization context discovery returns nothing.
    expect(await as(scope(alpha, owner), () => db.$queryRaw<unknown[]>`SELECT * FROM public.workspace_job_scopes('session_inactivity')`)).toEqual([])
    expect(await access.withJobScope(alpha, learner, () => db.$queryRaw<unknown[]>`SELECT * FROM public.workspace_job_scopes('session_inactivity')`)).toEqual([])

    const runs: Array<{ workspace: string | null; ids: string[] }> = []
    await jobs.sweepAllScopes('session_inactivity', async () => {
      const rows = await db.session.findMany({ where: { sessionName: `${tag}-idle` }, select: { id: true } })
      runs.push({ workspace: scopes.currentDataScope()?.workspaceId ?? null, ids: rows.map(r => r.id).sort() })
    })
    expect(runs.find(r => r.workspace === null)?.ids).toEqual([])
    expect(runs.filter(r => r.workspace === alpha).map(r => r.ids)).toEqual([[inAlpha.id]])
    expect(runs.filter(r => r.workspace === beta).map(r => r.ids)).toEqual([[inBeta.id]])
    expect(runs.flatMap(r => r.ids)).not.toContain(bySuspended.id)
    // A scope held in memory after suspension (for example by a retry timer) is refused by the database.
    expect(await as(scope(alpha, suspended), () => db.session.findUnique({ where: { id: bySuspended.id } }))).toBeNull()
    await expect(as(scope(alpha, suspended), () => db.session.update({ where: { id: bySuspended.id }, data: { sessionName: 'late' } }))).rejects.toThrow()
  })
})
