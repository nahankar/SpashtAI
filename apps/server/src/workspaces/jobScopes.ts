import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { runOutsideDataScope } from '../lib/dataScope'
import { workspacesEnabled } from './contracts'
import { withCleanupScope, withJobScope } from './requestScope'

export type WorkspaceJob =
  | 'session_deletion'
  | 'pace_reconciliation'
  | 'delivery_alignment'
  | 'session_inactivity'
  | 'audio_enrichment'
  | 'learner_evaluation'

/** Content-free discovery of organization learners with due work for one job. */
export async function dueWorkspaceJobScopes(job: WorkspaceJob) {
  return runOutsideDataScope(() =>
    prisma.$queryRaw<Array<{ workspaceId: string; userId: string }>>`SELECT * FROM public.workspace_job_scopes(${job})`)
}

/**
 * Runs a worker sweep for Personal activity, then once per organization learner
 * with due work under a freshly verified scope. Deletion runs in cleanup scope so
 * tombstones are destroyed even after a membership ended.
 */
export async function sweepAllScopes(job: WorkspaceJob, sweep: () => Promise<unknown>): Promise<void> {
  await runOutsideDataScope(sweep)
  if (!workspacesEnabled()) return
  const scopes = await dueWorkspaceJobScopes(job)
  const seen = new Set<string>()
  for (const { workspaceId, userId } of scopes) {
    const key = job === 'session_deletion' ? workspaceId : `${workspaceId}:${userId}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      if (job === 'session_deletion') await withCleanupScope(workspaceId, sweep)
      else await withJobScope(workspaceId, userId, sweep)
    } catch (error) {
      logger.error({ err: error, job, workspaceId }, 'Organization worker sweep failed')
    }
  }
}
