import { createHash } from 'crypto'
import { z } from 'zod'
import { prisma } from '../../lib/prisma'
import { logger } from '../../lib/logger'
import { lockWritableSession } from '../../lib/sessionDiscard'
import { draftSchema } from './schemas'
import { BankError } from './csv'
import { lockIdentity } from './service'
export const followUpSchema = z.object({
  // Stable ID of the actually asked follow-up, provided by the interview engine.
  turnId: z.string().min(1).max(160),
  draft: draftSchema.refine(d => !!d.goodAnswerPoints && !!d.exampleAnswer && !!d.explanation && !!d.followUpGuidance && !!d.track && d.track !== 'General', 'Enrich the follow-up learning content before submitting'),
}).strict()
/** Internal handoff for the future interview engine's post-session enrichment.
 * Only generic authored question content is allowed here, never candidate speech.
 * Retries for a session/turn are idempotent; first accepted content wins.
 */
export async function enqueueFollowUps(sessionId: string, inputs: unknown) {
  const candidates = z.array(followUpSchema).min(1).max(50).parse(inputs)
  return prisma.$transaction(async tx => {
    await lockWritableSession(tx, sessionId)
    const session = await tx.session.findUniqueOrThrow({ where: { id: sessionId } })
    if (session.purpose !== 'INTERVIEW' || !session.endedAt) throw new BankError(409, 'Follow-ups can be submitted only after an interview session ends')
    for (const candidate of candidates) {
      const key = createHash('sha256').update(JSON.stringify([sessionId, candidate.turnId])).digest('hex')
      await tx.bankFollowUpJob.upsert({ where: { key }, create: { sessionId, key, payload: candidate.draft }, update: {} })
    }
    return { queued: candidates.length }
  })
}
export function followUpIdentity(draft: { questionText: string; track: string }) {
  const normalize = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
  const originKey = createHash('sha256').update(JSON.stringify([normalize(draft.track), normalize(draft.questionText)])).digest('hex')
  return { namespace: 'generated-interviews', externalQid: `GEN-${originKey.slice(0,24)}`, originKey }
}
export async function sweepFollowUps() {
  let processed = 0
  // Each short transaction claims one job and inserts its question atomically.
  for (let index = 0; index < 20; index++) {
    let claimedId: string | undefined
    try {
      const done = await prisma.$transaction(async tx => {
        const jobs = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "BankFollowUpJob" WHERE status='PENDING' AND "nextAt" <= NOW() ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED`
        if (!jobs.length) return false
        claimedId = jobs[0].id
        const job = await tx.bankFollowUpJob.findUniqueOrThrow({ where: { id: claimedId } })
        // Fence materialisation against a concurrent discard. A transaction
        // deadlock rolls back and is retried by the bounded retry path below.
        await tx.$queryRaw`SELECT id FROM "Session" WHERE id=${job.sessionId} FOR UPDATE`
        const session = await tx.session.findUnique({ where: { id: job.sessionId }, select: { purpose: true, endedAt: true, discardedAt: true } })
        if (!session || session.discardedAt || session.purpose !== 'INTERVIEW' || !session.endedAt) {
          await tx.bankFollowUpJob.update({ where: { id: job.id }, data: { status: 'CANCELLED', errorCode: 'SESSION_UNAVAILABLE' } }); return true
        }
        const draft = draftSchema.safeParse(job.payload)
        if (!draft.success) {
          await tx.bankFollowUpJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorCode: 'INVALID_CONTENT' } }); return true
        }
        const identity = followUpIdentity(draft.data)
        await lockIdentity(tx, identity.namespace, identity.externalQid)
        await tx.questionBankQuestion.upsert({ where: { originKey: identity.originKey }, update: {}, create: {
          ...draft.data, ...identity, origin: 'GENERATED_FOLLOW_UP',
          approved: false, active: false, generationNotes: 'AI-generated follow-up; learning content requires Admin review.',
        } })
        await tx.bankFollowUpJob.update({ where: { id: job.id }, data: { status: 'COMPLETED', completedAt: new Date(), attempts: { increment: 1 }, payload: {} } })
        return true
      })
      if (!done) break
      processed++
    } catch (error) {
      if (!claimedId) throw error
      // Retry one failed job without starving other queued questions. A failed
      // claim never leaves an in-progress lease that needs manual recovery.
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "BankFollowUpJob" WHERE id=${claimedId!} FOR UPDATE`
        const job = await tx.bankFollowUpJob.findUnique({ where: { id: claimedId } })
        if (!job || job.status !== 'PENDING') return
        const attempts = job.attempts + 1
        await tx.bankFollowUpJob.update({ where: { id: job.id }, data: {
          attempts, status: attempts >= 5 ? 'FAILED' : 'PENDING', nextAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** attempts)),
          errorCode: error instanceof Error ? error.name.slice(0,100) : 'PROCESSING_FAILED',
        } })
        logger.warn({ event: 'interview_bank.followup_job_retry', jobId: job.id, attempts, failed: attempts >= 5 }, 'Follow-up draft processing will retry or needs attention')
      })
    }
  }
  return processed
}
let timer: NodeJS.Timeout | null = null
let running = false
export function startBankFollowUpWorker() {
  if (timer) return
  const sweep = async () => {
    if (running) return
    running = true
    try { await sweepFollowUps() } catch (error) {
      // Database interruptions roll back the claim; the next sweep retries.
      logger.error({ event: 'interview_bank.followup_worker_failed', errorType: error instanceof Error ? error.name : 'unknown' }, 'Follow-up draft processing failed')
    } finally { running = false }
  }
  timer = setInterval(() => { void sweep() }, 30_000); timer.unref?.()
}
