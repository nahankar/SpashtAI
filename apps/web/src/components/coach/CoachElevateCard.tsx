import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Clock3, Loader2, Mic, Play, RotateCcw } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { coachElevatePath } from '@/lib/coach-api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

interface ElevateSession {
  id: string
  userId: string
  module: string
  sessionName?: string | null
  focusArea?: string | null
  startedAt: string
  endedAt?: string | null
  durationSec?: number | null
}

interface ElevateResultSummary {
  scores?: Record<string, number | null>
  topStrength?: string
  primaryImprovement?: string
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

function formatDuration(seconds?: number | null): string | null {
  if (seconds == null) return null
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}m ${remainder}s`
}

export function CoachElevateCard({
  userId,
  sessionId,
  threadId,
}: {
  userId?: string
  sessionId?: string
  threadId?: string
}) {
  const [sessions, setSessions] = useState<ElevateSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [resultSummary, setResultSummary] = useState<ElevateResultSummary | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient<{ sessions: ElevateSession[] }>('/sessions')
      .then(({ sessions: items }) => {
        if (cancelled) return
        setSessions(
          items.filter(
            (session) =>
              session.module === 'elevate' && (!userId || session.userId === userId),
          ),
        )
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
  }, [userId])

  useEffect(() => {
    if (!sessionId) {
      setResultSummary(null)
      return
    }
    let cancelled = false
    Promise.all([
      apiClient<{ scores?: Record<string, number | null> }>(
        `/sessions/${encodeURIComponent(sessionId)}/skill-scores`,
      ).catch(() => null),
      apiClient<{ topStrength?: string; primaryImprovement?: string }>(
        `/sessions/${encodeURIComponent(sessionId)}/coaching-insights`,
      ).catch(() => null),
    ]).then(([skills, insights]) => {
      if (cancelled) return
      setResultSummary({
        scores: skills?.scores,
        topStrength: insights?.topStrength,
        primaryImprovement: insights?.primaryImprovement,
      })
    })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const requestedSession = sessionId
    ? sessions.find((session) => session.id === sessionId)
    : null
  const unfinished = sessionId
    ? null
    : sessions.find((session) => !session.endedAt)
  const completed = sessionId
    ? requestedSession?.endedAt
      ? requestedSession
      : null
    : sessions.find((session) => Boolean(session.endedAt))
  const current = sessionId ? requestedSession : unfinished ?? completed
  const isUnfinished = Boolean(current && !current.endedAt)
  const name = current?.sessionName?.trim() || 'Elevate session'
  const duration = formatDuration(current?.durationSec)
  const focusScore =
    current?.focusArea && resultSummary?.scores
      ? resultSummary.scores[current.focusArea]
      : null

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1.5 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mic className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-[0.14em]">Elevate</span>
          </div>
          {!loading && current && (
            <Badge variant={isUnfinished ? 'secondary' : 'success'}>
              {isUnfinished ? 'Ready to resume' : 'Completed'}
            </Badge>
          )}
        </div>
        <CardTitle className="text-base">
          {loading
            ? 'Checking your Elevate sessions'
            : isUnfinished
              ? 'Continue your unfinished practice'
              : sessionId && completed
                ? 'Practice complete'
                : completed
                ? 'Your latest practice is complete'
                : 'Start a focused voice practice'}
        </CardTitle>
        <CardDescription>
          {loading
            ? 'Looking for verified session progress…'
            : error
              ? 'Session history is unavailable right now. You can still start Elevate.'
              : current
                ? `${name}${current.focusArea ? ` · ${current.focusArea.replaceAll('_', ' ')}` : ''} · ${relativeTime(current.endedAt || current.startedAt)}`
                : 'Choose a communication skill, speak with your coach, and review the completed session.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading session status…
          </div>
        ) : (
          <>
            {current && (
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {duration && (
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="h-4 w-4" />
                    {duration}
                  </span>
                )}
                {!isUnfinished && (
                  <span className="flex items-center gap-1.5">
                    <RotateCcw className="h-4 w-4" />
                    Verified when the session ended
                  </span>
                )}
              </div>
            )}
            {sessionId && current?.endedAt && resultSummary && (
              <div className="grid gap-2 sm:grid-cols-2">
                {focusScore != null && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                      {current.focusArea?.replaceAll('_', ' ')}
                    </p>
                    <p className="text-lg font-semibold">{focusScore.toFixed(1)}/10</p>
                  </div>
                )}
                {resultSummary.topStrength && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2">
                    <p className="text-xs text-muted-foreground">Strong</p>
                    <p className="text-sm font-medium">{resultSummary.topStrength}</p>
                  </div>
                )}
                {resultSummary.primaryImprovement && (
                  <div className="rounded-md border bg-muted/40 px-3 py-2 sm:col-span-2">
                    <p className="text-xs text-muted-foreground">Work next</p>
                    <p className="text-sm font-medium">{resultSummary.primaryImprovement}</p>
                  </div>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <Button asChild size="sm" className="gap-2">
                <Link
                  to={
                    current
                      ? coachElevatePath({ session: current.id }, threadId)
                      : coachElevatePath({ newSession: 'true' }, threadId)
                  }
                >
                  {isUnfinished ? (
                    <>
                      <Play className="h-4 w-4" />
                      Resume session
                    </>
                  ) : completed ? (
                    <>
                      Review session
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      Start Elevate
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Link>
              </Button>
              {current && (
                <Link
                  to={coachElevatePath({ newSession: 'true' }, threadId)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Start new
                </Link>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
