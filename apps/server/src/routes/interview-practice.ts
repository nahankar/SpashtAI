import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { isValidInternalAgentRequest, requireAuth } from '../middleware/auth'
import { BankError } from '../interviews/bank/csv'
import { SessionDiscardedError, SessionMissingError } from '../lib/sessionDiscard'
import { reqLog } from '../lib/logger'
import { prisma } from '../lib/prisma'
import { deleteSession } from './sessions'
import { recordFeatureUsage } from '../middleware/tracking'
import { captureCommittedTurn, endPractice, finishAnswer, markQuestionAsked, ownedCaptureReceipt, practiceDetail, practiceHistory, practiceOptions, prepareBankAttempt, recordAssistance, saveCaptureReceipt, startPractice, voiceState } from '../interviews/practice/service'

const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next) }
const empty = z.object({}).strict()
const finish = z.object({ skip: z.boolean().default(false), receiptId: z.string().uuid() }).strict()
function errors(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof BankError || error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
    res.status(error.status).json({ error: error.message }); return
  }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid interview practice request' }); return }
  reqLog(req).error({ event: 'interviews.capture_request_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Interview capture request failed')
  res.status(500).json({ error: 'Interview request failed. Try again.' })
}

// Execution requires both Interviews and the separately default-off voice pilot.
export const practiceRouter = Router()
practiceRouter.use(requireAuth)
practiceRouter.get('/options', route(async (req, res) => { res.json(await practiceOptions(req.user!.userId)) }))
practiceRouter.get('/runs', route(async (req, res) => { res.json(await practiceHistory(req.user!.userId)) }))
practiceRouter.post('/runs', route(async (req, res) => {
  const run = await startPractice(req.body, req.user!.userId)
  if (!run.reused) recordFeatureUsage(req, 'interviews', 'practice_start', run.sessionId)
  res.status(201).json(run)
}))
practiceRouter.get('/runs/:runId', route(async (req, res) => { res.json(await practiceDetail(req.params.runId, req.user!.userId)) }))
practiceRouter.post('/runs/:runId/next', route(async (req, res) => { empty.parse(req.body); res.json(await prepareBankAttempt(req.params.runId, req.user!.userId)) }))
practiceRouter.post('/runs/:runId/attempts/:attemptId/finish', route(async (req, res) => {
  const body = finish.parse(req.body)
  res.json(await finishAnswer(req.params.runId, req.params.attemptId, req.user!.userId, body.skip, body.receiptId))
}))
practiceRouter.post('/runs/:runId/end', route(async (req, res) => { empty.parse(req.body); res.json(await endPractice(req.params.runId, req.user!.userId)) }))
practiceRouter.get('/runs/:runId/receipts/:receiptId', route(async (req, res) => { res.json(await ownedCaptureReceipt(req.params.runId, req.params.receiptId, req.user!.userId)) }))
practiceRouter.delete('/runs/:runId', route(async (req, res) => {
  const run = await prisma.interviewRun.findFirst({ where: { id: req.params.runId, ownerId: req.user!.userId }, select: { sessionId: true } })
  if (!run) throw new BankError(404, 'Interview not found')
  req.params.id=run.sessionId
  await deleteSession(req, res)
}))
practiceRouter.use(errors)

export const practiceAgentRouter = Router()
practiceAgentRouter.use((req, res, next) => {
  if (!isValidInternalAgentRequest(req)) { res.status(401).json({ error: 'Internal agent authentication required' }); return }
  next()
})
practiceAgentRouter.post('/attempts/:attemptId/asked', route(async (req, res) => { res.json(await markQuestionAsked(req.params.attemptId, req.body)) }))
practiceAgentRouter.post('/attempts/:attemptId/chunks', route(async (req, res) => { res.json(await captureCommittedTurn(req.params.attemptId, req.body)) }))
practiceAgentRouter.post('/attempts/:attemptId/assistance', route(async (req, res) => { await recordAssistance(req.params.attemptId, req.body); res.json({ saved: true }) }))
practiceAgentRouter.post('/attempts/:attemptId/receipts', route(async (req, res) => { res.json(await saveCaptureReceipt(req.params.attemptId, req.body)) }))
practiceAgentRouter.get('/sessions/:sessionId/segments/:segmentId', route(async (req, res) => {
  const query = z.object({ room: z.string().min(1).max(256), identity: z.string().min(1).max(160) }).strict().parse(req.query)
  res.json(await voiceState(req.params.sessionId, req.params.segmentId, query.room, query.identity))
}))
practiceAgentRouter.use(errors)
