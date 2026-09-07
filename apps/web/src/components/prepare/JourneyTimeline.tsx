import { CalendarCheck, HelpCircle, MessageSquareText } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ratingLabel, type PreparationTimelineItem } from '@/lib/prepare-types'

function displayDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function labelFor(item: PreparationTimelineItem) {
  if (item.kind === 'stage_completed') {
    return `${item.stageName ?? 'Stage'} completed`
  }
  if (item.kind === 'questions_added') {
    const count = item.questionCount ?? 0
    const round = item.stageName ? ` on ${item.stageName}` : ''
    return `Added ${count} question${count === 1 ? '' : 's'}${round}`
  }
  const rating = ratingLabel(item.rating)
  return `Reflection${item.stageName ? `: ${item.stageName}` : ''}${rating ? ` · ${rating}` : ''}`
}

export function JourneyTimeline({ items }: { items: PreparationTimelineItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            After you log a round, completions, questions, and reflections show up here.
          </p>
        ) : (
          <ol className="space-y-3">
            {items.map((item, index) => (
              <li key={`${item.kind}-${item.stageId}-${item.at}-${index}`} className="flex gap-3">
                <div className="mt-0.5 text-muted-foreground">
                  {item.kind === 'stage_completed' && <CalendarCheck className="h-4 w-4" />}
                  {item.kind === 'questions_added' && <HelpCircle className="h-4 w-4" />}
                  {item.kind === 'reflection' && <MessageSquareText className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-medium">{labelFor(item)}</p>
                  <p className="text-xs text-muted-foreground">{displayDate(item.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
