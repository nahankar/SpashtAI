import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { getActiveWorkspace } from '../activeWorkspace'
import { currentWorkspaceRequest, type Entry, type Snapshot } from '../client'

export interface WorkspaceShellValue {
  slug: string
  entry: Entry
  snapshot: Snapshot
  /** Re-enters the workspace (fresh token and decisions) after a settings change. */
  reload: () => Promise<void>
}

export const WorkspaceShellContext = createContext<WorkspaceShellValue | null>(null)

export function useWorkspaceShell() {
  const value = useContext(WorkspaceShellContext)
  if (!value) throw new Error('useWorkspaceShell must be used inside a workspace')
  return value
}

/** Calls a workspace API with the token of the workspace currently open in this tab. */
export function workspaceCall<T>(path: string, method = 'GET', body?: unknown) {
  const active = getActiveWorkspace()
  if (!active) return Promise.reject(new Error('Open the workspace again to continue'))
  return currentWorkspaceRequest<T>(active.token, path, method, body)
}

export function useWorkspaceData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(Boolean(path))
  const [version, setVersion] = useState(0)
  useEffect(() => {
    if (!path) { setData(null); setLoading(false); return }
    let alive = true
    setLoading(true); setError('')
    workspaceCall<T>(path)
      .then(next => { if (alive) setData(next) })
      .catch(e => { if (alive) { setData(null); setError(e instanceof Error ? e.message : 'Unable to load') } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [path, version])
  const refresh = useCallback(() => setVersion(v => v + 1), [])
  return { data, error, loading, refresh }
}
