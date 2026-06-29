import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

/**
 * Whether the current user can access Pro-gated features (e.g. playback
 * "Key Moments", "Ask AI Coach"). Admins always have access; everyone else
 * needs the admin-controlled `enablePro` license flag.
 */
export function useIsPro(): boolean {
  const auth = useContext(AuthContext)
  if (!auth?.user) return false
  if (auth.isAdmin) return true
  return auth.user.enablePro ?? false
}
