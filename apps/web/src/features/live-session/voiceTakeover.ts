export const VOICE_TAKEOVER = {
  title: 'End the other live session?',
  confirmLabel: 'Take over this session',
  cancelLabel: 'Cancel',
} as const

export function confirmVoiceTakeover(
  confirm: (options: {
    title: string
    description: string
    confirmLabel: string
    cancelLabel: string
  }) => Promise<boolean>,
  message: string,
) {
  return confirm({
    title: VOICE_TAKEOVER.title,
    description: message,
    confirmLabel: VOICE_TAKEOVER.confirmLabel,
    cancelLabel: VOICE_TAKEOVER.cancelLabel,
  })
}
