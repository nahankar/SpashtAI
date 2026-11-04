import type { Route } from 'playwright'
import { classifyTarget, type RunConfig } from '../config.js'

/**
 * Route handler that refuses app API/session requests to any origin other than the expected API (and, for a
 * local target, to any non-local origin). A violation means the frontend is bound to another (possibly
 * production) API: the request is aborted and the caller blocks the run.
 */
export function apiOriginGuard(cfg: Pick<RunConfig, 'apiUrl' | 'targetKind'>, onViolation: (origin: string) => void) {
  return async (route: Pick<Route, 'request' | 'abort' | 'continue'>) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sessions')) {
      const wrongApi = Boolean(cfg.apiUrl) && url.origin !== new URL(cfg.apiUrl!).origin
      const remoteFromLocal = cfg.targetKind === 'local' && classifyTarget(url.toString()) !== 'local'
      if (wrongApi || remoteFromLocal) { onViolation(url.origin); return route.abort() }
    }
    return route.continue()
  }
}
