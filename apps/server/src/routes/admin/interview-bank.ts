import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { requireAdmin } from '../../middleware/admin'
import { reqLog } from '../../lib/logger'
import { BankError, CSV_LIMITS, csvCell, parseCsv } from '../../interviews/bank/csv'
import { DEFAULT_COLUMNS, IMPORT_FIELDS, importOptionsSchema } from '../../interviews/bank/import'
import { draftSchema, editSchema, identitySchema, revisionSchema } from '../../interviews/bank/schemas'
import { learnerPreview } from '../../interviews/bank/views'
import { confirmImport, confirmProvenance, createQuestion, detail, editQuestion, previewImport, bulkAction, questionAction } from '../../interviews/bank/service'

const router = Router()
router.use(requireAdmin)
router.use((req, res, next) => {
  void prisma.user.findUnique({ where: { id: req.user!.userId }, select: { role: true } }).then(user => {
    if (user?.role !== 'ADMIN' && user?.role !== 'SUPER_ADMIN') { res.status(403).json({ error: 'Current Admin access required' }); return }
    res.locals.bankRole = user.role
    next()
  }).catch(next)
})
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CSV_LIMITS.bytes, files: 1, fields: 1, fieldSize: 16000, parts: 3 },
  fileFilter: (_req, file, done) => done(null, file.originalname.toLowerCase().endsWith('.csv')) })
