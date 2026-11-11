import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import express from 'express'
import request from 'supertest'
import { prepareWorkspaceTestRole } from './workspace-test-role'
const config=vi.hoisted(()=>{const url=process.env.INVITATION_LIMIT_TEST_DATABASE_URL;if(url&&url!=='postgresql://postgres@127.0.0.1:55443/spasht_invitation_limits_test')throw new Error('Use isolated profile database');return{url}})
vi.mock('../src/lib/prisma',async()=>{const{PrismaClient}=await import('@prisma/client');return{prisma:new PrismaClient({datasourceUrl:config.url?.replace('postgres@','tenancy_test_app@')})}})
vi.mock('../src/lib/pincode',async original=>({...await original<typeof import('../src/lib/pincode')>(),resolvePincodeLocation:async()=>({city:'Bengaluru',state:'Karnataka',country:'India'})}))
import {prisma} from '../src/lib/prisma'
import {signWorkspaceToken} from '../src/lib/jwt'
import {workspaceRouter} from '../src/workspaces/routes'
const admin=new PrismaClient({datasourceUrl:config.url}),tag=`profiles_${randomUUID().replaceAll('-','')}`;let seq=0
const fields=[{id:'branch',label:'Branch',type:'dropdown',required:true,options:['CSE','ECE'],filterable:true},{id:'semester',label:'Current semester',type:'dropdown',required:true,options:['1','2','3','4'],filterable:true}]
const basic={phone:'9876543210',dateOfBirth:'1999-05-25',gender:'MALE',pincode:'560001'}
const app=express();app.use(express.json());app.use('/api/workspaces',workspaceRouter)
async function fixture(){
 const suffix=`${tag}_${seq++}`,make=(n:string)=>admin.user.create({data:{email:`${suffix}_${n}@example.invalid`,firstName:n,emailVerified:true,...(n==='learner'?{...basic,dateOfBirth:new Date(basic.dateOfBirth),gender:'MALE' as const,googleId:`google_${suffix}`}:{})}})
 const [owner,manager,learner]=await Promise.all(['owner','manager','learner'].map(make))
 const workspace=await admin.workspace.create({data:{name:'Profiles',slug:suffix,kind:'ORGANIZATION',enrollmentSettings:{fields,email:{subject:'',message:''}}}})
 const beta=await admin.workspace.create({data:{name:'Other tenant',slug:`${suffix}-beta`,kind:'ORGANIZATION'}})
 const member=(userId:string,role:'OWNER'|'ADMIN'|'LEARNER',workspaceId=workspace.id)=>admin.workspaceMember.create({data:{userId,role,workspaceId,state:'ACTIVE',acceptedAt:new Date(),enrollmentFields:fields,enrollmentResponses:{branch:'CSE',semester:'1'}}})
 const [o,m,l,b]=await Promise.all([member(owner.id,'OWNER'),member(manager.id,'ADMIN'),member(learner.id,'LEARNER'),member(learner.id,'LEARNER',beta.id)])
 const token=(userId:string,membershipId:string)=>signWorkspaceToken({userId,membershipId,workspaceId:workspace.id})
 return{owner,manager,learner,workspace,beta,o,m,l,b,ownerToken:token(owner.id,o.id),managerToken:token(manager.id,m.id),learnerToken:token(learner.id,l.id)}
}
const get=(token:string,id:string)=>request(app).get(`/api/workspaces/current/members/${id}/profile`).set('Authorization',`Bearer ${token}`)
const save=(token:string,id:string,body:unknown)=>request(app).patch(`/api/workspaces/current/members/${id}/profile`).set('Authorization',`Bearer ${token}`).send(body)
const update=(revision:string)=>({revision,firstName:'Corrected',lastName:'Learner',...basic,enrollmentResponses:{branch:'ECE',semester:'3'}})
describe.skipIf(!config.url)('tenant member profiles (restricted database)',()=>{
 beforeAll(async()=>{process.env.WORKSPACES_ENABLED='true';await prepareWorkspaceTestRole(admin)})
 afterAll(async()=>{await admin.workspace.deleteMany({where:{slug:{startsWith:tag}}});await admin.user.deleteMany({where:{email:{startsWith:tag}}});await prisma.$disconnect();await admin.$disconnect()})
 it('lets Owners and Admins view only profiles in their tenant, including administrators and suspended users',async()=>{
  const f=await fixture();expect((await get(f.ownerToken,f.l.id)).body.profile.email).toBe(f.learner.email)
  expect((await get(f.managerToken,f.o.id)).status).toBe(200)
  expect((await get(f.learnerToken,f.o.id)).status).toBe(403)
  expect((await get(f.ownerToken,f.b.id)).status).toBe(404)
  await admin.workspaceMember.update({where:{id:f.l.id},data:{state:'SUSPENDED'}})
  expect((await get(f.managerToken,f.l.id)).status).toBe(200)
 })
 it('updates signup details and custom answers atomically, preserves identity/history and isolates other-tenant custom answers',async()=>{
  const f=await fixture(),history=await admin.session.create({data:{userId:f.learner.id,module:'elevate',endedAt:new Date()}})
  const initial=await get(f.ownerToken,f.l.id),oldUser=await admin.user.findUniqueOrThrow({where:{id:f.learner.id}})
  const result=await save(f.managerToken,f.l.id,{...update(initial.body.revision),pincode:'560002'})
  expect(result.status,result.text).toBe(200)
  expect(result.body.profile).toMatchObject({firstName:'Corrected',lastName:'Learner',phone:basic.phone,pincode:'560002',city:'Bengaluru'})
  expect(result.body.enrollmentResponses).toEqual({branch:'ECE',semester:'3'})
  expect(await admin.workspaceMember.findUnique({where:{id:f.b.id}})).toMatchObject({enrollmentResponses:{branch:'CSE',semester:'1'}})
  expect(await admin.session.findUnique({where:{id:history.id}})).toEqual(history)
  expect(await admin.user.findUnique({where:{id:f.learner.id}})).toMatchObject({id:oldUser.id,email:oldUser.email,role:oldUser.role,googleId:oldUser.googleId,tenantOnly:oldUser.tenantOnly})
  const audit=await admin.workspaceAudit.findFirstOrThrow({where:{action:'member_profile_updated',subjectId:f.l.id}})
  expect(JSON.stringify(audit.metadata)).not.toContain(basic.phone);expect(JSON.stringify(audit.metadata)).not.toContain('1999-05-25')
 })
 it('rejects email/role changes and invalid custom or basic fields without partial writes',async()=>{
  const f=await fixture(),initial=await get(f.ownerToken,f.l.id)
  for(const body of [{...update(initial.body.revision),email:'attacker@example.invalid'},{...update(initial.body.revision),role:'ADMIN'},{...update(initial.body.revision),phone:'1'},{...update(initial.body.revision),dateOfBirth:'2026-02-31'},{...update(initial.body.revision),enrollmentResponses:{branch:'unknown',semester:'3'}}])expect((await save(f.ownerToken,f.l.id,body)).status).toBe(400)
  expect((await get(f.ownerToken,f.l.id)).body.revision).toBe(initial.body.revision)
  expect((await save(f.learnerToken,f.l.id,update(initial.body.revision))).status).toBe(403)
  expect((await save(f.ownerToken,f.b.id,update(initial.body.revision))).status).toBe(404)
 })
 it('rejects stale concurrent edits, updated form definitions and revoked manager access',async()=>{
  const f=await fixture(),initial=await get(f.ownerToken,f.l.id)
  const results=await Promise.all([save(f.ownerToken,f.l.id,update(initial.body.revision)),save(f.managerToken,f.l.id,{...update(initial.body.revision),firstName:'Concurrent'})])
  expect(results.map(r=>r.status).sort()).toEqual([200,409])
  const refreshed=await get(f.ownerToken,f.l.id)
  await admin.workspace.update({where:{id:f.workspace.id},data:{enrollmentSettings:{fields:fields.map(x=>({...x,label:`New ${x.label}`})),email:{subject:'',message:''}}}})
  expect((await save(f.ownerToken,f.l.id,update(refreshed.body.revision))).status).toBe(409)
  await admin.workspaceMember.update({where:{id:f.m.id},data:{role:'LEARNER'}})
  expect((await get(f.managerToken,f.l.id)).status).toBe(403)
 })
 it('retains historical signup fields and uses the current definition when options were expanded',async()=>{
  const f=await fixture();const legacy={id:'legacy',type:'text',label:'Legacy ID',required:false,options:[]}
  await admin.workspaceMember.update({where:{id:f.l.id},data:{enrollmentFields:[...fields,legacy],enrollmentResponses:{branch:'CSE',semester:'1',legacy:'old'}}})
  await admin.workspace.update({where:{id:f.workspace.id},data:{enrollmentSettings:{fields:fields.map(x=>x.id==='semester'?{...x,options:['1','2','3','4','5']}:x),email:{subject:'',message:''}}}})
  const initial=await get(f.ownerToken,f.l.id);expect(initial.body.enrollmentFields).toHaveLength(3)
  const result=await save(f.ownerToken,f.l.id,{...update(initial.body.revision),enrollmentResponses:{branch:'ECE',semester:'5',legacy:'corrected'}})
  expect(result.status,result.text).toBe(200);expect(result.body.enrollmentResponses.legacy).toBe('corrected')
 })
})
