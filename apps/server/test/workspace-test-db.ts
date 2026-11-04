/**
 * The isolated tenancy container (port 55443): its shared `postgres` database or a dedicated `*_test` database,
 * so parallel worktrees never share fixtures. Walkthrough and voice-stack databases in the same container are
 * refused. The restricted role targets the same database.
 */
export function workspaceTestUrls(url = process.env.WORKSPACE_TEST_DATABASE_URL) {
  if (!url) return null
  const match = /^postgresql:\/\/postgres@127\.0\.0\.1:55443\/(postgres|[A-Za-z0-9_]+_test)$/.exec(url)
  if (!match) throw new Error('Use only the isolated tenancy container on port 55443 (postgres or a *_test database)')
  return { admin: url, restricted: `postgresql://tenancy_test_app@127.0.0.1:55443/${match[1]}` }
}

export const RESTRICTED_TEST_URL = workspaceTestUrls()?.restricted ?? 'postgresql://tenancy_test_app@127.0.0.1:55443/postgres'
