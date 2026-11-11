import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config = vi.hoisted(() => {
 const url = process.env.INVITATION_LIMIT_TEST_DATABASE_URL
 if(url && url !== 'postgresql://postgres@127.0.0.1:55443/spasht_invitation_limits_test') throw new Error('Use dedicated invitation-limit test database')
 return {url}
})
vi.mock('../src/lib/prisma', async () => { const {PrismaClient}=await import('@prisma/client');return {prisma:new PrismaClient({datasourceUrl:config.url?.replace('postgres@','tenancy_test_app@')})} })
vi.mock('../src/lib/email',()=>({sendEmail:vi.fn(async()=>({sent:true}))}))
import {prisma} from '../src/lib/prisma'
import {signWorkspaceToken,signToken} from '../src/lib/jwt'
import {workspaceRouter,platformWorkspacesRouter} from '../src/workspaces/routes'
import {reserveWorkspaceInvitationSend} from '../src/workspaces/invitationLimits'
import {withLockedWorkspaceAccess} from '../src/workspaces/context'
import {invitationLimitsSchema} from '../src/workspaces/contracts'
import {batchEmailsSchema} from '../src/lib/invitationBatch'
const admin=new PrismaClient({datasourceUrl:config.url}),tag=`invl_${randomUUID().replaceAll('-','')}`
let seq=0
const app=express();app.use(express.json());app.use('/api/workspaces',workspaceRouter);app.use('/api/admin/workspaces',platformWorkspacesRouter)
async function fixture(){
 const id=`${tag}_${seq++}`,make=(name:string,role:'USER'|'ADMIN'='USER')=>admin.user.create({data:{email:`${id}_${name}@example.invalid`,role,emailVerified:true}})
 const [owner,manager,platform]=await Promise.all([make('owner'),make('manager'),make('platform','ADMIN')])
 const workspace=await admin.workspace.create({data:{name:'Limits test',slug:id,kind:'ORGANIZATION',maxMembers:500}})
 const [o,m]=await Promise.all([admin.workspaceMember.create({data:{workspaceId:workspace.id,userId:owner.id,role:'OWNER',state:'ACTIVE',acceptedAt:new Date()}}),admin.workspaceMember.create({data:{workspaceId:workspace.id,userId:manager.id,role:'ADMIN',state:'ACTIVE',acceptedAt:new Date()}})])
 return {workspace,owner,manager,platform,claims:{tokenUse:'workspace' as const,userId:owner.id,workspaceId:workspace.id,membershipId:o.id},token:signWorkspaceToken({userId:owner.id,workspaceId:workspace.id,membershipId:o.id}),managerToken:signWorkspaceToken({userId:manager.id,workspaceId:workspace.id,membershipId:m.id}),platformToken:signToken({userId:platform.id,email:platform.email,role:'ADMIN'})}
}
const single=(token:string,email:string)=>request(app).post('/api/workspaces/current/invitations').set('Authorization',`Bearer ${token}`).send({email,role:'LEARNER'})
const patch=(f:Awaited<ReturnType<typeof fixture>>,invitationLimits:unknown,token=f.platformToken)=>request(app).patch(`/api/admin/workspaces/${f.workspace.id}`).set('Authorization',`Bearer ${token}`).send({invitationLimits})
describe.skipIf(!config.url)('configurable tenant invitation limits (restricted database)',()=>{
 beforeAll(async()=>{process.env.WORKSPACES_ENABLED='true';delete process.env.INVITATION_EMAIL_DELIVERY;await prepareWorkspaceTestRole(admin)})
 afterAll(async()=>{await admin.workspace.deleteMany({where:{slug:{startsWith:tag}}});const users=await admin.user.findMany({where:{email:{startsWith:tag}},select:{id:true}});await admin.adminAction.deleteMany({where:{adminId:{in:users.map(x=>x.id)}}});await admin.user.deleteMany({where:{email:{startsWith:tag}}});await prisma.$disconnect();await admin.$disconnect()})
 it('preserves 20/60 defaults and allows only platform Admins to configure a tenant',async()=>{
  const f=await fixture();expect(f.workspace).toMatchObject({invitationBatchSize:20,invitationHourlyLimit:60})
  const ownerIdentity=signToken({userId:f.owner.id,email:f.owner.email,role:'USER'})
  expect((await patch(f,{batchSize:100,hourlyLimit:null},ownerIdentity)).status).toBe(403)
  const saved=await patch(f,{batchSize:100,hourlyLimit:null});expect(saved.status,saved.text).toBe(200)
  expect(saved.body.invitationLimits).toEqual({batchSize:100,hourlyLimit:null})
  const entry=await request(app).get('/api/workspaces/current').set('Authorization',`Bearer ${f.token}`)
  expect(entry.body.workspace.invitationLimits).toEqual({batchSize:100,hourlyLimit:null})
 })
 it('accepts batches above 20 after configuration and rejects oversized batches before saving or sending',async()=>{
  const f=await fixture(),emails=Array.from({length:21},(_,i)=>`${tag}_bulk${seq}_${i}@example.invalid`)
  const send=()=>request(app).post('/api/workspaces/current/invitations/bulk').set('Authorization',`Bearer ${f.token}`).send({emails})
  expect((await send()).body.code).toBe('INVITATION_BATCH_LIMIT');expect(await admin.userInvitation.count({where:{workspaceId:f.workspace.id}})).toBe(0)
  await patch(f,{batchSize:50,hourlyLimit:null})
  const result=await send();expect(result.status,result.text).toBe(200);expect(result.body.results).toHaveLength(21);expect(result.body.results.every((r:{ok:boolean})=>r.ok)).toBe(true)
  expect((await admin.workspace.findUniqueOrThrow({where:{id:f.workspace.id}})).invitationWindowCount).toBe(21)
  expect(batchEmailsSchema.safeParse(emails).success).toBe(false) // Platform batches retain their own existing default.
 })
 it('shares the hourly budget across concurrent senders and retains it across requests',async()=>{
  const f=await fixture();await patch(f,{batchSize:20,hourlyLimit:2})
  const results=await Promise.all([single(f.token,`${tag}_${seq}_a@example.invalid`),single(f.managerToken,`${tag}_${seq}_b@example.invalid`),single(f.token,`${tag}_${seq}_c@example.invalid`)])
  expect(results.map(r=>r.status).sort()).toEqual([200,200,429])
  expect((await admin.workspace.findUniqueOrThrow({where:{id:f.workspace.id}})).invitationWindowCount).toBe(2)
  expect((await single(f.managerToken,`${tag}_${seq}_d@example.invalid`)).status).toBe(429)
  const other=await fixture();await patch(other,{batchSize:20,hourlyLimit:1});expect((await single(other.token,`${tag}_${seq}_other@example.invalid`)).status).toBe(200)
 })
 it('removes the hourly cap without resetting usage and counts resends',async()=>{
  const f=await fixture();await patch(f,{batchSize:20,hourlyLimit:1})
  const first=await single(f.token,`${tag}_${seq}_initial@example.invalid`);expect(first.status).toBe(200)
  const resend=()=>request(app).post(`/api/workspaces/current/invitations/${first.body.id}/resend`).set('Authorization',`Bearer ${f.token}`).send({})
  expect((await resend()).status).toBe(429)
  await patch(f,{batchSize:100,hourlyLimit:null})
  expect((await resend()).status).toBe(200)
  await admin.workspace.update({where:{id:f.workspace.id},data:{invitationWindowCount:10001}})
  expect((await single(f.token,`${tag}_${seq}_unlimited@example.invalid`)).status).toBe(200)
  expect((await admin.workspace.findUniqueOrThrow({where:{id:f.workspace.id}})).invitationWindowCount).toBe(10002)
  await patch(f,{batchSize:20,hourlyLimit:10});expect((await single(f.token,`${tag}_${seq}_capped@example.invalid`)).status).toBe(429)
 })
 it('expires the hourly window and rolls the counter back with a failed transaction',async()=>{
  const f=await fixture();await patch(f,{batchSize:20,hourlyLimit:1})
  await admin.workspace.update({where:{id:f.workspace.id},data:{invitationWindowCount:1,invitationWindowStartedAt:new Date(Date.now()-3600001)}})
  expect((await single(f.token,`${tag}_${seq}_expired@example.invalid`)).status).toBe(200)
  await patch(f,{batchSize:20,hourlyLimit:null})
  await expect(withLockedWorkspaceAccess(f.claims,async(tx,scope)=>{await reserveWorkspaceInvitationSend(tx,scope.workspace);throw new Error('rollback')})).rejects.toThrow('rollback')
  expect((await admin.workspace.findUniqueOrThrow({where:{id:f.workspace.id}})).invitationWindowCount).toBe(1)
 })
 it('validates limits and refuses tenant-side attempts to change them',async()=>{
  for(const body of [{batchSize:0,hourlyLimit:1},{batchSize:501,hourlyLimit:null},{batchSize:20,hourlyLimit:0},{batchSize:20,hourlyLimit:10001},{batchSize:20,hourlyLimit:'unlimited'}])expect(invitationLimitsSchema.safeParse(body).success).toBe(false)
  const f=await fixture();expect((await patch(f,{batchSize:20,hourlyLimit:0})).status).toBe(400)
  const result=await request(app).patch('/api/workspaces/current/branding').set('Authorization',`Bearer ${f.token}`).send({invitationLimits:{batchSize:500,hourlyLimit:null}})
  expect(result.status).toBe(400)
 })
})
