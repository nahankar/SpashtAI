import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'
import { WorkspaceShellContext } from '@/workspaces/shell/context'

/** Replay recordings follow the organization plan inside a workspace; Personal still uses the admin preview flag. */
export function useCanReplayAudioUpload(): boolean {
  const auth = useContext(AuthContext)
  const workspace = useContext(WorkspaceShellContext)
  if (workspace) {
    return workspace.snapshot.features.some(
      (feature) => (feature.feature === 'pro' || feature.feature === 'ultra') && feature.allowed === true,
    )
  }
  if (!auth?.user) return false
  if (auth.isAdmin) return true
  return auth.user.enableReplayAudioUpload ?? false
}
