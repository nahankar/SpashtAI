/** Account management and organization selection remain available to tenant-only identities. */
export function tenantAccountPath(path: string): boolean {
  return /^\/(?:workspaces(?:[/?#]|$)|w\/|admin(?:[/?#]|$)|auth\/complete-profile(?:[/?#]|$))/.test(path)
}

export function accountDestination(user: { tenantOnly?: boolean }, next: string | null, fallback = '/') {
  if (user.tenantOnly && (!next || !tenantAccountPath(next))) return '/workspaces'
  return next || fallback
}
