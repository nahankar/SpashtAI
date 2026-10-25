import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RetainCheckbox } from '@/components/session/SessionRetain'
import type { RetainResult } from '@/lib/sessionRetain'
import { interviewHistoryPath, selectionLabel, type InterviewHistory } from '@/lib/interview-practice'
import { practiceCounts } from '@/lib/interview-history'

/** Interview practice cards: Resume for unfinished practice, Review opens playback directly. Same layout as Elevate history. */
export function InterviewHistoryList({ runs, onRetain }: { runs: InterviewHistory[]; onRetain: (run: InterviewHistory, result: RetainResult) => void }) {
  return <div className="grid gap-3">
    {runs.map(run => {
      const ended = Boolean(run.endedAt)
      return <Card key={run.id} className="transition-all hover:shadow-md">
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate font-medium">{selectionLabel(run.track)}</h3>
              <Badge variant={ended ? 'default' : 'secondary'}>{ended ? 'Ended' : 'In progress'}</Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
              <span>{new Date(run.startedAt).toLocaleString()}</span>
              <span>{selectionLabel(run.startingDifficulty)} · {selectionLabel(run.experienceBand, ' years')}</span>
              <span>{practiceCounts(run)}</span>
            </div>
          </div>
          <div className="flex w-full shrink-0 items-center justify-end gap-2 sm:w-auto">
            {!ended && <RetainCheckbox sessionId={run.sessionId} retained={Boolean(run.retainedAt)} onChange={result => onRetain(run, result)} />}
            <Button asChild size="sm" variant="outline"><Link to={interviewHistoryPath(run)}>{ended ? 'Review' : 'Resume'}</Link></Button>
          </div>
        </CardContent>
      </Card>
    })}
  </div>
}
