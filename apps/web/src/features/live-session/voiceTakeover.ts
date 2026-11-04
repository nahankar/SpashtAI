export const VOICE_TAKEOVER = {
  title: 'End the other live session?',
  confirmLabel: 'Take over this session',
  cancelLabel: 'Cancel',
} as const

type ConfirmDialog = (options: {
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
}) => Promise<boolean>

export function confirmVoiceTakeover(confirm: ConfirmDialog, message: string) {
  return confirm({
    title: VOICE_TAKEOVER.title,
    description: message,
    confirmLabel: VOICE_TAKEOVER.confirmLabel,
    cancelLabel: VOICE_TAKEOVER.cancelLabel,
  })
}

/** Elevate and Interviews pass this as `confirmTakeover` on the live-session controller. */
export function bindVoiceTakeover(confirm: ConfirmDialog) {
  return (message: string) => confirmVoiceTakeover(confirm, message)
}
