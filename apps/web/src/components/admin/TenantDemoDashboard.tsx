import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, MailPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MetricCard } from '@/components/admin/MetricCard'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { InviteUserDialog } from '@/components/admin/InviteUserDialog'
import { useTenantDemo } from '@/contexts/TenantDemoContext'
import { INVITATION_STATUSES, STATUS_LABEL, listInvitations, type InvitationList } from '@/lib/invitations'
import { sampleInvitationList, sampleLearners } from '@/lib/tenantDemoSample'

/**
 * Tenant Admin demo Dashboard. With sample data everything is fictional; with live data it is platform-wide.
 * Once real tenancy exists, these counts and lists must come from the active tenant only.
 */
export function TenantDemoDashboard() {
  const { dataSource } = useTenantDemo()
  const sample = dataSource === 'sample'
  const [pending, setPending] = useState<InvitationList | null>(null)
  const [learners, setLearners] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  const load = useCallback(async () => {
    setError('')
    if (sample) {
      setPending(sampleInvitationList({ status: 'pending', pageSize: 5 }))
      setLearners(sampleLearners().length)
      return
    }
    setPending(null)
    setLearners(null)
    try {
      const [list, overview] = await Promise.all([
        listInvitations({ status: 'pending', pageSize: 5 }),
        apiClient<{ users: { total: number } }>('/api/admin/analytics/overview'),
      ])
      setPending(list)
      setLearners(overview.users.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load invitations')
    }
  }, [sample])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Learners and invitations{sample ? ' (sample data)' : ' (live, platform-wide)'}
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><MailPlus className="mr-2 h-4 w-4" /> Invite user</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard label={sample ? 'Learners (sample)' : 'User accounts (platform)'} value={learners ?? '—'} sublabel="Pending invitations are not counted" />
        {INVITATION_STATUSES.map((status) => (
          <MetricCard key={status} label={`${STATUS_LABEL[status]} invitations`} value={pending ? pending.counts[status] : '—'} />
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
          {!pending && !error && <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>}
          {pending && pending.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-10 text-center">
              <Inbox className="h-8 w-8 text-muted-foreground" />
              <p className="font-medium">No pending invitations</p>
              <p className="text-sm text-muted-foreground">Everyone you invited has responded, or no one has been invited yet.</p>
              <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>Invite user</Button>
            </div>
          )}
          {pending && pending.items.length > 0 && (
            <>
              <InvitationTable invitations={pending.items} onChanged={load} showStatus={false} />
              {sample && <p className="mt-2 text-xs text-muted-foreground">Sample rows are fictional, so Resend and Revoke are disabled. Switch to live data to manage real invitations.</p>}
            </>
          )}
        </CardContent>
      </Card>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={load} demo />
    </div>
  )
}
