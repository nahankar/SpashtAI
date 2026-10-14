import { Button } from '@/components/ui/button'

export function AnalyticsStatus({
  state,
  onRetry,
}: {
  state: 'loading' | 'error' | 'empty' | 'ready'
  onRetry?: () => void
}) {
  if (state === 'loading') {
    return (
      <div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-lg bg-muted" />)}
      </div>
    )
  }
  if (state === 'error') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <p className="font-medium">Analytics could not be loaded.</p>
        <Button type="button" className="mt-3" variant="outline" onClick={onRetry}>Try again</Button>
      </div>
    )
  }
  if (state === 'empty') {
    return <div className="rounded-lg border p-6 text-sm text-muted-foreground">No learner activity matches these filters yet.</div>
  }
  return null
}
