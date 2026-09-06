import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Calendar, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { StageTracker } from '@/components/prepare/StageTracker'
import { deletePreparation, listPreparations } from '@/lib/prepare-api'
import {
  JOURNEY_FINISHED_STATUSES,
  type Preparation,
} from '@/lib/prepare-types'
import { useConfirm } from '@/hooks/useConfirm'

function formatDate(value: string | null | undefined) {
  if (!value) return null
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function JourneyCard({
  journey,
  onDelete,
}: {
  journey: Preparation
  onDelete: (journey: Preparation) => void
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">{journey.interview.companyName}</p>
            <CardTitle className="mt-1 text-lg">{journey.interview.roleTitle}</CardTitle>
          </div>
          <Badge variant={journey.status === 'ACTIVE' ? 'default' : 'outline'}>
            {journey.status.toLowerCase()}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {journey.nextStage ? (
          <div className="rounded-lg border bg-primary/5 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Next</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{journey.nextStage.name}</p>
              {journey.nextStage.scheduledAt && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(journey.nextStage.scheduledAt)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No upcoming stage.</p>
        )}

        <StageTracker stages={journey.stages} compact />

        <div className="flex items-center justify-between border-t pt-3">
          <Button
            size="icon"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(journey)}
            aria-label={`Delete ${journey.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Link to={`/prepare/interviews/${journey.id}`}>
            <Button size="sm">
              Continue preparing <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

export function InterviewJourneys() {
  const confirm = useConfirm()
  const [journeys, setJourneys] = useState<Preparation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setJourneys(await listPreparations())
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load journeys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const active = useMemo(
    () => journeys.filter((journey) => !JOURNEY_FINISHED_STATUSES.includes(journey.status)),
    [journeys],
  )
  const completed = useMemo(
    () => journeys.filter((journey) => JOURNEY_FINISHED_STATUSES.includes(journey.status)),
    [journeys],
  )

  async function remove(journey: Preparation) {
    const accepted = await confirm({
      title: 'Delete interview journey?',
      description: `Delete ${journey.title} and its stages? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!accepted) return
    try {
      await deletePreparation(journey.id)
      setJourneys((current) => current.filter((item) => item.id !== journey.id))
      toast.success('Interview journey deleted')
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete journey')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading your interviews…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Prepare · Perform</p>
          <h1 className="text-3xl font-bold tracking-tight">Your interviews</h1>
          <p className="mt-2 text-muted-foreground">
            Keep every interview process and its next round in one place.
          </p>
        </div>
        <Link to="/prepare">
          <Button><Plus className="mr-2 h-4 w-4" /> New interview journey</Button>
        </Link>
      </div>

      {error && (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button className="mt-4" variant="outline" onClick={load}>Try again</Button>
          </CardContent>
        </Card>
      )}

      {!error && journeys.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <h2 className="text-xl font-semibold">Prepare for your next interview</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Track each process and always know which conversation is next.
            </p>
            <Link to="/prepare">
              <Button className="mt-5">Create interview journey</Button>
            </Link>
          </CardContent>
        </Card>
      ) : !error ? (
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active">Active ({active.length})</TabsTrigger>
            <TabsTrigger value="completed">Completed ({completed.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="active" className="mt-5">
            {active.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {active.map((journey) => (
                  <JourneyCard key={journey.id} journey={journey} onDelete={remove} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No active journeys.</p>
            )}
          </TabsContent>
          <TabsContent value="completed" className="mt-5">
            {completed.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {completed.map((journey) => (
                  <JourneyCard key={journey.id} journey={journey} onDelete={remove} />
                ))}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">No completed journeys yet.</p>
            )}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  )
}
