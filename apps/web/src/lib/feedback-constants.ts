export const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  CONSIDERED: 'Considered',
  IMPLEMENTED: 'Implemented',
  PARKED: 'Parked',
}

export const FEEDBACK_STATUS_BADGE: Record<
  string,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }
> = {
  OPEN: { variant: 'destructive', label: 'Open' },
  ACKNOWLEDGED: { variant: 'secondary', label: 'Acknowledged' },
  CONSIDERED: { variant: 'default', label: 'Considered' },
  IMPLEMENTED: { variant: 'default', label: 'Implemented' },
  PARKED: { variant: 'outline', label: 'Parked' },
}

export const FEEDBACK_PRIORITY_BADGE: Record<string, { className: string; label: string }> = {
  LOW: { className: 'bg-slate-100 text-slate-700 border-slate-200', label: 'Low' },
  MEDIUM: { className: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Medium' },
  HIGH: { className: 'bg-orange-100 text-orange-700 border-orange-200', label: 'High' },
  CRITICAL: { className: 'bg-red-100 text-red-700 border-red-200', label: 'Critical' },
}

export const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  FEEDBACK: 'Feedback',
  ISSUE: 'Issue',
  FEATURE_REQUEST: 'Feature Request',
}

export function formatRelativeDate(dateString: string): string {
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
