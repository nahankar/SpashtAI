import { AsyncLocalStorage } from 'node:async_hooks'

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'LEARNER'

/**
 * Verified organization context for one request or job. It is derived from a
 * current membership on the server, never from a client-supplied workspace ID.
 * `features` holds the effective per-member product decisions at entry time;
 * operations that consume quota or create activity recheck inside their own
 * transaction.
 */
export interface DataScope {
  actorId: string
  workspaceId: string
  membershipId: string
  role: WorkspaceRole
  slug: string
  timeZone: string
  features: Record<string, boolean>
  /**
   * manager: aggregate-only reads for Owner/Admin reports (the database rechecks the role).
   * cleanup: destruction of tombstoned activity by the deletion job.
   */
  reader?: 'manager' | 'cleanup'
  origin: 'request' | 'agent' | 'job'
}

const storage = new AsyncLocalStorage<DataScope>()

export function currentDataScope(): DataScope | undefined {
  return storage.getStore()
}

export function runWithDataScope<T>(scope: DataScope, work: () => T): T {
  return storage.run(scope, work)
}

/** Personal/platform work started from inside an organization request must opt out explicitly. */
export function runOutsideDataScope<T>(work: () => T): T {
  return storage.exit(work)
}

export function isOrganizationScope(): boolean {
  return storage.getStore() !== undefined
}
