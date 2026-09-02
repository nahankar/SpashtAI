import { ExternalLink } from 'lucide-react'
import type { FeedbackSessionModule } from '@/lib/feedback-session'

interface FeedbackLinkedSessionProps {
  sessionId?: string | null
  sessionUrl?: string | null
  sessionModule?: string | null
}

const MODULE_LABELS: Record<FeedbackSessionModule, string> = {
  elevate: 'Elevate',
  replay: 'Replay',
}

export function FeedbackLinkedSession({
  sessionId,
  sessionUrl,
  sessionModule,
}: FeedbackLinkedSessionProps) {
  if (!sessionId || !sessionUrl) return null

  const moduleLabel =
    sessionModule === 'elevate' || sessionModule === 'replay'
      ? MODULE_LABELS[sessionModule]
      : 'Session'

  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground mb-1">Related {moduleLabel} session</p>
      <p className="font-mono text-xs text-muted-foreground mb-2 break-all">{sessionId}</p>
      <a
        href={sessionUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
      >
        Open session <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  )
}
