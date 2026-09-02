export type FeedbackSessionModule = 'elevate' | 'replay'

export function buildSessionUrl(module: FeedbackSessionModule, sessionId: string): string {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173'
  if (module === 'elevate') {
    return `${origin}/elevate?session=${encodeURIComponent(sessionId)}`
  }
  return `${origin}/replay/${encodeURIComponent(sessionId)}`
}

export function sessionPickerValue(module: FeedbackSessionModule, sessionId: string): string {
  return `${module}:${sessionId}`
}

export function parseSessionPickerValue(
  value: string,
): { module: FeedbackSessionModule; sessionId: string } | null {
  const idx = value.indexOf(':')
  if (idx <= 0) return null
  const module = value.slice(0, idx)
  const sessionId = value.slice(idx + 1)
  if ((module !== 'elevate' && module !== 'replay') || !sessionId) return null
  return { module, sessionId }
}

export function formatRelDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
