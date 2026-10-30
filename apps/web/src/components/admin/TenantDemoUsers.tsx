import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { MailPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { InviteUserDialog } from '@/components/admin/InviteUserDialog'
import { UserTable } from '@/components/admin/UserTable'
import { useTenantDemo } from '@/contexts/TenantDemoContext'
import { formatDate, listInvitations, type InvitationList } from '@/lib/invitations'
import { sampleInvitationList, sampleLearners } from '@/lib/tenantDemoSample'

interface LiveUsers {
  users: Parameters<typeof UserTable>[0]['users']
  pagination: { total: number }
}

/**
 * Tenant Admin demo Users: accepted accounts and pending invitees are separate lists, and a pending invitation is
 * never counted as a user. No platform settings appear here. Must be tenant-scoped once real tenancy exists.
 */
export function TenantDemoUsers() {
  const { dataSource } = useTenantDemo()
  const sample = dataSource === 'sample'
  const [search, setSearch] = useState('')
  const [live, setLive] = useState<LiveUsers | null>(null)
  const [pending, setPending] = useState<InvitationList | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const loadPending = useCallback(() => {
    if (sample) setPending(sampleInvitationList({ status: 'pending', pageSize: 10 }))
    else listInvitations({ status: 'pending', pageSize: 10 }).then(setPending).catch(() => setPending(null))
  }, [sample])

  useEffect(() => { loadPending() }, [loadPending])

  useEffect(() => {
    if (sample) return
    const params = new URLSearchParams({ page: '1', limit: '20' })
    if (search.trim()) params.set('search', search.trim())
    apiClient<LiveUsers>(`/api/admin/users?${params}`).then(setLive).catch(() => setLive(null))
  }, [sample, search])

  const q = search.trim().toLowerCase()
  const learners = sampleLearners().filter((l) => !q || l.name.toLowerCase().includes(q) || l.email.includes(q))
  const userCount = sample ? sampleLearners().length : live?.pagination.total

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            {userCount ?? '…'} {sample ? 'sample learners' : 'accounts (platform-wide)'}. Pending invitees are listed separately and are not users yet.
          </p>
        </div>
        <Button onClick={() => setInviteOpen(true)}><MailPlus className="mr-2 h-4 w-4" /> Invite user</Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Accepted users</CardTitle>
              <CardDescription>People with a SpashtAI account.</CardDescription>
            </div>
            {sample && <Badge variant="outline">Sample data</Badge>}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Search by email or name..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
          {sample ? (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-3 text-left font-medium">Learner</th>
                    <th className="px-4 py-3 text-left font-medium">Sessions</th>
                    <th className="px-4 py-3 text-left font-medium">Last active</th>
                    <th className="px-4 py-3 text-left font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {learners.map((l) => (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="px-4 py-3"><div className="font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.email}</div></td>
                      <td className="px-4 py-3 text-muted-foreground">{l.sessions}</td>
                      <td className="px-4 py-3 text-muted-foreground">{l.lastActiveAt ? formatDate(l.lastActiveAt) : 'Never'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(l.joinedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : live ? (
            <UserTable users={live.users} />
          ) : (
            <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Pending invitees</CardTitle>
              <CardDescription>Invited, not yet accepted. They have no account and are not counted as users.</CardDescription>
            </div>
            <Badge variant="outline">{pending ? `${pending.counts.pending} pending` : '…'}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending && pending.items.length > 0
            ? <InvitationTable invitations={pending.items} onChanged={loadPending} showStatus={false} />
            : <p className="text-sm text-muted-foreground">{pending ? 'No pending invitations.' : 'Loading…'}</p>}
          <Link to="/admin/invitations" className="inline-block text-sm font-medium text-primary hover:underline">View all invitations</Link>
        </CardContent>
      </Card>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} onSent={loadPending} demo />
    </div>
  )
}
