import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function ExplorerStatus({
  status,
  message,
  onRetry,
}: {
  status: 'idle' | 'loading' | 'error' | 'clarification' | 'unsupported'
  message?: string
  onRetry?: () => void
}) {
  if (status === 'idle') {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="font-medium">Ask a question to see learner aggregates.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Results include the reading of your question, metric cards, and a comparison chart. Learner names stay on their own list.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (status === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true" role="status">
        <p className="text-sm text-muted-foreground">{message ?? 'Loading analytics...'}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
        </div>
      </div>
    )
  }

  if (status === 'clarification') {
    return (
      <Card className="border-amber-500/40 bg-amber-500/5">
        <CardContent className="py-6">
          <p className="text-sm font-medium text-amber-700 dark:text-amber-300">One detail is still ambiguous</p>
          <p className="mt-2 text-sm">{message}</p>
        </CardContent>
      </Card>
    )
  }

  if (status === 'unsupported') {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="font-medium">This question is outside the analytics catalog.</p>
          <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-destructive/30 bg-destructive/5">
      <CardContent className="py-6">
        <p className="font-medium">Analytics could not be loaded.</p>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" className="mt-3" onClick={onRetry}>
            Try again
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
