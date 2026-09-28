import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

/** Replay audio uploads are preview access granted per user by an admin. */
export function useCanReplayAudioUpload(): boolean {
  const auth = useContext(AuthContext)
  if (!auth?.user) return false
  if (auth.isAdmin) return true
  return auth.user.enableReplayAudioUpload ?? false
}
