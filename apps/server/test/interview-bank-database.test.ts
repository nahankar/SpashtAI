import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { readyDraft } from './fixtures/bank-draft'
// Never fall back to the app's DATABASE_URL. These tests are opt-in and restricted
// to the disposable loopback database used by the documented verification script.
const testDb = vi.hoisted(() => {
  const url = process.env.BANK_TEST_DATABASE_URL
  if (url && !/^postgresql:\/\/postgres@127\.0\.0\.1:55441\/(postgres|upgrade_bank)$/.test(url)) throw new Error('Bank tests require the isolated test database on port 55441')
  return { url }
})
vi.mock('../src/lib/prisma', async () => {
  const { PrismaClient } = await import('@prisma/client')
  return { prisma: new PrismaClient({ datasourceUrl: testDb.url || 'postgresql://postgres@127.0.0.1:55441/postgres' }) }
})
import { prisma } from '../src/lib/prisma'
import { createQuestion, detail, editVersion, forkVersion, previewImport, confirmImport, transition } from '../src/interviews/bank/service'
import { importOptionsSchema } from '../src/interviews/bank/import'
import router from '../src/routes/admin/interview-bank'
import { requireAuth } from '../src/middleware/auth'
import { signToken } from '../src/lib/jwt'
const namespace = `test_${randomUUID().replaceAll('-', '')}`
let actor: string; let qid = 0
const db = prisma as PrismaClient
async function createReady() { return createQuestion({ namespace, externalQid: `AUTO-${++qid}` }, readyDraft(), actor) }
async function reviewed() { const id = await createReady(); await transition(id, 1, 'review', actor); return id }
const app = express(); app.use(express.json({ limit: '1mb' })); app.use('/bank', requireAuth, router)
const token = (role: string) => signToken({ userId: actor, email: 'bank-test@example.invalid', role })
describe.skipIf(!testDb.url)('question bank PostgreSQL workflow (isolated opt-in)', () => {
  beforeAll(async () => { actor = (await db.user.create({ data: { email: `${namespace}@example.invalid`, role: 'SUPER_ADMIN' } })).id })
  afterAll(async () => { await db.user.deleteMany({ where: { id: actor } }); await db.$disconnect() })
  it('enforces authentication, Admin access and Super Admin publishing on the API', async () => {
    expect((await request(app).get('/bank/questions')).status).toBe(401)
    expect((await request(app).get('/bank/questions').auth(token('USER'), { type: 'bearer' })).status).toBe(403)
    const id = await reviewed()
    expect((await request(app).post(`/bank/versions/${id}/publish`).auth(token('ADMIN'), { type: 'bearer' }).send({ revision: 2 })).status).toBe(403)
    expect((await request(app).post(`/bank/versions/${id}/publish`).auth(token('SUPER_ADMIN'), { type: 'bearer' }).send({ revision: 2 })).status).toBe(200)
    expect((await request(app).post(`/bank/versions/${id}/retire`).auth(token('ADMIN'), { type: 'bearer' }).send({ revision: 3 })).status).toBe(403)
  })
  it('returns only allowed learner content through the authenticated preview', async () => {
    const id = await createReady()
    const response = await request(app).get(`/bank/versions/${id}/learner-preview`).auth(token('ADMIN'), { type: 'bearer' })
    expect(response.status).toBe(200); expect(response.body.preview.criteria).toHaveLength(1)
    expect(JSON.stringify(response.body)).not.toMatch(/rubric|misconceptions|rightsNotes|sourceAnswer|Independent state/)
  })
  it('rejects incomplete publication and stale edits, and invalidates review after edits', async () => {
    const id = await reviewed()
    await expect(editVersion(id, 1, readyDraft(), actor)).rejects.toMatchObject({ status: 409 })
    await editVersion(id, 2, { ...readyDraft(), rightsBasis: 'UNRECORDED' }, actor)
    expect((await detail(id)).version.status).toBe('DRAFT')
    await expect(transition(id, 3, 'review', actor)).rejects.toMatchObject({ status: 400 })
    await expect(transition(id, 3, 'publish', actor)).rejects.toMatchObject({ status: 409 })
  })
  it('serializes competing edits and fork version allocation', async () => {
    const id = await createReady()
    const edits = await Promise.allSettled([editVersion(id, 1, readyDraft(), actor), editVersion(id, 1, readyDraft(), actor)])
    expect(edits.filter(e => e.status === 'fulfilled')).toHaveLength(1)
    const versions = await Promise.all([forkVersion(id, actor), forkVersion(id, actor)])
    expect((await Promise.all(versions.map(detail))).map(d => d.version.version).sort()).toEqual([2, 3])
  })
  it('keeps published content and rubrics immutable and atomically replaces publication', async () => {
    const id = await reviewed(); await transition(id, 2, 'publish', actor)
    await expect(editVersion(id, 3, readyDraft(), actor)).rejects.toMatchObject({ status: 409 })
    await expect(db.questionBankVersion.update({ where: { id }, data: { questionText: 'Mutated published content?' } })).rejects.toThrow('immutable')
    await expect(db.questionEvaluatorSpec.update({ where: { versionId: id }, data: { rubric: {} } })).rejects.toThrow('immutable')
    await expect(db.questionBankVersion.delete({ where: { id } })).rejects.toThrow('cannot be deleted')
    const next = await forkVersion(id, actor); await transition(next, 1, 'review', actor); await transition(next, 2, 'publish', actor)
    const before = await detail(id); const after = await detail(next)
    expect(before.version.status).toBe('RETIRED'); expect(after.version.question.publishedVersionId).toBe(next)
    expect(before.draft).toEqual(after.draft)
    await transition(next, 3, 'retire', actor); expect((await detail(next)).version.question.publishedVersionId).toBeNull()
  })
  it('rejects wrong-question and draft publication pointers at transaction commit', async () => {
    const first = await createReady(); const second = await reviewed(); await transition(second, 2, 'publish', actor)
    const questionId = (await detail(first)).version.questionId
    await expect(db.questionBankItem.update({ where: { id: questionId }, data: { publishedVersionId: first } })).rejects.toThrow('publication pointer')
    await expect(db.$transaction(async tx => {
      await tx.questionBankItem.update({ where: { id: (await detail(second)).version.questionId }, data: { publishedVersionId: null } })
      await tx.questionBankItem.update({ where: { id: questionId }, data: { publishedVersionId: second } })
    })).rejects.toThrow('publication pointer')
  })
  it('imports once across retries/concurrent confirmations and stores no uploaded file', async () => {
    const options = importOptionsSchema.parse({ namespace: `${namespace}_csv`, mode: 'ADD_ONLY', mapping: { externalQid: 'QID', questionText: 'Question', sourceAnswer: 'Answer' } })
    const file = Buffer.from('QID,Question,Answer\nAUTO-1,How do fixtures work?,Private source\nAUTO-2,Why isolate tests?,\nBAD ID,What is CI?,Source')
    const ids = await Promise.all([previewImport(file, options, actor), previewImport(file, options, actor)])
    expect(ids[0]).toBe(ids[1]); const id = ids[0]
    await Promise.all([confirmImport(id, actor), confirmImport(id, actor)]); await confirmImport(id, actor)
    expect(await db.questionBankItem.count({ where: { namespace: options.namespace } })).toBe(2)
    const batch = await db.questionImportBatch.findUniqueOrThrow({ where: { id }, include: { rows: true } })
    expect(batch.status).toBe('CONFIRMED'); expect(batch.rows.filter(r => r.status === 'ERROR')).toHaveLength(1)
    expect(Object.keys(batch)).not.toContain('file'); expect(batch.fileHash).toHaveLength(64)
    const imported = await db.questionBankVersion.findFirstOrThrow({ where: { question: { namespace: options.namespace } }, include: { evaluatorSpec: true } })
    expect(imported).toMatchObject({ status: 'DRAFT', exampleAnswer: '', rightsBasis: 'UNRECORDED', evaluatorSpec: null })
    const update = { ...options, mode: 'UPDATE_BY_QID' as const }
    await confirmImport(await previewImport(file, update, actor), actor)
    expect(await db.questionBankVersion.count({ where: { question: { namespace: options.namespace } } })).toBe(2)
    const changed = await previewImport(Buffer.from(file.toString().replace('How do fixtures work?', 'How should fixtures work?')), update, actor)
    await confirmImport(changed, actor)
    expect(await db.questionBankVersion.count({ where: { question: { namespace: options.namespace } } })).toBe(3)
  })
  it('checks file type/size, report escaping and strict request fields through the API', async () => {
    const auth = token('ADMIN')
    expect((await request(app).post('/bank/imports/inspect').auth(auth, { type: 'bearer' }).attach('file', Buffer.from('PKbinary'), 'bank.xlsx')).status).toBe(400)
    expect((await request(app).post('/bank/questions').auth(auth, { type: 'bearer' }).send({ identity: { namespace, externalQid: 'bad' }, draft: { ...readyDraft(), surprise: 'ignored?' } })).status).toBe(400)
    const template = await request(app).get('/bank/imports/template').auth(auth, { type: 'bearer' })
    expect(template.status).toBe(200); expect(template.text).toContain('Automation Testing')
    const upload = await request(app).post('/bank/imports/preview').auth(auth, { type: 'bearer' })
      .attach('file', Buffer.from('QID,Question\nAPI-1,How do tests work?'), 'bank.csv')
      .field('options', JSON.stringify({ namespace, mode: 'ADD_ONLY', mapping: { externalQid: 'QID', questionText: 'Question' } }))
    expect(upload.status).toBe(200); expect(upload.body.id).toBeTruthy()
  })
  it('retains shared published material when the author account is deleted', async () => {
    const author = await db.user.create({ data: { email: `${namespace}_delete@example.invalid`, role: 'SUPER_ADMIN' } })
    const id = await createQuestion({ namespace, externalQid: 'DELETE-AUTHOR' }, readyDraft(), author.id)
    await transition(id, 1, 'review', author.id); await transition(id, 2, 'publish', author.id)
    await db.user.delete({ where: { id: author.id } })
    expect((await detail(id)).version).toMatchObject({ status: 'PUBLISHED', createdById: null, reviewedById: null, publishedById: null })
    expect(await db.adminAction.count({ where: { adminId: author.id } })).toBe(3)
  })
})
