import { Router } from 'express'
import { z } from 'zod'
import { isValidInternalAgentRequest } from '../../middleware/auth'
import { enqueueFollowUps } from '../../interviews/bank/followUps'
import { BankError } from '../../interviews/bank/csv'
import { reqLog } from '../../lib/logger'
const router = Router()
router.post('/:sessionId/interview-followups', (req, res) => {
  if (!isValidInternalAgentRequest(req)) { res.status(403).json({ error: 'Internal agent access required' }); return }
  const body = z.object({ questions: z.array(z.unknown()).min(1).max(50) }).strict().safeParse(req.body)
  if (!body.success) { res.status(400).json({ error: 'Submit up to 50 enriched follow-up questions' }); return }
  void enqueueFollowUps(req.params.sessionId, body.data.questions).then(result => { res.status(202).json(result) }).catch(error => {
    const status = error instanceof BankError ? error.status : error instanceof z.ZodError ? 400 : error?.status === 410 ? 410 : error?.status === 404 ? 404 : 500
    if (status === 500) reqLog(req).error({ event: 'interview_bank.followup_enqueue_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Follow-up submission failed')
    res.status(status).json({ error: status === 500 ? 'Follow-up submission failed' : error instanceof z.ZodError ? 'Complete follow-up learning content is required' : error.message })
  })
})
export default router