function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next) }
}
function csvUpload(req: Request) { if (!req.file) throw new BankError(400, 'Choose a UTF-8 .csv file'); return req.file.buffer }
async function editorDetail(id: string, res: Response) { return { ...await detail(id), canActivate: res.locals.bankRole === 'SUPER_ADMIN' } }
const pageSchema = z.coerce.number().int().min(1).max(10000).default(1)
const listFiltersSchema = z.object({
  search: z.string().max(160).optional(), track: z.string().max(160).optional(),
  category: z.string().max(160).optional(), difficulty: draftSchema.shape.difficulty.optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'ACTIVE', 'INACTIVE']).optional(),
}).strict()
function listWhere(query: Request['query']) {
  const { search, track, category, difficulty, status } = listFiltersSchema.parse({
    search: query.search, track: query.track, category: query.category, difficulty: query.difficulty, status: query.status,
  })
  const where = { ...(track ? { track } : {}), ...(category ? { category } : {}), ...(difficulty ? { difficulty } : {}),
    ...(status === 'DRAFT' ? { approved: false } : status === 'APPROVED' ? { approved: true, active: false } : status === 'ACTIVE' ? { active: true } : status === 'INACTIVE' ? { active: false } : {}),
    ...(search ? { OR: [{ questionText: { contains: search, mode: 'insensitive' as const } }, { externalQid: { contains: search, mode: 'insensitive' as const } }] } : {}) }
  return where
}
router.get('/filters', asyncRoute(async (req, res) => {
  const track = listFiltersSchema.shape.track.parse(req.query.track)
  const [categories, tracks] = await Promise.all([
    prisma.questionBankQuestion.groupBy({ by: ['category'], where: track ? { track } : {}, orderBy: { category: 'asc' } }),
    prisma.questionBankQuestion.groupBy({ by: ['track'], orderBy: { track: 'asc' } }),
  ])
  res.json({ categories: categories.map(q => q.category).filter(Boolean), tracks: tracks.map(q => q.track).filter(Boolean) })
}))
router.get('/questions', asyncRoute(async (req, res) => {
  const page = pageSchema.parse(req.query.page)
  const where = listWhere(req.query)
  const [questions, total] = await Promise.all([
    prisma.questionBankQuestion.findMany({ where, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 30, take: 30,
      select: { id: true, revision: true, approved: true, active: true, questionText: true, track: true, category: true, difficulty: true, externalQid: true, namespace: true, origin: true, provenanceConfirmedAt: true } }),
    prisma.questionBankQuestion.count({ where }),
  ])
  res.json({ questions, total, page, canActivate: res.locals.bankRole === 'SUPER_ADMIN' })
}))
router.post('/questions/selection', asyncRoute(async (req, res) => {
  const filters = listFiltersSchema.parse(req.body)
  const where = listWhere(filters)
  const questions = await prisma.questionBankQuestion.findMany({ where, orderBy: { id: 'asc' }, take: 2001, select: { id: true, revision: true } })
  if (questions.length > 2000) throw new BankError(400, 'Narrow your filters to at most 2,000 questions for one bulk action')
  res.json({ questions })
}))
router.post('/questions/bulk', asyncRoute(async (req, res) => { res.json(await bulkAction(req.body, req.user!.userId)) }))
router.post('/questions/provenance', asyncRoute(async (req, res) => { res.json(await confirmProvenance(req.body, req.user!.userId)) }))
router.post('/questions', asyncRoute(async (req, res) => {
  const body = z.object({ identity: identitySchema, draft: draftSchema }).strict().parse(req.body)
  const id = await createQuestion(body.identity, body.draft, req.user!.userId)
  res.status(201).json(await editorDetail(id, res))
}))
router.get('/questions/:id', asyncRoute(async (req, res) => { res.json(await editorDetail(req.params.id, res)) }))
router.get('/questions/:id/learner-preview', asyncRoute(async (req, res) => {
  const data = await detail(req.params.id)
  res.json({ status: data.question.active ? 'ACTIVE' : data.question.approved ? 'APPROVED' : 'DRAFT', preview: learnerPreview(data.draft) })
}))
router.put('/questions/:id', asyncRoute(async (req, res) => {
  const body = editSchema.parse(req.body)
  await editQuestion(req.params.id, body.revision, body.draft, req.user!.userId)
  res.json(await editorDetail(req.params.id, res))
}))
router.delete('/questions/:id', asyncRoute(async (req, res) => {
  const body = revisionSchema.parse(req.body)
  res.json(await questionAction(req.params.id, body.revision, 'delete', req.user!.userId))
}))
router.post('/questions/:id/:action', asyncRoute(async (req, res) => {
  const { revision } = revisionSchema.parse(req.body)
  const action = z.enum(['approve', 'activate', 'deactivate', 'approve_activate']).parse(req.params.action)
  await questionAction(req.params.id, revision, action, req.user!.userId)
  res.json(await editorDetail(req.params.id, res))
}))
// The retained copy's old editor links remain usable after migration.
router.get('/versions/:id', asyncRoute(async (req, res) => { res.json(await editorDetail(req.params.id, res)) }))
router.post('/imports/inspect', upload.single('file'), asyncRoute(async (req, res) => {
  const data = parseCsv(csvUpload(req))
  res.json({ headers: data.headers, rowCount: data.rows.length, defaultColumns: DEFAULT_COLUMNS, fields: IMPORT_FIELDS })
}))
router.post('/imports/preview', upload.single('file'), asyncRoute(async (req, res) => {
  let options: unknown
  try { options = JSON.parse(req.body.options ?? '{}') } catch { throw new BankError(400, 'Invalid import options') }
  const id = await previewImport(csvUpload(req), importOptionsSchema.parse(options), req.user!.userId)
  res.json({ id })
}))
router.get('/imports', asyncRoute(async (_req, res) => {
  res.json({ batches: await prisma.questionImportBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 30 }) })
}))
router.get('/imports/template', (_req, res) => {
  res.type('text/csv').attachment('question-bank-template.csv').send(
    [Object.values(DEFAULT_COLUMNS), IMPORT_FIELDS.map(key => ({ externalQid: 'AUTO-001', track: 'Automation Testing', category: 'Testing', topic: 'Isolation', questionText: 'How do you keep automated tests independent?', difficulty: 'Medium', experienceBand: '2-5', frequency: 'Core', questionType: 'Technical', roleArchetype: 'IC', goodAnswerPoints: 'Independent state; isolated fixtures', verbalSuitable: 'TRUE', approved: 'FALSE', active: 'FALSE' } as Record<string,string>)[key] ?? '')]
      .map(row => row.map(csvCell).join(',')).join('\r\n'))
})
router.get('/imports/:id', asyncRoute(async (req, res) => {
  const page = pageSchema.parse(req.query.page)
  const batch = await prisma.questionImportBatch.findUnique({ where: { id: req.params.id } })
  if (!batch) throw new BankError(404, 'Import not found')
  const [rows, counts] = await Promise.all([
    prisma.questionImportRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: 'asc' }, skip: (page - 1) * 50, take: 50 }),
    prisma.questionImportRow.groupBy({ by: ['status'], where: { batchId: batch.id }, _count: true }),
  ])
  res.json({ batch, rows, counts: Object.fromEntries(counts.map(c => [c.status, c._count])), page })
}))
router.post('/imports/:id/confirm', asyncRoute(async (req, res) => {
  z.object({}).strict().parse(req.body)
  res.json(await confirmImport(req.params.id, req.user!.userId))
}))
router.get('/imports/:id/report', asyncRoute(async (req, res) => {
  const batch = await prisma.questionImportBatch.findUnique({ where: { id: req.params.id } })
  if (!batch) throw new BankError(404, 'Import not found')
  const rows = await prisma.questionImportRow.findMany({ where: { batchId: batch.id }, orderBy: { rowNumber: 'asc' } })
  const lines = [['Row', 'QID', 'Status', 'Outcome', 'Errors', 'Warnings'], ...rows.map(row => [String(row.rowNumber),
    String((row.normalized as { externalQid?: string })?.externalQid ?? ''), row.status, row.outcome ?? '', row.errors.join('; '), row.warnings.join('; ')])]
  res.type('text/csv').attachment(`question-import-${batch.id}.csv`).send(lines.map(row => row.map(csvCell).join(',')).join('\r\n'))
}))
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BankError) { res.status(error.status).json({ error: error.message }); return }
  if (error instanceof z.ZodError) { res.status(400).json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }); return }
  if (error instanceof multer.MulterError) { res.status(413).json({ error: 'CSV upload exceeds file or field limits' }); return }
  // No source content, file bytes or request bodies are written to application logs.
  reqLog(req).error({ event: 'interview_bank.failure', errorType: error instanceof Error ? error.name : 'unknown' }, 'Question bank request failed')
  res.status(500).json({ error: 'Question bank request failed. Reload and retry.' })
})
export default router
