import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { reqLog } from '../../lib/logger'
import { requireAdmin } from '../../middleware/admin'
import { BankError } from '../../interviews/bank/csv'
import { assessmentDetail, deleteAssessment, enqueueAssessment, evaluatorConfig, retryAssessment } from '../../interviews/evaluator/service'
const router = Router()
router.use(requireAdmin)
const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next) }
router.use((req, res, next) => { void (async () => {
  // Role changes take effect without logging out/in. Fail closed on DB failure.
  const user = await prisma.user.findUnique({ where: { id: req.user!.userId }, select: { role: true } })
  if (!user || !['ADMIN','SUPER_ADMIN'].includes(user.role)) { res.status(403).json({ error: 'Current Admin access required' }); return }
  res.locals.currentRole = user.role
  next()
})().catch(next) })
router.get('/config', route(async (req, res) => { res.json(await evaluatorConfig(req.user!.userId)) }))
router.get('/tests', route(async (req, res) => {
  const query = z.object({ questionId: z.string().max(160).optional() }).strict().parse(req.query)
  const tests = await prisma.interviewAssessment.findMany({ where: { snapshot: { source: 'ADMIN_TEST', ownerId: req.user!.userId, ...(query.questionId ? { questionId: query.questionId } : {}) } },
    orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, status: true, attempts: true, errorCode: true, createdAt: true,
      snapshot: { select: { questionSnapshot: true, assistance: true } } } })
  res.json({ tests })
}))
router.post('/tests', route(async (req, res) => { res.status(202).json(await enqueueAssessment(req.body, req.user!.userId)) }))
router.get('/tests/:id', route(async (req, res) => { res.json(await assessmentDetail(req.params.id, req.user!.userId)) }))
router.post('/tests/:id/retry', route(async (req, res) => { z.object({}).strict().parse(req.body); await retryAssessment(req.params.id, req.user!.userId); res.status(202).json({ id: req.params.id }) }))
router.delete('/tests/:id', route(async (req, res) => { await deleteAssessment(req.params.id, req.user!.userId); res.json({ deleted: true }) }))
router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof BankError) { res.status(error.status).json({ error: error.message }); return }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid evaluator request', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`) }); return }
  reqLog(req).error({ event: 'interview_evaluator.request_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Interview evaluator request failed')
  res.status(500).json({ error: 'Evaluator request failed. Try again.' })
})
export default router
