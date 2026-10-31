import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, MailPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/admin/MetricCard'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { InviteUserDialog } from '@/components/admin/InviteUserDialog'
import { INVITATION_STATUSES, STATUS_LABEL, listInvitations, type InvitationList } from '@/lib/invitations'
import { sampleInvitationList } from '@/lib/tenantDemoSample'

const TABLE_SIZE = 5

/**
 * Invitation counts and the pending invitations table for a Dashboard. Counts and rows come from one list
 * response, so the Pending count always matches the table's total. `sample` renders fictional demo rows; the
 * live view is platform-wide and must be tenant-scoped once real tenancy exists.
 */
export function InvitationOverview({ sample = false }: { sample?: boolean }) {
  const [data, setData] = useState<InvitationList | null>(null)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  const load = useCallback(async () => {
    setError('')
    if (sample) {
      setData(sampleInvitationList({ status: 'pending', pageSize: TABLE_SIZE }))
      return
    }
    try {
      setData(await listInvitations({ status: 'pending', pageSize: TABLE_SIZE }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invitations')
    }
  }, [sample])

  useEffect(() => { load() }, [load])

  return (
    <section className="space-y-4" aria-labelledby="invitation-overview-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="invitation-overview-title" className="text-lg font-semibold">Invitations</h2>
          <p className="text-sm text-muted-foreground">
            {sample ? 'Sample data. ' : ''}Invitation counts are separate from user and activity counts: a pending invitation is not a user.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><MailPlus className="mr-2 h-4 w-4" /> Invite user</Button>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {INVITATION_STATUSES.map((status) => (
          <MetricCard key={status} label={`${STATUS_LABEL[status]} invitations`} value={data ? data.counts[status] : '—'} />
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Pending invitations</CardTitle>
              <CardDescription>
                Delivery status is shown separately: an email can fail while the invitation stays pending.
              </CardDescription>
            </div>
            <Button asChild variant="outline" size="sm"><Link to="/admin/invitations">View all invitations</Link></Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!data && !error && <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>}
          {data && data.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No pending invitations</p>
              <p className="text-sm text-muted-foreground">Everyone invited has responded, or no one has been invited yet.</p>
              <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>Invite user</Button>
            </div>
          )}
          {data && data.items.length > 0 && (
            <>
              <InvitationTable invitations={data.items} onChanged={load} showStatus={false} />
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {data.items.length} of {data.total} pending.
                {sample && ' Sample rows are fictional, so Resend and Revoke are disabled.'}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={sample ? undefined : load} demo={sample} />
    </section>
  )
}
