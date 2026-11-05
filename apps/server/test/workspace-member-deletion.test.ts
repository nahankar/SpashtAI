import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config = vi.hoisted(() => {
  const url = process.env.EMAIL_CODE_TEST_DATABASE_URL
  if (url && url !== 'postgresql://postgres@127.0.0.1:55445/postgres') throw new Error('Use isolated deletion database')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') }) }
})
import { prisma } from '../src/lib/prisma'
import { signWorkspaceToken } from '../src/lib/jwt'
import { workspaceRouter } from '../src/workspaces/routes'
import { withWorkspaceAccess } from '../src/workspaces/context'
import { transcriptionInputUri } from '../src/lib/aws-transcribe'
const admin = new PrismaClient({ datasourceUrl: config.url })
const tag = `delete_${randomUUID().replaceAll('-', '')}`
let seq = 0
const app = express(); app.use(express.json()); app.use('/api/workspaces', workspaceRouter)
app.use((err: { status?: number; code?: string; message: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => res.status(err.status || 500).json({ code: err.code, message: err.message }))
async function fixture() {
  const suffix = `${tag}_${seq++}`
  const makeUser = (name: string) => admin.user.create({ data: { email: `${suffix}_${name}@example.invalid`, emailVerified: true } })
  const [owner, manager, learner, other] = await Promise.all(['owner', 'manager', 'learner', 'other'].map(makeUser))
  const workspace = await admin.workspace.create({ data: { name: 'Deletion test', kind: 'ORGANIZATION', slug: `${suffix}-org` } })
  const beta = await admin.workspace.create({ data: { name: 'Other tenant', kind: 'ORGANIZATION', slug: `${suffix}-beta` } })
  const member = (userId: string, role: 'OWNER' | 'ADMIN' | 'LEARNER', workspaceId = workspace.id) => admin.workspaceMember.create({ data: { workspaceId, userId, role, state: 'ACTIVE', acceptedAt: new Date() } })
  const [o, m, l, x, b] = await Promise.all([member(owner.id, 'OWNER'), member(manager.id, 'ADMIN'), member(learner.id, 'LEARNER'), member(other.id, 'LEARNER'), member(learner.id, 'LEARNER', beta.id)])
  const token = (userId: string, membershipId: string, workspaceId = workspace.id) => signWorkspaceToken({ userId, membershipId, workspaceId })
  return { owner, manager, learner, other, workspace, beta, o, m, l, x, b,
    ownerToken: token(owner.id, o.id), managerToken: token(manager.id, m.id), learnerToken: token(learner.id, l.id), betaToken: token(learner.id, b.id, beta.id) }
}
const remove = (token: string, id: string, history = 'retain') => request(app).delete(`/api/workspaces/current/members/${id}`).set('Authorization', `Bearer ${token}`).send({ history })
describe.skipIf(!config.url)('tenant membership deletion (restricted PostgreSQL role)', () => {
  beforeAll(async () => { process.env.WORKSPACES_ENABLED = 'true'; await prepareWorkspaceTestRole(admin) })
  afterAll(async () => {
    const workspaces = await admin.workspace.findMany({ where: { slug: { startsWith: tag } }, select: { id: true } })
    await admin.replayDeletion.deleteMany({ where: { workspaceId: { in: workspaces.map(w => w.id) } } })
    await admin.workspace.deleteMany({ where: { slug: { startsWith: tag } } })
    await admin.user.deleteMany({ where: { email: { startsWith: tag } } })
    await prisma.$disconnect(); await admin.$disconnect()
  })
  it('removes membership, invalidates the old token, revokes pending invites and retains tenant history', async () => {
    const f = await fixture()
    const session = await admin.session.create({ data: { userId: f.learner.id, workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', module: 'elevate' } })
    const invitation = await admin.userInvitation.create({ data: { email: f.learner.email, workspaceId: f.workspace.id, proposedRole: 'LEARNER', invitedById: f.owner.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60000) } })
    const result = await remove(f.managerToken, f.l.id)
    expect(result.status).toBe(200); expect(result.body.history).toBe('retain')
    expect(await admin.workspaceMember.findUnique({ where: { id: f.l.id } })).toBeNull()
    expect(await admin.session.findUnique({ where: { id: session.id } })).toEqual(session)
    expect(await admin.userInvitation.findUnique({ where: { id: invitation.id } })).toMatchObject({ status: 'REVOKED' })
    expect((await request(app).get('/api/workspaces/current').set('Authorization', `Bearer ${f.learnerToken}`)).status).toBe(403)
    expect((await request(app).get('/api/workspaces/current').set('Authorization', `Bearer ${f.betaToken}`)).status).toBe(200)
    expect((await admin.user.findUniqueOrThrow({ where: { id: f.learner.id } })).tenantOnly).toBe(true)
    const reenrolled = await admin.workspaceMember.create({ data: { workspaceId: f.workspace.id, userId: f.learner.id, role: 'LEARNER', state: 'ACTIVE', acceptedAt: new Date() } })
    expect(reenrolled.id).not.toBe(f.l.id)
    expect((await request(app).get('/api/workspaces/current').set('Authorization', `Bearer ${f.learnerToken}`)).status).toBe(403)
  })
  it('erases only target tenant history, including suspended members, and commits durable media cleanup', async () => {
    const f = await fixture()
    const personal = await admin.session.create({ data: { userId: f.learner.id, module: 'elevate', endedAt: new Date() } })
    const createSession = (workspaceId: string, userId = f.learner.id) => admin.session.create({ data: { workspaceId, userId, workspaceKind: 'ORGANIZATION', module: 'elevate', endedAt: new Date() } })
    const [session, betaSession, peerSession] = await Promise.all([createSession(f.workspace.id), createSession(f.beta.id), createSession(f.workspace.id, f.other.id)])
    await admin.sessionTranscript.create({ data: { sessionId: session.id, conversationData: { messages: ['private'] } } })
    const replay = await admin.replaySession.create({ data: { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', userId: f.learner.id, meetingType: 'meeting', userRole: 'speaker', focusAreas: [], uploadedFiles: { create: { fileType: 'audio', originalName: 'answer.wav', storedPath: `/tmp/workspaces/${f.workspace.id}/answer.wav`, fileSize: 2, mimeType: 'audio/wav' } } } })
    const feedback = await admin.userFeedback.create({ data: { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', userId: f.learner.id, feedbackNumber: randomUUID(), body: 'private', attachments: { create: { fileName: 'image.png', mimeType: 'image/png', storedPath: `/tmp/workspaces/${f.workspace.id}/image.png` } } } })
    await admin.progressPulse.create({ data: { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', userId: f.learner.id, source: 'elevate', sessionId: session.id, skill: 'clarity', score: 7 } })
    const owned = { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION' as const, userId: f.learner.id }
    const preparation = await admin.preparation.create({ data: { ...owned, type: 'INTERVIEW', title: 'Tenant journey' } })
    const coach = await admin.coachThread.create({ data: { ...owned, preparationId: preparation.id } })
    await admin.coachHomeResultReceipt.create({ data: { ...owned, module: 'elevate', targetId: session.id } })
    await admin.featureUsage.create({ data: { ...owned, feature: 'elevate', action: 'practice' } })
    await admin.workspaceMember.update({ where: { id: f.l.id }, data: { state: 'SUSPENDED' } })
    const result = await remove(f.ownerToken, f.l.id, 'delete')
    expect(result.status, result.text).toBe(200)
    expect(await admin.session.findUnique({ where: { id: session.id } })).toMatchObject({ discardedAt: expect.any(Date), deletionStatus: 'pending' })
    expect(await admin.replaySession.findUnique({ where: { id: replay.id } })).toBeNull()
    expect(await admin.userFeedback.findUnique({ where: { id: feedback.id } })).toBeNull()
    expect(await admin.progressPulse.count({ where: { workspaceId: f.workspace.id, userId: f.learner.id } })).toBe(0)
    expect(await admin.preparation.findUnique({ where: { id: preparation.id } })).toBeNull()
    expect(await admin.coachThread.findUnique({ where: { id: coach.id } })).toBeNull()
    expect(await admin.coachHomeResultReceipt.count({ where: owned })).toBe(0)
    expect(await admin.featureUsage.count({ where: owned })).toBe(0)
    const outbox = await admin.replayDeletion.findUniqueOrThrow({ where: { replaySessionId: replay.id } })
    expect(outbox.workspaceId).toBe(f.workspace.id); expect(outbox.filePaths).toContain(`/tmp/workspaces/${f.workspace.id}/answer.wav`)
    expect(JSON.stringify(outbox.filePaths)).toContain(`workspaces/${f.workspace.id}/replay/${replay.id}`)
    expect(await admin.replayDeletion.findUnique({ where: { replaySessionId: `feedback-${feedback.id}` } })).not.toBeNull()
    for (const retained of [personal, betaSession, peerSession]) expect(await admin.session.findUnique({ where: { id: retained.id } })).toEqual(retained)
    expect(await admin.workspaceAudit.findFirst({ where: { subjectId: f.l.id, action: 'membership_deleted' } })).toMatchObject({ metadata: expect.objectContaining({ history: 'delete' }) })
  })
  it('enforces admin/owner hierarchy, last Owner, self deletion and tenant boundaries', async () => {
    const f = await fixture()
    expect((await remove(f.learnerToken, f.x.id)).status).toBe(403)
    expect((await remove(f.managerToken, f.o.id)).status).toBe(403)
    expect((await remove(f.managerToken, f.m.id)).status).toBe(403)
    expect((await remove(f.ownerToken, f.o.id)).body.code).toBe('LAST_OWNER')
    expect((await remove(f.ownerToken, f.b.id)).status).toBe(404)
    expect((await remove(f.ownerToken, f.l.id, 'invalid')).status).not.toBe(200)
    expect((await remove(f.ownerToken, f.m.id)).status).toBe(200)
  })
  it('rolls back history, membership and media jobs when the audit cannot be persisted', async () => {
    const f = await fixture()
    const replay = await admin.replaySession.create({ data: { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', userId: f.learner.id, meetingType: 'meeting', userRole: 'speaker', focusAreas: [] } })
    const { deleteWorkspaceMember } = await import('../src/workspaces/service')
    await expect(withWorkspaceAccess({ tokenUse: 'workspace', workspaceId: f.workspace.id, userId: f.owner.id, membershipId: f.o.id }, async (tx, scope) => {
      await deleteWorkspaceMember(tx, scope, f.l.id, { history: 'delete' })
      throw new Error('forced rollback')
    }, { lockWorkspace: true })).rejects.toThrow('forced rollback')
    expect(await admin.workspaceMember.findUnique({ where: { id: f.l.id } })).not.toBeNull()
    expect(await admin.replaySession.findUnique({ where: { id: replay.id } })).not.toBeNull()
    expect(await admin.replayDeletion.findUnique({ where: { replaySessionId: replay.id } })).toBeNull()
  })
  it('does not grant cross-tenant access when an erasure context selects a member from another tenant', async () => {
    const f = await fixture()
    const session = await admin.session.create({ data: { workspaceId: f.beta.id, workspaceKind: 'ORGANIZATION', userId: f.learner.id, module: 'elevate' } })
    await withWorkspaceAccess({ tokenUse: 'workspace', workspaceId: f.workspace.id, userId: f.owner.id, membershipId: f.o.id }, async tx => {
      await tx.$queryRaw`SELECT set_config('app.workspace_reader','member_erasure',true), set_config('app.workspace_erasure_member',${f.b.id},true)`
      expect(await tx.session.findUnique({ where: { id: session.id } })).toBeNull()
      expect((await tx.session.updateMany({ where: { id: session.id }, data: { discardedAt: new Date() } })).count).toBe(0)
    })
  })
  it('serializes concurrent deletions without duplicate audits or leaking permissions', async () => {
    const f = await fixture()
    const results = await Promise.all([remove(f.ownerToken, f.l.id), remove(f.managerToken, f.l.id)])
    expect(results.map(r => r.status).sort()).toEqual([200, 404])
    expect(await admin.workspaceAudit.count({ where: { subjectId: f.l.id, action: 'membership_deleted' } })).toBe(1)
    const peer = await admin.session.create({ data: { workspaceId: f.workspace.id, workspaceKind: 'ORGANIZATION', userId: f.other.id, module: 'elevate' } })
    await withWorkspaceAccess({ tokenUse: 'workspace', workspaceId: f.workspace.id, userId: f.owner.id, membershipId: f.o.id }, async tx => {
      expect(await tx.session.findUnique({ where: { id: peer.id } })).toBeNull()
    })
  })
  it('builds a finite S3 transcription artifact URI for durable cleanup', () => {
    expect(transcriptionInputUri('workspaces/test/replay/id/input.wav')).toMatch(/^s3:\/\/[^/]+\/workspaces\/test\/replay\/id\/input.wav$/)
  })
})
