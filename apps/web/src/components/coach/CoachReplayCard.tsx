import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowRight, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ReplaySession {
  id: string
  sessionName?: string | null
  meetingType: string
  status: 'pending' | 'transcribing' | 'analyzing' | 'completed' | 'failed' | string
  createdAt: string
  result?: { overallScore: number } | null
  uploadedFiles: Array<{ id: string; fileType: string; originalName: string }>
}

function relativeTime(value: string): string {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 7
    ? `${days}d ago`
    : new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function CoachReplayCard({
  sessionId,
  threadId,
}: {
  sessionId?: string
  threadId?: string
}) {
  const [latest, setLatest] = useState<ReplaySession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiClient<{ sessions: ReplaySession[] }>('/api/replay/sessions')
      .then(({ sessions }) => {
        if (!cancelled) {
          setLatest(
            sessionId ? sessions.find((session) => session.id === sessionId) ?? null : sessions[0] ?? null,
          )
        }
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const status = latest?.status
  const processing = status === 'transcribing' || status === 'analyzing'
  const completed = status === 'completed'
  const pending = status === 'pending'
  const failed = status === 'failed'
  const name = latest?.sessionName?.trim() || latest?.meetingType || 'Replay analysis'

  const primaryBase = completed || failed
    ? `/replay/${encodeURIComponent(latest!.id)}`
    : pending
      ? `/replay?session=${encodeURIComponent(latest!.id)}`
      : processing
        ? '/replay'
        : '/replay?new=true'
  const withCoachContext = (path: string) => {
    const [pathname, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    params.set('coach', '1')
    if (threadId) params.set('thread', threadId)
    return `${pathname}?${params.toString()}`
  }
  const primaryPath = withCoachContext(primaryBase)
  const newAnalysisPath = withCoachContext('/replay?new=true')

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1.5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Upload className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-[0.14em]">Replay</span>
          </div>
          {!loading && latest && (
            <Badge
              variant={failed ? 'destructive' : completed ? 'success' : 'secondary'}
            >
              {completed
                ? 'Analysis ready'
                : processing
                  ? status === 'analyzing' ? 'Analyzing' : 'Transcribing'
                  : pending
                    ? 'Setup saved'
                    : 'Needs attention'}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base">
          {loading
            ? 'Checking your Replay analyses'
            : completed
              ? 'Your latest Replay is ready'
              : processing
                ? 'Your Replay is still processing'
                : pending
                  ? 'Continue your saved Replay'
                  : failed
                    ? 'Your Replay needs attention'
                    : 'Analyse a conversation'}
        </CardTitle>
        <CardDescription>
          {loading
            ? 'Looking for verified analysis progress…'
            : error
              ? 'Replay history is unavailable right now. You can still start a new analysis.'
              : latest
                ? `${name} · ${relativeTime(latest.createdAt)}`
                : 'Upload a recording or transcript and turn it into practical feedback.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading analysis status…
          </div>
        ) : (
          <>
            {latest && (
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {completed && (
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Verified result
                    {latest.result ? ` · ${latest.result.overallScore.toFixed(1)}/10` : ''}
                  </span>
                )}
                {pending && (
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4" />
                    {latest.uploadedFiles.length > 0
                      ? `${latest.uploadedFiles.length} source${latest.uploadedFiles.length === 1 ? '' : 's'} uploaded`
                      : 'Waiting for a source'}
                  </span>
                )}
                {failed && (
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    Open the analysis for details
                  </span>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="sm" className="gap-2">
                <Link to={primaryPath}>
                  {completed
                    ? 'View results'
                    : processing
                      ? 'Check progress'
                      : pending
                        ? 'Continue analysis'
                        : failed
                          ? 'View details'
                          : 'Start Replay'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              {latest && (
                <Link
                  to={newAnalysisPath}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  New analysis
                </Link>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
