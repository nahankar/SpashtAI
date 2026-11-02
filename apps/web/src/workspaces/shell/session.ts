import { ApiError } from '@/lib/api-client'
import { onWorkspaceFailure, setActiveWorkspace } from '../activeWorkspace'
import type { Entry, Snapshot } from '../client'

/** The workspace token lives 15 minutes; renew well before it lapses. */
export const REFRESH_MS = 10 * 60 * 1000
export const RETRY_MS = 30 * 1000

export type WorkspaceSessionState =
  | { status: 'loading' }
  | { status: 'invited'; entry: Entry }
  | { status: 'ended'; message: string; signIn: boolean }
  | { status: 'ready'; entry: Entry; snapshot: Snapshot }

type Request = <T>(path: string, token?: string, method?: string, body?: unknown) => Promise<T>

/**
 * One tab's stay in one organization: enters with the identity token, keeps the workspace token
 * fresh, and closes the workspace when the server ends access. Nothing it does after stop() can
 * reopen the workspace, so a late response never puts organization context on Personal pages.
 */
export function createWorkspaceSession(slug: string, deps: { request: Request; identity: () => string; onState: (state: WorkspaceSessionState) => void }) {
  let alive = false
  let ready = false
  let refreshedAt = 0
  let inFlight: Promise<void> | null = null
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let interval: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null
  const onVisible = () => { if (document.visibilityState === 'visible' && Date.now() - refreshedAt > REFRESH_MS) void enter() }
  const path = `/api/workspaces/entry/${encodeURIComponent(slug)}`

  function publish(state: WorkspaceSessionState) {
    ready = state.status === 'ready'
    deps.onState(state)
  }

  function enter(): Promise<void> {
    if (!alive) return Promise.resolve()
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const entry = await deps.request<Entry>(path, deps.identity(), 'POST')
        if (!alive) return
        if (entry.workspace.kind !== 'ORGANIZATION') throw new ApiError('Open Personal from Your workspaces', 404, 'WORKSPACE_NOT_FOUND')
        if (!entry.accessToken) { setActiveWorkspace(null); publish({ status: 'invited', entry }); return }
        const snapshot = await deps.request<Snapshot>('/api/workspaces/current', entry.accessToken)
        if (!alive) return
        setActiveWorkspace({ slug: entry.workspace.slug, workspaceId: entry.workspace.id, membershipId: entry.membership.id, role: entry.membership.role, token: entry.accessToken })
        refreshedAt = Date.now()
        publish({ status: 'ready', entry, snapshot })
      } catch (error) {
        if (!alive) return
        // A dropped connection keeps the current, still-valid token and retries; only the server can end access.
        if (!(error instanceof ApiError) && ready) {
          const retry = setTimeout(() => { timers.delete(retry); void enter() }, RETRY_MS)
          timers.add(retry)
          return
        }
        // Access ended (suspended, removed, workspace closed): leave the organization; never fall back to Personal.
        setActiveWorkspace(null)
        const signIn = error instanceof ApiError && error.status === 401
        publish({ status: 'ended', signIn, message: signIn ? 'Sign in again to continue.' : error instanceof Error ? error.message : 'This workspace is not available to your account.' })
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  return {
    start() {
      alive = true
      void enter()
      interval = setInterval(() => { void enter() }, REFRESH_MS)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
      unsubscribe = onWorkspaceFailure(() => { void enter() })
    },
    stop() {
      alive = false
      if (interval) clearInterval(interval)
      timers.forEach(clearTimeout); timers.clear()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      unsubscribe?.()
      setActiveWorkspace(null)
    },
    reload: enter,
    async accept() {
      try { await deps.request(`${path}/accept`, deps.identity(), 'POST'); await enter() }
      catch (error) { if (alive) publish({ status: 'ended', signIn: false, message: error instanceof Error ? error.message : 'Unable to accept the invitation' }) }
    },
  }
}
