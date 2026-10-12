import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { isValidInternalAgentRequest, requireAuth } from '../middleware/auth'
import { BankError } from '../interviews/bank/csv'
import { SessionDiscardedError, SessionMissingError } from '../lib/sessionDiscard'
import { reqLog } from '../lib/logger'
import { captureCommittedTurn, endPractice, finishAnswer, markQuestionAsked, practiceDetail, prepareBankAttempt, recordAssistance, startPractice } from '../interviews/practice/service'

const route = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res).catch(next) }
const empty = z.object({}).strict()
const finish = z.object({ skip: z.boolean().default(false) }).strict()
function errors(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof BankError || error instanceof SessionDiscardedError || error instanceof SessionMissingError) {
    res.status(error.status).json({ error: error.message }); return
  }
  if (error instanceof z.ZodError) { res.status(400).json({ error: 'Invalid interview practice request' }); return }
  reqLog(req).error({ event: 'interviews.capture_request_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Interview capture request failed')
  res.status(500).json({ error: 'Interview request failed. Try again.' })
}

// Intentionally unregistered until the voice producer and purpose-aware room
// access ship together in checkpoint 3.2. A flag change alone cannot expose this.
export const practiceRouter = Router()
practiceRouter.use(requireAuth)
practiceRouter.post('/runs', route(async (req, res) => { res.status(201).json(await startPractice(req.body, req.user!.userId)) }))
practiceRouter.get('/runs/:runId', route(async (req, res) => { res.json(await practiceDetail(req.params.runId, req.user!.userId)) }))
practiceRouter.post('/runs/:runId/next', route(async (req, res) => { empty.parse(req.body); res.json(await prepareBankAttempt(req.params.runId, req.user!.userId)) }))
practiceRouter.post('/runs/:runId/attempts/:attemptId/finish', route(async (req, res) => {
  const body = finish.parse(req.body)
  res.json(await finishAnswer(req.params.runId, req.params.attemptId, req.user!.userId, body.skip))
}))
practiceRouter.post('/runs/:runId/end', route(async (req, res) => { empty.parse(req.body); res.json(await endPractice(req.params.runId, req.user!.userId)) }))
practiceRouter.use(errors)

export const practiceAgentRouter = Router()
practiceAgentRouter.use((req, res, next) => {
  if (!isValidInternalAgentRequest(req)) { res.status(401).json({ error: 'Internal agent authentication required' }); return }
  next()
})
practiceAgentRouter.post('/attempts/:attemptId/asked', route(async (req, res) => { res.json(await markQuestionAsked(req.params.attemptId, req.body)) }))
practiceAgentRouter.post('/attempts/:attemptId/chunks', route(async (req, res) => { res.json(await captureCommittedTurn(req.params.attemptId, req.body)) }))
practiceAgentRouter.post('/attempts/:attemptId/assistance', route(async (req, res) => { await recordAssistance(req.params.attemptId, req.body); res.json({ saved: true }) }))
practiceAgentRouter.use(errors)
