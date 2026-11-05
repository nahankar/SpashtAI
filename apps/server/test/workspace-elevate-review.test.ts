import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config = vi.hoisted(() => {
 const url = process.env.EMAIL_CODE_TEST_DATABASE_URL
 if (url && url !== 'postgresql://postgres@127.0.0.1:55445/postgres') throw new Error('Use isolated review database')
 return { url }
})
vi.mock('../src/lib/prisma', async () => {
 const { PrismaClient } = await import('@prisma/client')
 const { createScopedPrisma } = await import('../src/lib/scopedPrisma')
 return { prisma: createScopedPrisma(new PrismaClient({ datasourceUrl: config.url?.replace('postgres@', 'tenancy_test_app@') })) }
})
import { prisma } from '../src/lib/prisma'
import { signToken, signWorkspaceToken } from '../src/lib/jwt'
import { bindWorkspaceRequest } from '../src/workspaces/requestScope'
import { withWorkspaceAccess } from '../src/workspaces/context'
import { runWithDataScope } from '../src/lib/dataScope'
import { requireAuth } from '../src/middleware/auth'
import { guardInterviewSession } from '../src/middleware/interviewSessionAccess'
import { listSessions, getSession, deleteSession } from '../src/routes/sessions'
import { getSessionMetrics, getSessionTranscript } from '../src/routes/metrics'
import { getSessionTurns } from '../src/routes/turns'
import { createSessionRecordingTicket } from '../src/routes/recordings'
const admin = new PrismaClient({ datasourceUrl: config.url })
const tag = `review_${randomUUID().replaceAll('-', '')}`
let seq = 0
let oldFlag: Awaited<ReturnType<typeof admin.platformFeatureFlag.findUnique>>
const app = express(); app.use(express.json(), bindWorkspaceRequest, requireAuth, guardInterviewSession)
app.get('/sessions', listSessions); app.get('/sessions/:id', getSession); app.delete('/sessions/:id', deleteSession)
app.get('/sessions/:sessionId/metrics', getSessionMetrics); app.get('/sessions/:sessionId/transcript', getSessionTranscript)
app.get('/sessions/:sessionId/turns', getSessionTurns); app.post('/sessions/:sessionId/recording/ticket', createSessionRecordingTicket)
async function fixture() {
  const suffix = `${tag}_${seq++}`
  const makeUser = (name: string) => admin.user.create({ data: { email: `${suffix}_${name}@example.invalid`, emailVerified: true } })
  const [owner, manager, learner, other] = await Promise.all(['owner', 'manager', 'learner', 'other'].map(makeUser))
  const workspace = await admin.workspace.create({ data: { name: 'Deletion test', kind: 'ORGANIZATION', slug: `${suffix}-org` } })
  const beta = await admin.workspace.create({ data: { name: 'Other tenant', kind: 'ORGANIZATION', slug: `${suffix}-beta` } })
  const member = (userId: string, role: 'OWNER' | 'ADMIN' | 'LEARNER', workspaceId = workspace.id) => admin.workspaceMember.create({ data: { workspaceId, userId, role, state: 'ACTIVE', acceptedAt: new Date() } })
  const [o, m, l, x, b] = await Promise.all([member(owner.id, 'OWNER'), member(manager.id, 'ADMIN'), member(learner.id, 'LEARNER'), member(other.id, 'LEARNER'), member(learner.id, 'LEARNER', beta.id)])
  await admin.workspaceFeature.create({ data: { workspaceId: workspace.id, feature: 'elevate', entitled: true, enabled: true, memberDefault: true } })
  const token = (userId: string, membershipId: string, workspaceId = workspace.id) => signWorkspaceToken({ userId, membershipId, workspaceId })
  return { owner, manager, learner, other, workspace, beta, o, m, l, x, b,
    ownerToken: token(owner.id, o.id), managerToken: token(manager.id, m.id), learnerToken: token(learner.id, l.id), betaToken: token(learner.id, b.id, beta.id) }
}

