import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MailPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { InvitationTable } from '@/components/admin/InvitationTable'
import { InviteUserDialog } from '@/components/admin/InviteUserDialog'
import { formatDate } from '@/lib/invitations'
import { SAMPLE_ORG, sampleInvitationList, sampleLearners } from '@/lib/tenantDemoSample'

/**
 * Tenant Admin demo Users (sample data only): accepted users and pending invitees are separate lists, and a pending
 * invitation is never counted as a user. No platform settings appear here. Must be tenant-scoped once real
 * tenancy exists.
 */
export function TenantDemoUsers() {
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const pending = sampleInvitationList({ status: 'pending', pageSize: 10 })
  const q = search.trim().toLowerCase()
  const learners = sampleLearners().filter((l) => !q || l.name.toLowerCase().includes(q) || l.email.includes(q))
  const userCount = sampleLearners().length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            {SAMPLE_ORG}: {userCount} learners (sample data). Pending invitees are listed separately and are not users yet.
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
            <Badge variant="outline">Sample data</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="Search by email or name..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Pending invitees</CardTitle>
              <CardDescription>Invited, not yet accepted. They have no account and are not counted as users.</CardDescription>
            </div>
            <Badge variant="outline">{pending.counts.pending} pending (sample)</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <InvitationTable invitations={pending.items} showStatus={false} />
          <Link to="/admin/invitations" className="inline-block text-sm font-medium text-primary hover:underline">View all invitations</Link>
        </CardContent>
      </Card>

      <InviteUserDialog open={inviteOpen} onOpenChange={setInviteOpen} demo />
    </div>
  )
}
