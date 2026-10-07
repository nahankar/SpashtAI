import { createHash } from 'crypto'
import { Prisma, type QuestionBankQuestion } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { BankError, parseCsv } from './csv'
import { importFingerprint, normalizeRows, type ImportOptions } from './import'
import { activationBlockers, bankActionSchema, bulkSchema, draftSchema, type BankDraft } from './schemas'
type Tx = Prisma.TransactionClient
export function draftFromQuestion(question: QuestionBankQuestion): BankDraft {
  return draftSchema.parse(Object.fromEntries(Object.keys(draftSchema.shape).map(key => [key, question[key as keyof QuestionBankQuestion]])))
}
export async function bankAudit(tx: Tx, adminId: string, action: string, metadata: Prisma.InputJsonObject) {
  await tx.adminAction.create({ data: { adminId, action: `interview_bank.${action}`, metadata } })
}
export async function lockIdentity(tx: Tx, namespace: string, qid: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([namespace, qid])}, 0))`
}
async function lockQuestion(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "QuestionBankQuestion" WHERE id = ${id} FOR UPDATE`
  if (!rows.length) throw new BankError(404, 'Question not found')
}
export async function createQuestion(identity: { namespace: string; externalQid: string }, draft: BankDraft, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockIdentity(tx, identity.namespace, identity.externalQid)
    if (await tx.questionBankQuestion.findUnique({ where: { namespace_externalQid: identity } })) throw new BankError(409, 'This namespace and QID already exist')
    const question = await tx.questionBankQuestion.create({ data: { ...identity, ...draft, createdById: actorId } })
    await bankAudit(tx, actorId, 'create', { questionId: question.id }); return question.id
  })
}
export async function detail(id: string) {
  const question = await prisma.questionBankQuestion.findUnique({ where: { id } })
  if (!question) throw new BankError(404, 'Question not found')
  const draft = draftFromQuestion(question)
  return { question, draft, blockers: activationBlockers(draft) }
}
export async function editQuestion(id: string, revision: number, draft: BankDraft, actorId: string) {
  await prisma.$transaction(async tx => {
    await lockQuestion(tx, id)
    const question = await tx.questionBankQuestion.findUniqueOrThrow({ where: { id } })
    if (question.revision !== revision) throw new BankError(409, 'This question changed. Reload before saving.')
    await tx.questionBankQuestion.update({ where: { id }, data: { ...draft, approved: false, active: false, approvedAt: null, approvedById: null, importHash: null, revision: { increment: 1 } } })
    await bankAudit(tx, actorId, 'edit', { questionId: id })
  })
}
export async function bulkAction(input: unknown, actorId: string) {
  const body = bulkSchema.parse(input)
  return prisma.$transaction(async tx => {
    const questions: QuestionBankQuestion[] = []
    // Stable lock order prevents deadlocks for overlapping bulk selections.
    for (const selected of [...body.questions].sort((a,b) => a.id.localeCompare(b.id))) {
      await lockQuestion(tx, selected.id)
      const question = await tx.questionBankQuestion.findUniqueOrThrow({ where: { id: selected.id } })
      if (question.revision !== selected.revision) throw new BankError(409, `${question.externalQid} changed. Reload before proceeding.`)
      if (['activate','approve_activate'].includes(body.action)) {
        if (body.action === 'activate' && !question.approved) throw new BankError(400, `${question.externalQid}: approve before activating`)
        const blockers = activationBlockers(draftFromQuestion(question))
        if (blockers.length) throw new BankError(400, `${question.externalQid}: ${blockers.join('; ')}`)
      }
      questions.push(question)
    }
    for (const question of questions) {
      if (body.action === 'delete') await tx.questionBankQuestion.delete({ where: { id: question.id } })
      else await tx.questionBankQuestion.update({ where: { id: question.id }, data: {
        ...(body.action === 'approve' || body.action === 'approve_activate' ? { approved: true, approvedAt: new Date(), approvedById: actorId } : {}),
        ...(body.action === 'activate' || body.action === 'approve_activate' ? { active: true } : {}),
        ...(body.action === 'deactivate' ? { active: false } : {}), revision: { increment: 1 },
      } })
    }
    await bankAudit(tx, actorId, body.action, { questionIds: questions.map(q => q.id) })
    return { changed: questions.length }
  }, { timeout: 30000 })
}
export async function questionAction(id: string, revision: number, action: unknown, actorId: string) {
  return bulkAction({ action: bankActionSchema.parse(action), questions: [{ id, revision }] }, actorId)
}
export async function previewImport(buffer: Buffer, options: ImportOptions, actorId: string) {
  const parsed = parseCsv(buffer); const rows = normalizeRows(parsed.headers, parsed.rows, options)
  const known = await prisma.questionBankQuestion.findMany({ where: { namespace: options.namespace,
    externalQid: { in: rows.filter(r => r.status === 'READY').map(r => r.normalized.externalQid) } }, select: { externalQid: true, revision: true } })
  const fingerprint = createHash('sha256').update(importFingerprint(parsed.fileHash, options) + JSON.stringify([...known].sort((a,b) => a.externalQid.localeCompare(b.externalQid)))).digest('hex')
  const existing = await prisma.questionImportBatch.findUnique({ where: { fingerprint } })
  if (existing) return existing.id
  const byId = new Map(known.map(q => [q.externalQid,q]))
  for (const row of rows) {
    row.normalized.expectedRevision = byId.get(row.normalized.externalQid)?.revision ?? null
    if (byId.has(row.normalized.externalQid)) row.warnings.push(options.mode === 'ADD_ONLY' ? 'Existing QID will be skipped' : 'Mapped fields overwrite this question; omitted columns are preserved. Changed content becomes unapproved and inactive.')
  }
  try {
    return await prisma.$transaction(async tx => {
      const batch = await tx.questionImportBatch.create({ data: { fingerprint, fileHash: parsed.fileHash, namespace: options.namespace, mode: options.mode, mapping: options.mapping, importedById: actorId } })
      await tx.questionImportRow.createMany({ data: rows.map(row => ({ ...row, batchId: batch.id, raw: row.raw as Prisma.InputJsonValue, normalized: row.normalized as Prisma.InputJsonValue })) })
      await bankAudit(tx, actorId, 'import_preview', { batchId: batch.id, rowCount: rows.length }); return batch.id
    }, { timeout: 30000 })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retry = await prisma.questionImportBatch.findUnique({ where: { fingerprint } }); if (retry) return retry.id
    }
    throw error
  }
}
export async function confirmImport(batchId: string, actorId: string) {
  const batch = await prisma.questionImportBatch.findUnique({ where: { id: batchId } })
  if (!batch) throw new BankError(404, 'Import not found')
  if (batch.status === 'SUPERSEDED') throw new BankError(409, 'Upload and preview this CSV again')
  const rows = await prisma.questionImportRow.findMany({ where: { batchId, status: 'READY' }, orderBy: { rowNumber: 'asc' }, take: 100 })
  for (const row of rows) await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "QuestionImportRow" WHERE id=${row.id} FOR UPDATE`
    const fresh = await tx.questionImportRow.findUniqueOrThrow({ where: { id: row.id } }); if (fresh.status !== 'READY') return
    const input = fresh.normalized as unknown as { externalQid: string; draft: Partial<BankDraft>; sources: { sourceAnswer?: string | null; sourceFile?: string | null; sourceSheet?: string | null }; sourceQuestionText: string; expectedRevision: number | null }
    await lockIdentity(tx, batch.namespace, input.externalQid)
    let question = await tx.questionBankQuestion.findUnique({ where: { namespace_externalQid: { namespace: batch.namespace, externalQid: input.externalQid } } })
    if (question) { await lockQuestion(tx, question.id); question = await tx.questionBankQuestion.findUniqueOrThrow({ where: { id: question.id } }) }
    const hash = createHash('sha256').update(JSON.stringify({ draft: input.draft, sources: input.sources })).digest('hex')
    let outcome: string; let resultQuestionId: string | null = null
    if (question && batch.mode === 'ADD_ONLY') outcome = 'Existing QID skipped'
    else if (question?.importHash === hash) outcome = 'Unchanged row skipped'
    else if ((question?.revision ?? null) !== input.expectedRevision) {
      await tx.questionImportRow.update({ where: { id: fresh.id }, data: { status: 'ERROR', errors: ['Question changed since preview; upload and preview again'] } }); return
    } else {
      const draft = draftSchema.parse({ ...(question ? draftFromQuestion(question) : {}), ...input.draft })
      const content = { ...draft, ...input.sources, sourceQuestionText: input.sourceQuestionText, importHash: hash }
      if (question && Object.entries({ ...draft, ...input.sources }).every(([key,value]) => JSON.stringify(question![key as keyof QuestionBankQuestion]) === JSON.stringify(value))) {
        outcome = 'Unchanged content skipped'
      } else if (question) {
        await tx.questionBankQuestion.update({ where: { id: question.id }, data: { ...content, approved: false, active: false, approvedAt: null, approvedById: null, revision: { increment: 1 } } })
        resultQuestionId = question.id; outcome = 'Question updated'
      } else {
        const created = await tx.questionBankQuestion.create({ data: { ...content, namespace: batch.namespace, externalQid: input.externalQid, createdById: actorId, origin: 'IMPORT' } })
        resultQuestionId = created.id; outcome = 'Question created'
      }
    }
    await tx.questionImportRow.update({ where: { id: fresh.id }, data: { status: resultQuestionId ? 'APPLIED' : 'SKIPPED', outcome, resultQuestionId } })
  })
  const remaining = await prisma.questionImportRow.count({ where: { batchId, status: 'READY' } })
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "QuestionImportBatch" WHERE id=${batchId} FOR UPDATE`
    const current = await tx.questionImportBatch.findUniqueOrThrow({ where: { id: batchId } })
    if (current.status !== 'CONFIRMED') {
      await tx.questionImportBatch.update({ where: { id: batchId }, data: { status: remaining ? 'IMPORTING' : 'CONFIRMED', ...(!remaining ? { confirmedAt: new Date() } : {}) } })
      await bankAudit(tx, actorId, remaining ? 'import_progress' : 'import_confirmed', { batchId, remaining })
    }
  })
  return { remaining }
}
