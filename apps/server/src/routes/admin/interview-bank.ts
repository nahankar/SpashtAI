import { Router, type Request, type Response, type NextFunction } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { requireAdmin, requireSuperAdmin } from '../../middleware/admin'
import { reqLog } from '../../lib/logger'
import { BankError, CSV_LIMITS, csvCell, parseCsv } from '../../interviews/bank/csv'
import { DEFAULT_COLUMNS, IMPORT_FIELDS, importOptionsSchema } from '../../interviews/bank/import'
import { draftSchema, editSchema, identitySchema, revisionSchema } from '../../interviews/bank/schemas'
import { learnerPreview } from '../../interviews/bank/views'
import { confirmImport, createQuestion, detail, editVersion, forkVersion, previewImport, transition } from '../../interviews/bank/service'

const router = Router()
router.use(requireAdmin)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CSV_LIMITS.bytes, files: 1, fields: 1, fieldSize: 16000, parts: 3 },
  fileFilter: (_req, file, done) => done(null, file.originalname.toLowerCase().endsWith('.csv')) })
function asyncRoute(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next) }
}
function csvUpload(req: Request) { if (!req.file) throw new BankError(400, 'Choose a UTF-8 .csv file'); return req.file.buffer }
const pageSchema = z.coerce.number().int().min(1).max(10000).default(1)
router.get('/questions', asyncRoute(async (req, res) => {
  const page = pageSchema.parse(req.query.page)
  const search = z.string().max(160).default('').parse(req.query.search)
  const track = z.string().max(160).optional().parse(req.query.track)
  const status = z.enum(['DRAFT', 'REVIEWED', 'PUBLISHED', 'RETIRED']).optional().parse(req.query.status)
  const where = { ...(status ? { status } : {}), ...(track ? { track } : {}),
    ...(search ? { OR: [{ questionText: { contains: search, mode: 'insensitive' as const } }, { question: { externalQid: { contains: search, mode: 'insensitive' as const } } }] } : {}) }
  const [versions, total] = await Promise.all([
    prisma.questionBankVersion.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 30, take: 30,
      select: { id: true, version: true, status: true, questionText: true, track: true, difficulty: true, question: { select: { externalQid: true, namespace: true } } } }),
    prisma.questionBankVersion.count({ where }),
  ])
  res.json({ versions, total, page })
}))
router.post('/questions', asyncRoute(async (req, res) => {
  const body = z.object({ identity: identitySchema, draft: draftSchema }).strict().parse(req.body)
  const id = await createQuestion(body.identity, body.draft, req.user!.userId)
  res.status(201).json(await detail(id))
}))
router.get('/versions/:id', asyncRoute(async (req, res) => { res.json(await detail(req.params.id)) }))
router.get('/versions/:id/learner-preview', asyncRoute(async (req, res) => {
  const data = await detail(req.params.id)
  res.json({ status: data.version.status, preview: learnerPreview(data.draft) })
}))
router.put('/versions/:id', asyncRoute(async (req, res) => {
  const body = editSchema.parse(req.body)
  await editVersion(req.params.id, body.revision, body.draft, req.user!.userId)
  res.json(await detail(req.params.id))
}))
router.post('/versions/:id/fork', asyncRoute(async (req, res) => {
  z.object({}).strict().parse(req.body)
  const id = await forkVersion(req.params.id, req.user!.userId)
  res.status(201).json(await detail(id))
}))
for (const action of ['review', 'publish', 'retire'] as const) {
  router.post(`/versions/:id/${action}`, ...(action === 'review' ? [] : [requireSuperAdmin]), asyncRoute(async (req, res) => {
    const { revision } = revisionSchema.parse(req.body)
    await transition(req.params.id, revision, action, req.user!.userId)
    res.json(await detail(req.params.id))
  }))
}
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
    [Object.values(DEFAULT_COLUMNS), ['AUTO-001', 'Automation Testing', 'Testing', 'Isolation', 'How do you keep automated tests independent?', '', 'Medium', '2-5', 'Core', 'Technical', 'QA Engineer', 'isolation,fixtures', '', '', '']]
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
