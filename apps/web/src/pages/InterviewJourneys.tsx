import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Bug, Calendar, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SessionFilters, type SortDir, type SortField } from '@/components/SessionFilters'
import { StageTracker } from '@/components/prepare/StageTracker'
import { deletePreparation, listPreparations } from '@/lib/prepare-api'
import { JOURNEY_FINISHED_STATUSES, type Preparation } from '@/lib/prepare-types'
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

function JourneyRow({
  journey,
  onDelete,
}: {
  journey: Preparation
  onDelete: (journey: Preparation) => void
}) {
  const finished = JOURNEY_FINISHED_STATUSES.includes(journey.status)
  const practiceCount = journey.practices?.length ?? 0
  const recordingCount = journey.recordings?.length ?? 0

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{journey.interview.roleTitle}</span>
            <Badge variant={finished ? 'outline' : 'default'}>
              {journey.status.toLowerCase()}
            </Badge>
            {journey.nextStage && (
              <Badge variant="outline" className="text-xs">
                Next: {journey.nextStage.name}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{journey.interview.companyName || 'General interview'}</span>
            <span>Updated {formatDate(journey.updatedAt)}</span>
            {journey.nextStage?.scheduledAt && (
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(journey.nextStage.scheduledAt)}
              </span>
            )}
            <span>
              {practiceCount} practice{practiceCount === 1 ? '' : 's'} · {recordingCount} recording
              {recordingCount === 1 ? '' : 's'}
            </span>
          </div>
          {journey.stages.length > 0 && (
            <div className="mt-3">
              <StageTracker stages={journey.stages} compact />
            </div>
          )}
        </div>

        <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
          <Link to={`/prepare/interviews/${journey.id}`}>
            <Button size="sm" variant="outline">
              {finished ? 'View journey' : 'Continue'} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
          <Link to="/feedback/new" title="Report an issue with this interview journey">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-primary"
              aria-label={`Report an issue with ${journey.title}`}
            >
              <Bug className="h-4 w-4" />
            </Button>
          </Link>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(journey)}
            aria-label={`Delete ${journey.title}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
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
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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
    void load()
  }, [])

  const filteredJourneys = useMemo(() => {
    const query = search.trim().toLowerCase()
    const matches = journeys.filter((journey) => {
      const finished = JOURNEY_FINISHED_STATUSES.includes(journey.status)
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'active' && !finished)
        || (statusFilter === 'completed' && finished)
      if (!matchesStatus) return false
      if (!query) return true
      return [
        journey.title,
        journey.interview.companyName,
        journey.interview.roleTitle,
        journey.nextStage?.name,
      ].some((value) => value?.toLowerCase().includes(query))
    })

    return matches.sort((a, b) => {
      let comparison = 0
      if (sortField === 'name') comparison = a.title.localeCompare(b.title)
      else if (sortField === 'status') comparison = a.status.localeCompare(b.status)
      else comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      return sortDir === 'asc' ? comparison : -comparison
    })
  }, [journeys, search, statusFilter, sortField, sortDir])

  async function remove(journey: Preparation) {
    const accepted = await confirm({
      title: 'Delete interview journey?',
      description: `Delete ${journey.title}, its stages, and all linked interview practices and recordings? This cannot be undone.`,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-primary">Prepare · Perform</p>
          <h1 className="text-2xl font-bold">Your interviews</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Keep every interview process, practice, recording, and next round in one place.
          </p>
        </div>
        <Link to="/prepare/new">
          <Button className="w-full sm:w-auto"><Plus className="mr-2 h-4 w-4" /> New interview journey</Button>
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
            <Link to="/prepare/new">
              <Button className="mt-5">Create interview journey</Button>
            </Link>
          </CardContent>
        </Card>
      ) : !error ? (
        <>
          <SessionFilters
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search interviews..."
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(field, direction) => { setSortField(field); setSortDir(direction) }}
            sortOptions={[
              { value: 'date', label: 'Last updated' },
              { value: 'name', label: 'Interview name' },
              { value: 'status', label: 'Status' },
            ]}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusOptions={[
              { value: 'all', label: 'All journeys' },
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
            ]}
            totalCount={journeys.length}
            filteredCount={filteredJourneys.length}
          />

          {filteredJourneys.length ? (
            <div className="grid gap-3">
              {filteredJourneys.map((journey) => (
                <JourneyRow key={journey.id} journey={journey} onDelete={remove} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No interview journeys match your filters.
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
