import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatTimestamp, learnerName } from './format'
import type { IdentityState } from './types'

export function IdentityTable({
  state,
  threshold,
  onPage,
}: {
  state: IdentityState
  threshold: number
  onPage: (page: number) => void
}) {
  const data = state.status === 'ready' ? state.data : null
  const totalPages = data ? Math.max(1, Math.ceil(data.total / Math.max(1, data.pageSize))) : 1

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">Matching learners</CardTitle>
          <Badge variant="outline">Admins only</Badge>
        </div>
        <CardDescription>
          This list includes names and email addresses. Aggregate cards still hide demographic groups smaller than {threshold} learners.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {(state.status === 'idle' || state.status === 'loading') && (
          <div className="space-y-2" aria-busy="true" role="status">
            <p className="text-sm text-muted-foreground">Loading matching learners...</p>
            {[0, 1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}
          </div>
        )}
        {state.status === 'error' && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm">{state.message}</p>
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onPage(state.page)}>
              Try again
            </Button>
          </div>
        )}
        {data && data.total === 0 && (
          <p className="text-sm text-muted-foreground">No learners match this question.</p>
        )}
        {data && data.total > 0 && data.users.length === 0 && (
          <p className="text-sm text-muted-foreground">No learners on this page.</p>
        )}
        {data && data.users.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Learner</th>
                  <th className="px-4 py-3 text-left font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 transition-colors hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Link to={`/admin/users/${user.id}`} className="font-medium hover:underline">
                        {learnerName(user)}
                      </Link>
                      <div className="text-xs text-muted-foreground">{user.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{formatTimestamp(user.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && data.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Page {data.page} of {totalPages} · {data.total} learners
              {state.status === 'ready' && state.refreshing ? ' · Updating...' : ''}
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" disabled={data.page <= 1} onClick={() => onPage(data.page - 1)}>
                Previous
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={data.page >= totalPages} onClick={() => onPage(data.page + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
