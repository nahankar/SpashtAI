/**
 * The isolated tenancy container (port 55443). Any dedicated database in it may be used,
 * so parallel worktrees never share fixtures; the restricted role targets the same database.
 */
export function workspaceTestUrls(url = process.env.WORKSPACE_TEST_DATABASE_URL) {
  if (!url) return null
  const match = /^postgresql:\/\/postgres@127\.0\.0\.1:55443\/([A-Za-z0-9_]+)$/.exec(url)
  if (!match) throw new Error('Use only the isolated tenancy container on port 55443')
  return { admin: url, restricted: `postgresql://tenancy_test_app@127.0.0.1:55443/${match[1]}` }
}

export const RESTRICTED_TEST_URL = workspaceTestUrls()?.restricted ?? 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
