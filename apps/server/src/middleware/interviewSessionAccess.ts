import type { NextFunction, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { requireFeature } from '../lib/featureFlags'
import { isValidInternalAgentRequest, requireAuth } from './auth'
import { BankError } from '../interviews/bank/csv'
import { practiceExecutionAccess } from '../interviews/practice/access'
import { RECORDING_CONSENT_VERSIONS } from '../interviews/practice/contracts'

async function checkInterview(req: Request, res: Response, id: string, execution: boolean): Promise<boolean> {
  const run = await prisma.interviewRun.findUnique({ where: { sessionId: id }, select: { ownerId: true, recordingConsentAt: true,
    recordingConsentVersion: true, session: { select: { discardedAt: true } } } })
  if (!run) return false
  if (!isValidInternalAgentRequest(req)) {
    if (!req.user) requireAuth(req, res, () => undefined)
    if (res.headersSent) return true
    if (req.user?.userId !== run.ownerId) { res.status(404).json({ error: 'Session not found' }); return true }
  }
  if (run.session.discardedAt && req.method !== 'DELETE') { res.status(410).json({ error: 'Session discarded' }); return true }
  if (execution) {
    await practiceExecutionAccess(run.ownerId)
    if (!run.recordingConsentAt || !RECORDING_CONSENT_VERSIONS.includes(run.recordingConsentVersion ?? '')) throw new BankError(409, 'Recording consent is required')
  }
  res.locals.interviewSession = true
  return true
}
function error(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof BankError) { res.status(error.status).json({ error: error.message }); return }
  next(error)
}
// Covers the legacy storage/metrics/audio/analysis endpoints as well as lifecycle
// routes. A privileged JWT does not bypass ownership for a learner interview.
export function guardInterviewSession(req: Request, res: Response, next: NextFunction) {
  const match = req.path.match(/^\/(?:internal\/)?sessions\/([^/]+)/)
  if (!match) return next()
  let id: string
  try { id=decodeURIComponent(match[1]) } catch { res.status(400).json({ error: 'Invalid session ID' }); return }
  const execution = req.method === 'POST' && /\/segments$/.test(req.path)
  void checkInterview(req, res, id, execution).then(() => { if (!res.headersSent) next() }).catch(e => error(e, res, next))
}
export function requireSessionFeature(execution = false) {
  return (req: Request, res: Response, next: NextFunction) => {
    const id = req.params.id || req.params.sessionId || req.query.sessionId || req.body?.sessionId
    if (typeof id !== 'string') return requireFeature('elevate')(req, res, next)
    void checkInterview(req, res, id, execution).then(interview => {
      if (res.headersSent) return
      if (interview) next()
      else void requireFeature('elevate')(req, res, next)
    }).catch(e => error(e, res, next))
  }
}
