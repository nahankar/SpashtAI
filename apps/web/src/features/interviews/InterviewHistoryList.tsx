import { Link } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { RetainCheckbox } from '@/components/session/SessionRetain'
import type { RetainResult } from '@/lib/sessionRetain'
import { interviewHistoryPath, practiceTitle, selectionLabel, type InterviewHistory } from '@/lib/interview-practice'
import { practiceCounts } from '@/lib/interview-history'
import { PracticeTitle } from './PracticeTitle'

/**
 * Interview practice cards: Resume for unfinished practice, Review opens playback directly. Same layout and
 * selection/deletion interaction as Elevate history; every column can shrink, so long titles never widen the page.
 */
export function InterviewHistoryList({ runs, onRetain, selected, onToggle, onDelete }: {
  runs: InterviewHistory[]; onRetain: (run: InterviewHistory, result: RetainResult) => void
  selected?: Set<string>; onToggle?: (run: InterviewHistory) => void; onDelete?: (run: InterviewHistory) => void
}) {
  return <div className="grid min-w-0 gap-3">
    {runs.map(run => {
      const ended = Boolean(run.endedAt)
      const { title } = practiceTitle(run.track)
      return <Card key={run.id} className={`min-w-0 transition-all hover:shadow-md ${selected?.has(run.id) ? 'ring-2 ring-primary' : ''}`}>
        <CardContent className="flex min-w-0 flex-col gap-3 py-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {selected && onToggle && <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" aria-label={`Select ${title}`}
              checked={selected.has(run.id)} onChange={() => onToggle(run)} />}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex min-w-0 flex-wrap items-start gap-2">
                <PracticeTitle track={run.track} className="font-medium" />
                <Badge className="shrink-0" variant={ended ? 'default' : 'secondary'}>{ended ? 'Ended' : 'In progress'}</Badge>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>{new Date(run.startedAt).toLocaleString()}</span>
                <span className="min-w-0 break-words">{selectionLabel(run.startingDifficulty)} · {selectionLabel(run.experienceBand, ' years')}</span>
                <span>{practiceCounts(run)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {!ended && <RetainCheckbox sessionId={run.sessionId} retained={Boolean(run.retainedAt)} onChange={result => onRetain(run, result)} />}
            <Button asChild size="sm" variant="outline"><Link to={interviewHistoryPath(run)}>{ended ? 'Review' : 'Resume'}</Link></Button>
            {onDelete && <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive"
              aria-label={`Delete ${title}`} title="Delete this practice" onClick={() => onDelete(run)}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </CardContent>
      </Card>
    })}
  </div>
}
