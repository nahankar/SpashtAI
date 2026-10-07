import { createHash } from 'crypto'
import { Prisma, type QuestionBankVersion } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { BankError, parseCsv } from './csv'
import { importFingerprint, normalizeRows, type ImportOptions } from './import'
import { draftSchema, publicationBlockers, type BankDraft } from './schemas'

type Tx = Prisma.TransactionClient
const withSpec = { evaluatorSpec: true, question: true } as const
export function draftFromVersion(version: QuestionBankVersion & { evaluatorSpec?: { rubric: unknown } | null }): BankDraft {
  return draftSchema.parse(Object.fromEntries(Object.keys(draftSchema.shape).map(key => [key,
    key === 'rubric' ? version.evaluatorSpec?.rubric ?? null : version[key as keyof QuestionBankVersion],
  ])))
}
function draftData(draft: BankDraft) {
  const { rubric: _rubric, publicCriteria, ...fields } = draft
  return { ...fields, publicCriteria: publicCriteria as Prisma.InputJsonValue }
}
async function audit(tx: Tx, adminId: string, action: string, metadata: Prisma.InputJsonObject) {
  await tx.adminAction.create({ data: { adminId, action: `interview_bank.${action}`, metadata } })
}
async function lockIdentity(tx: Tx, namespace: string, qid: string) {
  // Project an integer: Prisma cannot deserialize PostgreSQL's void lock result.
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${JSON.stringify([namespace, qid])}, 0))`
}
async function lockQuestion(tx: Tx, id: string) {
  const found = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "QuestionBankItem" WHERE id = ${id} FOR UPDATE`
  if (!found.length) throw new BankError(404, 'Question not found')
}
async function writeSpec(tx: Tx, versionId: string, draft: BankDraft) {
  if (draft.rubric) await tx.questionEvaluatorSpec.upsert({ where: { versionId },
    create: { versionId, rubric: draft.rubric as Prisma.InputJsonValue }, update: { rubric: draft.rubric as Prisma.InputJsonValue } })
  else await tx.questionEvaluatorSpec.deleteMany({ where: { versionId } })
}
export async function createQuestion(identity: { namespace: string; externalQid: string }, draft: BankDraft, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockIdentity(tx, identity.namespace, identity.externalQid)
    if (await tx.questionBankItem.findUnique({ where: { namespace_externalQid: identity } })) throw new BankError(409, 'This namespace and QID already exist')
    const item = await tx.questionBankItem.create({ data: identity })
    const version = await tx.questionBankVersion.create({ data: { questionId: item.id, version: 1, ...draftData(draft), createdById: actorId } })
    await writeSpec(tx, version.id, draft); await audit(tx, actorId, 'create', { questionId: item.id, versionId: version.id })
    return version.id
  })
}
export async function detail(versionId: string) {
  const version = await prisma.questionBankVersion.findUnique({ where: { id: versionId }, include: withSpec })
  if (!version) throw new BankError(404, 'Question version not found')
  const draft = draftFromVersion(version)
  return { version, draft, blockers: publicationBlockers(draft, version) }
}
export async function editVersion(id: string, revision: number, draft: BankDraft, actorId: string) {
  const { version: initial } = await detail(id)
  await prisma.$transaction(async tx => {
    await lockQuestion(tx, initial.questionId)
    const version = await tx.questionBankVersion.findUniqueOrThrow({ where: { id } })
    if (version.revision !== revision) throw new BankError(409, 'This draft changed. Reload before saving.')
    if (!['DRAFT', 'REVIEWED'].includes(version.status)) throw new BankError(409, 'Create a new draft version to change published content')
    await tx.questionBankVersion.update({ where: { id }, data: { ...draftData(draft), status: 'DRAFT', revision: { increment: 1 }, reviewedAt: null, reviewedById: null } })
    await writeSpec(tx, id, draft); await audit(tx, actorId, 'edit', { versionId: id, previousRevision: revision })
  })
}
export async function forkVersion(id: string, actorId: string) {
  const { version: initial } = await detail(id)
  return prisma.$transaction(async tx => {
    await lockQuestion(tx, initial.questionId)
    const source = await tx.questionBankVersion.findUniqueOrThrow({ where: { id }, include: withSpec })
    const last = await tx.questionBankVersion.findFirstOrThrow({ where: { questionId: source.questionId }, orderBy: { version: 'desc' } })
    const draft = draftFromVersion(source)
    const version = await tx.questionBankVersion.create({ data: { ...draftData(draft), questionId: source.questionId, version: last.version + 1, createdById: actorId,
      importHash: source.importHash, sourceQuestionText: source.sourceQuestionText, sourceAnswer: source.sourceAnswer, sourceFile: source.sourceFile, sourceSheet: source.sourceSheet } })
    await writeSpec(tx, version.id, draft); await audit(tx, actorId, 'fork', { sourceVersionId: id, versionId: version.id })
    return version.id
  })
}
export async function transition(id: string, revision: number, action: 'review' | 'publish' | 'retire', actorId: string) {
  const { version: initial } = await detail(id)
  await prisma.$transaction(async tx => {
    await lockQuestion(tx, initial.questionId)
    const version = await tx.questionBankVersion.findUniqueOrThrow({ where: { id }, include: withSpec })
    if (version.revision !== revision) throw new BankError(409, 'This version changed. Reload before proceeding.')
    const now = new Date()
    if (action === 'retire') {
      if (version.status !== 'PUBLISHED') throw new BankError(409, 'Only published versions can be retired')
      // Retirement changes lifecycle metadata only; immutable content/revision stays intact.
      await tx.questionBankItem.updateMany({ where: { id: version.questionId, publishedVersionId: id }, data: { publishedVersionId: null } })
      await tx.questionBankVersion.update({ where: { id }, data: { status: 'RETIRED', retiredAt: now } })
    } else {
      if (version.status !== (action === 'publish' ? 'REVIEWED' : 'DRAFT')) throw new BankError(409, action === 'publish' ? 'Review this draft before publishing' : 'Only drafts can be reviewed')
      const blockers = publicationBlockers(draftFromVersion(version), version)
      if (blockers.length) throw new BankError(400, blockers.join('; '))
      if (action === 'review') await tx.questionBankVersion.update({ where: { id }, data: { status: 'REVIEWED', reviewedAt: now, reviewedById: actorId, revision: { increment: 1 } } })
      else {
        const item = await tx.questionBankItem.findUniqueOrThrow({ where: { id: version.questionId } })
        if (item.publishedVersionId) await tx.questionBankVersion.update({ where: { id: item.publishedVersionId }, data: { status: 'RETIRED', retiredAt: now } })
        await tx.questionBankVersion.update({ where: { id }, data: { status: 'PUBLISHED', publishedAt: now, publishedById: actorId, revision: { increment: 1 } } })
        await tx.questionBankItem.update({ where: { id: version.questionId }, data: { publishedVersionId: id } })
      }
    }
    await audit(tx, actorId, action, { versionId: id, questionId: version.questionId })
  })
}
export async function previewImport(buffer: Buffer, options: ImportOptions, actorId: string) {
  const parsed = parseCsv(buffer); const rows = normalizeRows(parsed.headers, parsed.rows, options)
  const fingerprint = importFingerprint(parsed.fileHash, options)
  const existing = await prisma.questionImportBatch.findUnique({ where: { fingerprint } })
  if (existing) return existing.id
  const identities = await prisma.questionBankItem.findMany({ where: { namespace: options.namespace,
    externalQid: { in: rows.filter(r => r.status === 'READY').map(r => r.normalized.externalQid) } }, select: { externalQid: true } })
  const knownIds = new Set(identities.map(i => i.externalQid))
  for (const row of rows) if (knownIds.has(row.normalized.externalQid)) row.warnings.push(options.mode === 'ADD_ONLY'
    ? 'Existing QID will be skipped in add-only mode' : 'Existing QID: changed source content creates a new draft version')
  try {
    const batch = await prisma.$transaction(async tx => {
      const created = await tx.questionImportBatch.create({ data: { fingerprint, fileHash: parsed.fileHash, namespace: options.namespace, mode: options.mode,
        mapping: options.mapping, importedById: actorId } })
      await tx.questionImportRow.createMany({ data: rows.map(row => ({ ...row, batchId: created.id, raw: row.raw as Prisma.InputJsonValue, normalized: row.normalized as Prisma.InputJsonValue })) })
      await audit(tx, actorId, 'import_preview', { batchId: created.id, fileHash: parsed.fileHash, rowCount: rows.length })
      return created
    }, { timeout: 30000 })
    return batch.id
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const retry = await prisma.questionImportBatch.findUnique({ where: { fingerprint } })
      if (retry) return retry.id
    }
    throw error
  }
}
export async function confirmImport(batchId: string, actorId: string) {
  const batch = await prisma.questionImportBatch.findUnique({ where: { id: batchId } })
  if (!batch) throw new BankError(404, 'Import not found')
  const rows = await prisma.questionImportRow.findMany({ where: { batchId, status: 'READY' }, orderBy: { rowNumber: 'asc' }, take: 100 })
  for (const row of rows) {
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "QuestionImportRow" WHERE id = ${row.id} FOR UPDATE`
      const fresh = await tx.questionImportRow.findUniqueOrThrow({ where: { id: row.id } })
      if (fresh.status !== 'READY') return
      const input = fresh.normalized as unknown as { externalQid: string; draft: BankDraft; sourceQuestionText: string; sourceAnswer: string | null; sourceFile: string | null; sourceSheet: string | null }
      const draft = draftSchema.parse(input.draft)
      await lockIdentity(tx, batch.namespace, input.externalQid)
      let item = await tx.questionBankItem.findUnique({ where: { namespace_externalQid: { namespace: batch.namespace, externalQid: input.externalQid } } })
      const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex')
      let outcome: string; let resultVersionId: string | null = null
      if (item && batch.mode === 'ADD_ONLY') outcome = 'Existing QID skipped (add only)'
      else {
        if (!item) item = await tx.questionBankItem.create({ data: { namespace: batch.namespace, externalQid: input.externalQid } })
        await lockQuestion(tx, item.id)
        const last = await tx.questionBankVersion.findFirst({ where: { questionId: item.id }, orderBy: { version: 'desc' } })
        if (last?.importHash === hash) outcome = 'Unchanged source row skipped'
        else {
          const created = await tx.questionBankVersion.create({ data: { ...draftData(draft), questionId: item.id, version: (last?.version ?? 0) + 1,
            createdById: actorId, importHash: hash, sourceQuestionText: input.sourceQuestionText, sourceAnswer: input.sourceAnswer, sourceFile: input.sourceFile, sourceSheet: input.sourceSheet } })
          resultVersionId = created.id; outcome = last ? 'New draft version created' : 'Draft created'
        }
      }
      await tx.questionImportRow.update({ where: { id: fresh.id }, data: { status: resultVersionId ? 'APPLIED' : 'SKIPPED', outcome, resultVersionId } })
    })
  }
  const remaining = await prisma.questionImportRow.count({ where: { batchId, status: 'READY' } })
  // Concurrent confirmations lock the batch only for final state/audit updates.
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "QuestionImportBatch" WHERE id = ${batchId} FOR UPDATE`
    const current = await tx.questionImportBatch.findUniqueOrThrow({ where: { id: batchId } })
    if (current.status !== 'CONFIRMED') {
      await tx.questionImportBatch.update({ where: { id: batchId }, data: { status: remaining ? 'IMPORTING' : 'CONFIRMED', ...(!remaining ? { confirmedAt: new Date() } : {}) } })
      await audit(tx, actorId, remaining ? 'import_progress' : 'import_confirmed', { batchId, processed: rows.length, remaining })
    }
  })
  return { remaining }
}
