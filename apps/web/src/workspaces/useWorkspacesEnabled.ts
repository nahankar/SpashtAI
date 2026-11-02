import { useEffect, useState } from 'react'
import { workspaceRequest } from './client'

export function useWorkspacesEnabled() {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => {
    let alive = true
    workspaceRequest<{ enabled: boolean }>('/api/workspaces/config')
      .then(config => { if (alive) setEnabled(config.enabled) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return enabled
}
