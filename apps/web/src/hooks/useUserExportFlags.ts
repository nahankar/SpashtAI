import { useContext } from 'react'
import { AuthContext } from '@/contexts/AuthContext'

export interface UserExportFlags {
  hideTranscriptText: boolean
  hideTranscriptJsonExport: boolean
  hideAudioDownload: boolean
}

const ALL_VISIBLE: UserExportFlags = {
  hideTranscriptText: false,
  hideTranscriptJsonExport: false,
  hideAudioDownload: false,
}

export function useUserExportFlags(): UserExportFlags {
  const auth = useContext(AuthContext)
  if (!auth?.user) return ALL_VISIBLE
  if (auth.isAdmin) return ALL_VISIBLE

  return {
    hideTranscriptText: auth.user.hideTranscriptText ?? false,
    hideTranscriptJsonExport: auth.user.hideTranscriptJsonExport ?? false,
    hideAudioDownload: auth.user.hideAudioDownload ?? false,
  }
}
