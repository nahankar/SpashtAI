import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { readyDraft } from './fixtures/bank-draft'
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && !/^postgresql:\/\/postgres@127\.0\.0\.1:55441\/(postgres|upgrade_bank|review_bank|review_upgrade|simple_bank|simple_upgrade)$/.test(url)) throw new Error('Bank tests require the isolated test database on port 55441')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/simple_bank' }) }
})
import { prisma } from '../src/lib/prisma'
import { createQuestion, detail, editQuestion, previewImport, confirmImport, bulkAction, questionAction } from '../src/interviews/bank/service'
import { enqueueFollowUps, sweepFollowUps, followUpIdentity } from '../src/interviews/bank/followUps'
import { importOptionsSchema } from '../src/interviews/bank/import'
import router from '../src/routes/admin/interview-bank'
import followUpRouter from '../src/routes/internal/interview-followups'
import { requireAuth } from '../src/middleware/auth'
import { signToken } from '../src/lib/jwt'
const namespace = `test_${randomUUID().replaceAll('-', '')}`
let actor: string; let qid = 0
const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/bank', requireAuth, router); app.use('/internal/sessions', followUpRouter)
const token = (role = 'ADMIN') => signToken({ userId: actor, email: 'bank-test@example.invalid', role })
async function createReady() { return createQuestion({ namespace, externalQid: `AUTO-${++qid}` }, readyDraft(), actor) }
async function selection(ids: string[]) { return Promise.all(ids.map(async id => ({ id, revision: (await detail(id)).question.revision }))) }
async function csv(text: string, options: ReturnType<typeof importOptionsSchema.parse>) { const id = await previewImport(Buffer.from(text), options, actor); await confirmImport(id, actor); return id }
describe.skipIf(!testDb.url)('single-copy question bank PostgreSQL workflow', () => {
  beforeAll(async () => { actor = (await prisma.user.create({ data: { email: `${namespace}@example.invalid`, role: 'ADMIN' } })).id })
  afterAll(async () => { await prisma.user.deleteMany({ where: { id: actor } }); await prisma.$disconnect() })
  it('requires login and current Admin role for reads and writes', async () => {
    expect((await request(app).get('/bank/questions')).status).toBe(401)
    expect((await request(app).get('/bank/questions').auth(token('USER'), { type: 'bearer' })).status).toBe(403)
    const stale = token(); await prisma.user.update({ where: { id: actor }, data: { role: 'USER' } })
    expect((await request(app).get('/bank/questions').auth(stale, { type: 'bearer' })).status).toBe(403)
    await prisma.user.update({ where: { id: actor }, data: { role: 'ADMIN' } })
    expect((await request(app).get('/bank/questions').auth(stale, { type: 'bearer' })).status).toBe(200)
  })
  it('edits an active question in place and resets approval, without creating a second copy', async () => {
    const id = await createReady(); await questionAction(id, 1, 'approve_activate', actor)
    await editQuestion(id, 2, { ...readyDraft(), explanation: 'Updated explanation' }, actor)
    expect((await detail(id)).question).toMatchObject({ approved: false, active: false, revision: 3 })
    expect(await prisma.questionBankQuestion.count({ where: { namespace, externalQid: (await detail(id)).question.externalQid } })).toBe(1)
    await expect(editQuestion(id, 2, readyDraft(), actor)).rejects.toMatchObject({ status: 409 })
  })
  it('serializes competing edits and rejects duplicate QIDs', async () => {
    const id = await createReady()
    const edits = await Promise.allSettled([editQuestion(id, 1, readyDraft(), actor), editQuestion(id, 1, readyDraft(), actor)])
    expect(edits.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    await expect(createQuestion({ namespace, externalQid: (await detail(id)).question.externalQid }, readyDraft(), actor)).rejects.toMatchObject({ status: 409 })
  })
  it('applies bulk approval/activation/deactivation atomically and rejects stale selections', async () => {
    const ids = await Promise.all([createReady(),createReady()])
    const old = await selection(ids)
    expect(await bulkAction({ action: 'approve', questions: old }, actor)).toEqual({ changed: 2 })
    await expect(bulkAction({ action: 'activate', questions: old }, actor)).rejects.toMatchObject({ status: 409 })
    await bulkAction({ action: 'activate', questions: await selection(ids) }, actor)
    await bulkAction({ action: 'deactivate', questions: await selection(ids) }, actor)
    expect((await detail(ids[0])).question).toMatchObject({ approved: true, active: false })
    const incomplete = await createQuestion({ namespace, externalQid: 'INCOMPLETE' }, { ...readyDraft(), track: 'General' }, actor)
    await expect(bulkAction({ action: 'approve_activate', questions: await selection([ids[0],incomplete]) }, actor)).rejects.toMatchObject({ status: 400 })
    expect((await detail(ids[0])).question.active).toBe(false)
    await expect(prisma.questionBankQuestion.update({ where: { id: incomplete }, data: { active: true } })).rejects.toThrow()
  })
  it('returns selected revisions across all matching pages and keeps guidance private in preview', async () => {
    const id = await createReady(); const auth = token()
    const preview = await request(app).get(`/bank/questions/${id}/learner-preview`).auth(auth,{ type:'bearer' })
    expect(preview.status).toBe(200); expect(preview.body.preview.exampleAnswer).toBe(readyDraft().exampleAnswer)
    expect(JSON.stringify(preview.body)).not.toMatch(/goodAnswerPoints|followUpGuidance|reviewNotes/)
    const response = await request(app).post('/bank/questions/selection').auth(auth,{ type:'bearer' }).send({ search: (await detail(id)).question.externalQid })
    expect(response.body.questions).toContainEqual({ id, revision: 1 })
  })
  it('combines track, complexity, category, status and search for listing and bulk selection across pages', async () => {
    const auth = token(); const category = `Category ${namespace}`; const search = `Filter ${namespace}`; const track = `Track ${namespace}`
    const ids: string[] = []
    const matching: string[] = []
    try {
      for (let i = 0; i < 35; i++) {
        const id = await createQuestion({ namespace, externalQid: `FILTER-${i}` }, {
          ...readyDraft(), questionText: `${search} ${i}?`, category: i === 31 ? `Other ${namespace}` : category,
          difficulty: i === 32 ? 'Very Complex' : 'Simple', track: i === 34 ? `Other track ${namespace}` : track,
        }, actor)
        ids.push(id)
        if (i < 31) matching.push(id)
      }
      await bulkAction({ action: 'approve_activate', questions: await selection(ids.filter((_id, i) => i !== 33)) }, actor)
      const filters = { search, category, difficulty: 'Simple', status: 'ACTIVE', track }
      const first = await request(app).get('/bank/questions').query(filters).auth(auth, { type:'bearer' })
      const second = await request(app).get('/bank/questions').query({ ...filters, page: 2 }).auth(auth, { type:'bearer' })
      expect(first.status).toBe(200); expect(first.body.total).toBe(31); expect(first.body.questions).toHaveLength(30)
      expect(second.body.total).toBe(31); expect(second.body.questions).toHaveLength(1)
      expect([...first.body.questions, ...second.body.questions].map(q => q.id).sort()).toEqual([...matching].sort())
      expect(first.body.questions.every(q => q.track === track && q.category === category && q.difficulty === 'Simple' && q.active)).toBe(true)
      const selected = await request(app).post('/bank/questions/selection').auth(auth, { type:'bearer' }).send(filters)
      expect(selected.status).toBe(200)
      expect(selected.body.questions).toEqual(await selection([...matching].sort()))
      const options = await request(app).get('/bank/filters').auth(auth, { type:'bearer' })
      expect(options.status).toBe(200); expect(options.body.categories).toContain(category)
      expect(new Set(options.body.categories).size).toBe(options.body.categories.length)
      expect(options.body.tracks).toContain(track)
      expect(options.body.tracks).toContain(`Other track ${namespace}`)
      const scopedOptions = await request(app).get('/bank/filters').query({ track: `Other track ${namespace}` }).auth(auth, { type:'bearer' })
      expect(scopedOptions.body.categories).toEqual([category])
      expect(scopedOptions.body.tracks).toEqual(options.body.tracks)
      expect((await request(app).get('/bank/filters')).status).toBe(401)
      expect((await request(app).get('/bank/questions').query({ difficulty: 'Impossible' }).auth(auth, { type:'bearer' })).status).toBe(400)
      expect((await request(app).post('/bank/questions/selection').auth(auth, { type:'bearer' }).send({ difficulty: 'Impossible' })).status).toBe(400)
    } finally {
      await prisma.questionBankQuestion.deleteMany({ where: { id: { in: ids } } })
    }
  })
  it('imports Copilot learning fields; updates preserve unmapped fields and reset approval', async () => {
    const scope = `${namespace}_csv`
    const options = importOptionsSchema.parse({ namespace: scope, mode: 'UPDATE_BY_QID', mapping: { externalQid: 'QID', questionText: 'Question', track: 'Track', goodAnswerPoints: 'Good Answer Points', exampleAnswer: 'Learner Example Answer' } })
    const file = 'QID,Question,Track,Good Answer Points,Learner Example Answer\nQ-1,How do fixtures work?,Python,Independent state,Use fresh fixtures'
    const batchIds = await Promise.all([previewImport(Buffer.from(file), options, actor), previewImport(Buffer.from(file), options, actor)])
    expect(batchIds[0]).toBe(batchIds[1]); await Promise.all([confirmImport(batchIds[0],actor),confirmImport(batchIds[0],actor)])
    const q = await prisma.questionBankQuestion.findFirstOrThrow({ where: { namespace: scope } })
    expect(q).toMatchObject({ active:false, approved:false, exampleAnswer:'Use fresh fixtures', goodAnswerPoints:'Independent state' })
    await questionAction(q.id,1,'approve_activate',actor)
    const sparse = { ...options, mapping: { externalQid:'QID',questionText:'Question' } }
    await csv('QID,Question\nQ-1,How should fixtures work?', sparse)
    expect((await detail(q.id)).question).toMatchObject({ exampleAnswer:'Use fresh fixtures', active:false, approved:false })
    expect(await prisma.questionBankQuestion.count({ where: { namespace: scope } })).toBe(1)
    await csv('QID,Question\nQ-1,How should fixtures work?', sparse)
    expect((await detail(q.id)).question.revision).toBe(3)
  })
  it('does not overwrite edits made after an import preview', async () => {
    const id = await createReady(); const q = (await detail(id)).question
    const options = importOptionsSchema.parse({ namespace, mode:'UPDATE_BY_QID',mapping:{externalQid:'QID',questionText:'Question'} })
    const batch = await previewImport(Buffer.from(`QID,Question\n${q.externalQid},Updated from CSV?`),options,actor)
    await editQuestion(id,1,{ ...readyDraft(),questionText:'Manual edit wins?' },actor); await confirmImport(batch,actor)
    expect((await detail(id)).question.questionText).toBe('Manual edit wins?')
    expect((await prisma.questionImportRow.findFirstOrThrow({where:{batchId:batch}})).status).toBe('ERROR')
    await csv(`QID,Question\n${q.externalQid},Updated from CSV?`,options)
    expect((await detail(id)).question.questionText).toBe('Updated from CSV?')
  })
  it('deletes approved/active questions and clears import links without deleting audit records', async () => {
    const options=importOptionsSchema.parse({namespace:`${namespace}_delete`,mode:'ADD_ONLY',mapping:{externalQid:'QID',questionText:'Question'}})
    const batch=await csv('QID,Question\nDEL-1,What is isolation?',options)
    const row=await prisma.questionImportRow.findFirstOrThrow({where:{batchId:batch}});const id=row.resultQuestionId!
    await editQuestion(id,1,readyDraft(),actor);await questionAction(id,2,'approve_activate',actor)
    expect((await request(app).post(`/bank/questions/${id}/delete`).auth(token(),{type:'bearer'}).send({revision:3})).status).toBe(400)
    const response=await request(app).delete(`/bank/questions/${id}`).auth(token(),{type:'bearer'}).send({revision:3})
    expect(response.status).toBe(200); await expect(detail(id)).rejects.toMatchObject({status:404})
    expect((await prisma.questionImportRow.findUniqueOrThrow({where:{id:row.id}})).resultQuestionId).toBeNull()
    expect(await prisma.adminAction.count({where:{adminId:actor,action:'interview_bank.delete'}})).toBeGreaterThan(0)
  })
  it('rejects old rubric fields and provides the enriched CSV template', async () => {
    const auth=token()
    expect((await request(app).post('/bank/questions').auth(auth,{type:'bearer'}).send({identity:{namespace,externalQid:'INVALID'},draft:{...readyDraft(),rubric:{}}})).status).toBe(400)
    const response=await request(app).get('/bank/imports/template').auth(auth,{type:'bearer'})
    expect(response.status).toBe(200);expect(response.text).toContain('Good Answer Points');expect(response.text).toContain('Follow-up Guidance')
  })
  it('enqueues only completed interview follow-ups and asynchronously creates inactive drafts once', async () => {
    const session=await prisma.session.create({data:{userId:actor,module:'elevate',purpose:'INTERVIEW',contextScope:'SESSION_ONLY'}})
    const followUpDraft={...readyDraft(),questionText:`How does ${namespace} isolate a generated follow-up?`}
    const inputs=[{turnId:'follow-up-1',draft:followUpDraft}]
    await expect(enqueueFollowUps(session.id,inputs)).rejects.toMatchObject({status:409})
    await prisma.session.update({where:{id:session.id},data:{endedAt:new Date()}})
    await Promise.all([enqueueFollowUps(session.id,inputs),enqueueFollowUps(session.id,inputs)])
    expect(await prisma.bankFollowUpJob.count({where:{sessionId:session.id}})).toBe(1)
    await prisma.bankFollowUpJob.updateMany({where:{sessionId:session.id},data:{nextAt:new Date(Date.now()-1000)}})
    await Promise.all([sweepFollowUps(),sweepFollowUps()])
    const job=await prisma.bankFollowUpJob.findFirstOrThrow({where:{sessionId:session.id}})
    const q=await prisma.questionBankQuestion.findUniqueOrThrow({where:{originKey:followUpIdentity(followUpDraft).originKey}})
    expect(q).toMatchObject({approved:false,active:false,origin:'GENERATED_FOLLOW_UP',explanation:readyDraft().explanation,goodAnswerPoints:readyDraft().goodAnswerPoints})
    expect(job).toMatchObject({status:'COMPLETED',payload:{}})
    await enqueueFollowUps(session.id,inputs);await sweepFollowUps()
    expect(await prisma.questionBankQuestion.count({where:{originKey:followUpIdentity(followUpDraft).originKey}})).toBe(1)
    const otherSession=await prisma.session.create({data:{userId:actor,module:'elevate',purpose:'INTERVIEW',contextScope:'SESSION_ONLY',endedAt:new Date()}})
    await enqueueFollowUps(otherSession.id,[{turnId:'another-session-turn',draft:followUpDraft}])
    await prisma.bankFollowUpJob.updateMany({where:{sessionId:otherSession.id},data:{nextAt:new Date(Date.now()-1000)}})
    await sweepFollowUps()
    expect(await prisma.questionBankQuestion.count({where:{originKey:followUpIdentity(followUpDraft).originKey}})).toBe(1)
    await prisma.session.delete({where:{id:otherSession.id}})

    expect((await request(app).post(`/internal/sessions/${session.id}/interview-followups`).auth(token(),{type:'bearer'}).send({questions:inputs})).status).toBe(403)
    await prisma.session.delete({where:{id:session.id}})
    expect(await prisma.bankFollowUpJob.count({where:{sessionId:session.id}})).toBe(0)
  })
  it('cancels queued drafts after discard and rejects communication sessions', async () => {
    const session=await prisma.session.create({data:{userId:actor,module:'elevate',purpose:'INTERVIEW',contextScope:'SESSION_ONLY',endedAt:new Date()}})
    await enqueueFollowUps(session.id,[{turnId:'follow-up-2',draft:readyDraft()}])
    await prisma.session.update({where:{id:session.id},data:{discardedAt:new Date()}})
    await prisma.bankFollowUpJob.updateMany({where:{sessionId:session.id},data:{nextAt:new Date(Date.now()-1000)}});await sweepFollowUps()
    expect((await prisma.bankFollowUpJob.findFirstOrThrow({where:{sessionId:session.id}})).status).toBe('CANCELLED')
    await prisma.session.update({where:{id:session.id},data:{discardedAt:null,purpose:'COMMUNICATION'}})
    await expect(enqueueFollowUps(session.id,[{turnId:'follow-up-3',draft:readyDraft()}])).rejects.toMatchObject({status:409})
    await prisma.session.delete({where:{id:session.id}})
  })
  it('backs off failed jobs and processes other questions instead of blocking the queue', async () => {
    const session=await prisma.session.create({data:{userId:actor,module:'elevate',purpose:'INTERVIEW',contextScope:'SESSION_ONLY',endedAt:new Date()}})
    const draft={...readyDraft(),questionText:`Collision ${namespace}?`}
    const identity=followUpIdentity(draft)
    await createQuestion({namespace:identity.namespace,externalQid:identity.externalQid},draft,actor)
    await enqueueFollowUps(session.id,[{turnId:'collision',draft},{turnId:'valid',draft:{...draft,questionText:`Valid follow-up ${namespace}?`}}])
    const queued=await prisma.bankFollowUpJob.findMany({where:{sessionId:session.id}})
    const jobs=[queued.find(j => (j.payload as {questionText:string}).questionText === draft.questionText)!, queued.find(j => (j.payload as {questionText:string}).questionText !== draft.questionText)!]
    await prisma.bankFollowUpJob.updateMany({where:{sessionId:session.id},data:{nextAt:new Date(Date.now()-1000)}})
    await sweepFollowUps()
    expect((await prisma.bankFollowUpJob.findUniqueOrThrow({where:{id:jobs[0].id}}))).toMatchObject({status:'PENDING',attempts:1})
    expect((await prisma.bankFollowUpJob.findUniqueOrThrow({where:{id:jobs[1].id}})).status).toBe('COMPLETED')
    for(let retry=0;retry<4;retry++) {
      await prisma.bankFollowUpJob.update({where:{id:jobs[0].id},data:{nextAt:new Date(Date.now()-1000)}})
      await sweepFollowUps()
    }
    expect((await prisma.bankFollowUpJob.findUniqueOrThrow({where:{id:jobs[0].id}}))).toMatchObject({status:'FAILED',attempts:5})
    await prisma.session.delete({where:{id:session.id}})
  })
  it('retains shared questions when their creator account is removed', async () => {
    const user=await prisma.user.create({data:{email:`${namespace}_author@example.invalid`,role:'ADMIN'}})
    const id=await createQuestion({namespace,externalQid:'AUTHOR'},readyDraft(),user.id)
    await questionAction(id,1,'approve_activate',user.id);await prisma.user.delete({where:{id:user.id}})
    expect((await detail(id)).question).toMatchObject({active:true,createdById:null,approvedById:null})
  })
})
