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

export type JobScopeCursor = { workspaceId: string; userId: string }
export const JOB_SCOPE_PAGE = 50
const MAX_PAGES = 40

/** Content-free discovery of organization learners with due work for one job. */
export async function dueWorkspaceJobScopes(job: WorkspaceJob, after?: JobScopeCursor, limit = JOB_SCOPE_PAGE) {
  return runOutsideDataScope(() =>
    after
      ? prisma.$queryRaw<JobScopeCursor[]>`SELECT * FROM public.workspace_job_scopes(${job}::text, ${after.workspaceId}::text, ${after.userId}::text, ${limit}::int)`
      : prisma.$queryRaw<JobScopeCursor[]>`SELECT * FROM public.workspace_job_scopes(${job}::text, NULL, NULL, ${limit}::int)`)
}

/**
 * Runs a worker sweep for Personal activity, then once per organization learner
 * with due work under a freshly verified scope. Deletion runs in cleanup scope so
 * tombstones are destroyed even after a membership ended.
 *
 * Discovery is paged and ordered so later learners are reached even when earlier
 * jobs keep retrying (retries leave the due set until their nextAt arrives).
 */
/** Visits every due page. Later learners are reached even when earlier jobs keep retrying. */
export async function forEachDueJobScope(
  job: WorkspaceJob,
  visit: (scope: JobScopeCursor) => Promise<unknown>,
): Promise<boolean> {
  let any = false
  let after: JobScopeCursor | undefined
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const scopes = await dueWorkspaceJobScopes(job, after)
    if (!scopes.length) break
    const seen = new Set<string>()
    for (const scope of scopes) {
      const key = job === 'session_deletion' ? scope.workspaceId : `${scope.workspaceId}:${scope.userId}`
      if (seen.has(key)) continue
      seen.add(key)
      try {
        if (await visit(scope)) any = true
      } catch (error) {
        logger.error({ err: error, job, workspaceId: scope.workspaceId }, 'Organization worker sweep failed')
      }
    }
    after = scopes[scopes.length - 1]
    if (scopes.length < JOB_SCOPE_PAGE) break
  }
  return any
}

export async function sweepAllScopes(job: WorkspaceJob, sweep: () => Promise<unknown>): Promise<void> {
  await runOutsideDataScope(sweep)
  if (!workspacesEnabled()) return
  await forEachDueJobScope(job, async ({ workspaceId, userId }) => {
    if (job === 'session_deletion') await withCleanupScope(workspaceId, sweep)
    else await withJobScope(workspaceId, userId, sweep)
  })
}
