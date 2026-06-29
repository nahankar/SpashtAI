import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

export interface UserExportFlags {
  hideTranscriptText: boolean
  hideTranscriptJsonExport: boolean
  hideAudioDownload: boolean
  // Capability flags for the Session Analytics action buttons (default OFF).
  enableTxtExport: boolean
  enableJsonExport: boolean
  enableAudioExport: boolean
  enableReprocess: boolean
}

// Privileged/admin defaults: nothing hidden, every action enabled.
const ADMIN_FLAGS: UserExportFlags = {
  hideTranscriptText: false,
  hideTranscriptJsonExport: false,
  hideAudioDownload: false,
  enableTxtExport: true,
  enableJsonExport: true,
  enableAudioExport: true,
  enableReprocess: true,
}

export function useUserExportFlags(): UserExportFlags {
  const auth = useContext(AuthContext)
  // Admins always have full access. A logged-out state shouldn't reach these
  // views, but default to admin-style visibility for the non-gated content.
  if (!auth?.user) return ADMIN_FLAGS
  if (auth.isAdmin) return ADMIN_FLAGS

  return {
    hideTranscriptText: auth.user.hideTranscriptText ?? false,
    hideTranscriptJsonExport: auth.user.hideTranscriptJsonExport ?? false,
    hideAudioDownload: auth.user.hideAudioDownload ?? false,
    enableTxtExport: auth.user.enableTxtExport ?? false,
    enableJsonExport: auth.user.enableJsonExport ?? false,
    enableAudioExport: auth.user.enableAudioExport ?? false,
    enableReprocess: auth.user.enableReprocess ?? false,
  }
}
