import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Calendar, Loader2, Mic } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getPreparation, listPreparations } from '@/lib/prepare-api'
import { JOURNEY_FINISHED_STATUSES, type Preparation } from '@/lib/prepare-types'
import { patchCoachThread } from '@/lib/coach-api'

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function pickActiveJourney(journeys: Preparation[]): Preparation | null {
  const active = journeys
    .filter((journey) => !JOURNEY_FINISHED_STATUSES.includes(journey.status))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return active[0] ?? journeys[0] ?? null
}

function practiceHref(
  preparationId: string,
  stageId?: string | null,
  threadId?: string,
) {
  const params = new URLSearchParams({
    newSession: 'true',
    preparationId,
    coach: '1',
  })
  if (stageId) params.set('stageId', stageId)
  if (threadId) params.set('thread', threadId)
  return `/elevate?${params.toString()}`
}

function journeyHref(preparationId: string, threadId?: string) {
  const params = new URLSearchParams({ coach: '1' })
  if (threadId) params.set('thread', threadId)
  return `/prepare/interviews/${preparationId}?${params.toString()}`
}

export function CoachPrepareCard({ threadId }: { threadId?: string }) {
  const [journey, setJourney] = useState<Preparation | null>(null)
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    listPreparations()
      .then(async (journeys) => {
        if (cancelled) return
        setCount(journeys.length)
        const selected = pickActiveJourney(journeys)
        if (!selected) {
          setJourney(null)
          return
        }
        const detail = await getPreparation(selected.id)
        if (!cancelled) setJourney(detail)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load journeys')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const questionCount = journey?.questions?.length
    ?? journey?.stages.reduce((sum, stage) => sum + (stage.questionCount ?? 0), 0)
    ?? 0

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1.5 pb-3">
        <CardTitle className="text-base">Interview memory</CardTitle>
        <CardDescription>
          {loading
            ? 'Loading your journeys…'
            : error
              ? error
              : journey
                ? `${journey.interview.companyName} · ${journey.interview.roleTitle}`
                : 'No interview journeys yet. Start one to keep JD, resume, and questions in one place.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Prepare…
          </div>
        )}
        {!loading && !error && journey && (
          <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{journey.title}</p>
                <p className="text-xs text-muted-foreground">
                  {count > 1 ? `${count} journeys` : '1 journey'}
                  {questionCount > 0 ? ` · ${questionCount} saved question${questionCount === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              <Badge variant={journey.status === 'ACTIVE' ? 'secondary' : 'outline'}>
                {journey.status.toLowerCase()}
              </Badge>
            </div>
            {journey.nextStage ? (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Next round</p>
                <p className="text-sm font-medium">{journey.nextStage.name}</p>
                {journey.nextStage.scheduledAt && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(journey.nextStage.scheduledAt)}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming round on this journey.</p>
            )}
            {journey.lastCompletedStage && (
              <p className="text-xs text-muted-foreground">
                Last completed: {journey.lastCompletedStage.name}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          {journey?.nextStage && (
            <Button asChild size="sm" className="gap-2">
              <Link
                to={practiceHref(journey.id, journey.nextStage.id, threadId)}
                onClick={() => {
                  if (threadId) {
                    void patchCoachThread(threadId, { preparationId: journey.id })
                  }
                }}
              >
                <Mic className="h-4 w-4" />
                Practice {journey.nextStage.name}
              </Link>
            </Button>
          )}
          {journey ? (
            journey.nextStage ? (
              <Link
                to={journeyHref(journey.id, threadId)}
                onClick={() => {
                  if (threadId) {
                    void patchCoachThread(threadId, { preparationId: journey.id })
                  }
                }}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Open journey
              </Link>
            ) : (
              <Button asChild size="sm" className="gap-2">
                <Link
                  to={journeyHref(journey.id, threadId)}
                  onClick={() => {
                    if (threadId) {
                      void patchCoachThread(threadId, { preparationId: journey.id })
                    }
                  }}
                >
                  Open journey
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            )
          ) : (
            <Button asChild size="sm" className="gap-2">
              <Link to="/prepare">
                {error ? 'Open Prepare' : 'Start a journey'}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
