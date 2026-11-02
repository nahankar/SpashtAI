/** Workspace pages have their own context and do not use Personal telemetry. */
export function isWorkspacePath(path: string) {
  return path === '/w' || path.startsWith('/w/') || path === '/workspaces' || path.startsWith('/workspaces/')
}