async function seed(f: Awaited<ReturnType<typeof fixture>>) {
 const make = (workspaceId: string, userId = f.learner.id) => admin.session.create({ data: { workspaceId, workspaceKind: 'ORGANIZATION', userId, module: 'elevate', sessionName: 'Learner practice', endedAt: new Date(), durationSec: 52 } })
 const [session, peer, beta, personal] = await Promise.all([make(f.workspace.id), make(f.workspace.id, f.other.id), make(f.beta.id), admin.session.create({ data: { userId: f.learner.id, module: 'elevate', endedAt: new Date() } })])
 await admin.sessionTranscript.create({ data: { sessionId: session.id, conversationData: { messages: [{ role: 'user', content: 'Answer in this tenant' }] } } })
 return { session, peer, beta, personal }
}
function headers(user: { id: string; email: string }, workspaceToken: string) {
 return { Authorization: `Bearer ${signToken({ userId: user.id, email: user.email, role: 'USER' })}`, 'x-spasht-workspace': workspaceToken }
}
describe.skipIf(!config.url)('tenant Elevate manager review (restricted database)', () => {
 beforeAll(async () => { process.env.WORKSPACES_ENABLED='true'; await prepareWorkspaceTestRole(admin); oldFlag=await admin.platformFeatureFlag.findUnique({where:{feature:'elevate'}}); await admin.platformFeatureFlag.upsert({where:{feature:'elevate'},create:{feature:'elevate',label:'Elevate'},update:{hidden:false,disabled:false}}) })
 afterAll(async () => { await admin.workspace.deleteMany({ where: { slug: { startsWith: tag } } }); await admin.user.deleteMany({ where: { email: { startsWith: tag } } }); if(oldFlag) await admin.platformFeatureFlag.update({where:{feature:'elevate'},data:{hidden:oldFlag.hidden,disabled:oldFlag.disabled}}); else await admin.platformFeatureFlag.delete({where:{feature:'elevate'}}); await prisma.$disconnect(); await admin.$disconnect() })
 it('lists tenant learner sessions for both Owners and Admins, with learner identity; learners see only their own', async () => {
  const f=await fixture(), s=await seed(f)
  for(const h of [headers(f.owner,f.ownerToken),headers(f.manager,f.managerToken)]) {
   const result=await request(app).get('/sessions').set(h)
   expect(result.status,result.text).toBe(200)
   expect(result.body.sessions.map((r: {id:string})=>r.id).sort()).toEqual([s.session.id,s.peer.id].sort())
   expect(result.body.sessions.find((r: {id:string})=>r.id===s.session.id).user.email).toBe(f.learner.email)
   expect((await request(app).get('/sessions?scope=mine').set(h)).body.sessions).toEqual([])
  }
  const own=await request(app).get('/sessions').set(headers(f.learner,f.learnerToken))
  expect(own.body.sessions.map((r: {id:string})=>r.id)).toEqual([s.session.id])
 })
 it('allows read-only results, transcript and playback tickets, while denying mutations and cross-tenant or Personal reads', async () => {
  const f=await fixture(), s=await seed(f), h=headers(f.owner,f.ownerToken)
  for(const tail of ['', '/metrics','/transcript','/turns']) {
   const result=await request(app).get(`/sessions/${s.session.id}${tail}`).set(h)
   expect(result.status,result.text).toBe(200)
  }
  const ticket=await request(app).post(`/sessions/${s.session.id}/recording/ticket`).set(h).send({})
  expect(ticket.status,ticket.text).toBe(200); expect(ticket.body.ticket).toBeTruthy()
  expect((await request(app).delete(`/sessions/${s.session.id}`).set(h)).status).toBe(404)
  for(const foreign of [s.beta,s.personal]) expect((await request(app).get(`/sessions/${foreign.id}`).set(h)).status).toBe(404)
  expect((await request(app).get(`/sessions/${s.peer.id}`).set(headers(f.learner,f.learnerToken))).status).toBe(404)
  expect(await admin.session.findUnique({ where: { id:s.session.id } })).toEqual(s.session)
 })
 it('revokes manager review immediately when the role is demoted or membership suspended', async () => {
  const f=await fixture(), s=await seed(f), h=headers(f.manager,f.managerToken)
  expect((await request(app).get(`/sessions/${s.session.id}`).set(h)).status).toBe(200)
  await admin.workspaceMember.update({ where: { id:f.m.id }, data: { role:'LEARNER' } })
  expect((await request(app).get(`/sessions/${s.session.id}`).set(h)).status).toBe(404)
  await admin.workspaceMember.update({ where: { id:f.m.id }, data: { role:'ADMIN',state:'SUSPENDED' } })
  expect((await request(app).get('/sessions').set(h)).status).toBe(404)
 })
 it('does not grant manager review when Elevate is disabled in the tenant', async () => {
  const f=await fixture(), s=await seed(f)
  await admin.workspaceFeature.update({where:{workspaceId_feature:{workspaceId:f.workspace.id,feature:'elevate'}},data:{enabled:false}})
  expect((await request(app).get(`/sessions/${s.session.id}`).set(headers(f.owner,f.ownerToken))).status).toBe(404)
 })
 it('keeps aggregate reports private and prevents writes to another learner through inherited child visibility', async () => {
  const f=await fixture(), s=await seed(f)
  const input={ actorId:f.owner.id, workspaceId:f.workspace.id, membershipId:f.o.id, role:'OWNER' as const, slug:f.workspace.slug,timeZone:'UTC',features:{},origin:'request' as const,reader:'session_review' as const }
  await runWithDataScope(input, async () => {
   expect(await prisma.sessionTranscript.findUnique({ where:{ sessionId:s.session.id } })).not.toBeNull()
   expect((await prisma.sessionTranscript.updateMany({ where:{ sessionId:s.session.id }, data:{ conversationData:{} } })).count).toBe(0)
   expect((await prisma.sessionTranscript.deleteMany({ where:{ sessionId:s.session.id } })).count).toBe(0)
   expect((await prisma.session.updateMany({ where:{ id:s.session.id },data:{sessionName:'changed'} })).count).toBe(0)
  })
  await runWithDataScope({...input,reader:'manager'},async()=>{
   expect(await prisma.sessionTranscript.findUnique({where:{sessionId:s.session.id}})).toBeNull()
  })
 })
})
