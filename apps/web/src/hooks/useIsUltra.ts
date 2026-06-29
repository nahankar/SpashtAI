import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

/**
 * Whether the current user can access Ultra-plan features (e.g. Replay
 * video-file uploads). Admins always have access; everyone else needs the
 * admin-controlled `enableUltra` license flag.
 */
export function useIsUltra(): boolean {
  const auth = useContext(AuthContext)
  if (!auth?.user) return false
  if (auth.isAdmin) return true
  return auth.user.enableUltra ?? false
}
