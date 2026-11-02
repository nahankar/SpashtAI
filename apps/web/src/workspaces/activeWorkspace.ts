/**
 * The organization this tab is working in. Product requests made while it is set carry the
 * workspace token next to the identity token; the server rechecks membership on every request
 * and never falls back to Personal. The token lives in memory only, never in shared storage.
 */
export interface ActiveWorkspace {
  slug: string
  workspaceId: string
  membershipId: string
  role: 'OWNER' | 'ADMIN' | 'LEARNER'
  token: string
}

export const WORKSPACE_HEADER = 'x-spasht-workspace'

let active: ActiveWorkspace | null = null
const failureListeners = new Set<(code: string) => void>()

export function getActiveWorkspace(): ActiveWorkspace | null {
  return active
}

export function setActiveWorkspace(next: ActiveWorkspace | null) {
  active = next
}

export function workspaceHeaders(): Record<string, string> {
  return active ? { [WORKSPACE_HEADER]: active.token } : {}
}

/**
 * Headers for work that began in `origin` (for example a recording still uploading). Uses the
 * newest token for that same workspace; after a switch the old token is kept, so the request
 * fails closed instead of landing in the newly opened context.
 */
export function workspaceHeadersFor(origin: ActiveWorkspace | null): Record<string, string> {
  if (!origin) return {}
  const token = active?.workspaceId === origin.workspaceId ? active.token : origin.token
  return { [WORKSPACE_HEADER]: token }
}

/** Browser storage key for the current context, so a draft or resumable session never crosses workspaces. */
export function scopedStorageKey(base: string, workspace: ActiveWorkspace | null = active): string {
  return workspace ? `${base}:workspace:${workspace.workspaceId}` : base
}

/** In-app path for the current context: organization pages stay under /w/:slug. */
export function appPath(path: string, workspace: ActiveWorkspace | null = active): string {
  if (!workspace) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/w/${encodeURIComponent(workspace.slug)}${normalized === '/' ? '' : normalized}`
}

/** Product path without the `/w/:slug` prefix, for code that infers the product from the URL. */
export function productPathname(pathname: string): string {
  const match = /^\/w\/[^/]+(\/.*)?$/.exec(pathname)
  return match ? match[1] || '/' : pathname
}

const WORKSPACE_FAILURES = new Set([
  'WORKSPACE_TOKEN_REQUIRED', 'WORKSPACE_IDENTITY_MISMATCH', 'MEMBERSHIP_INACTIVE', 'WORKSPACE_NOT_FOUND',
  'WORKSPACE_SUSPENDED', 'WORKSPACE_PLACEMENT_UNAVAILABLE', 'WORKSPACE_CONTEXT_REJECTED', 'WORKSPACES_DISABLED',
])

/** A workspace access failure needs the workspace re-opened, not a sign-out. */
export function isWorkspaceFailure(code: string | undefined): code is string {
  return Boolean(code && WORKSPACE_FAILURES.has(code))
}

export function reportWorkspaceFailure(code: string) {
  failureListeners.forEach(listener => listener(code))
}

export function onWorkspaceFailure(listener: (code: string) => void) {
  failureListeners.add(listener)
  return () => { failureListeners.delete(listener) }
}
