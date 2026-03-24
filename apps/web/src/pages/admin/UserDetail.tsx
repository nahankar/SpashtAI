import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useConfirm } from '@/hooks/useConfirm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface UserDetailData {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  avatar: string | null
  role: string
  emailVerified: boolean
  lastLoginAt: string | null
  lastActiveAt: string | null
  loginCount: number
  createdAt: string
  updatedAt: string
  _count: { sessions: number; replaySessions: number; featureUsage: number }
}

interface Activity {
  id: string
  action: string
  resource: string | null
  ipAddress: string | null
  timestamp: string
}

export function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [user, setUser] = useState<UserDetailData | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return

    Promise.all([
      apiClient<{ user: UserDetailData }>(`/api/admin/users/${id}`),
      apiClient<{ activities: Activity[] }>(`/api/admin/users/${id}/activity`),
    ])
      .then(([userData, activityData]) => {
        setUser(userData.user)
        setActivities(activityData.activities)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleChangeRole(newRole: string) {
    if (!id) return
    try {
      const data = await apiClient<{ user: { role: string } }>(`/api/admin/users/${id}/change-role`, {
        method: 'POST',
        body: JSON.stringify({ role: newRole }),
      })
      setUser((prev) => prev ? { ...prev, role: data.user.role } : null)
    } catch (err) {
      console.error('Failed to change role:', err)
    }
  }

  async function handleDelete() {
    if (!id) return
    const ok = await confirm({ title: 'Delete User', description: 'Are you sure you want to delete this user? This cannot be undone.', confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await apiClient(`/api/admin/users/${id}`, { method: 'DELETE' })
      toast.success('User deleted')
      navigate('/admin/users')
    } catch (err) {
      console.error('Failed to delete user:', err)
      toast.error('Failed to delete user.')
    }
  }

  if (loading) {
    return <div className="animate-pulse text-muted-foreground">Loading user details...</div>
  }

  if (!user) {
    return <div className="text-muted-foreground">User not found.</div>
  }

  const displayName = user.firstName || user.lastName
    ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim()
    : user.email

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
            &larr; Back to Users
          </Link>
          <h1 className="text-2xl font-bold tracking-tight mt-1">{displayName}</h1>
          <p className="text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="text-destructive" onClick={handleDelete}>
            Delete User
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Role</span>
              <Badge variant={user.role === 'SUPER_ADMIN' ? 'destructive' : user.role === 'ADMIN' ? 'default' : 'secondary'}>
                {user.role}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verified</span>
              <span>{user.emailVerified ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Joined</span>
              <span>{new Date(user.createdAt).toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Login Count</span>
              <span>{user.loginCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Last Login</span>
              <span>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : 'Never'}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Usage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Elevate Sessions</span>
              <span className="font-medium">{user._count.sessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Replay Sessions</span>
              <span className="font-medium">{user._count.replaySessions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Feature Usage Events</span>
              <span className="font-medium">{user._count.featureUsage}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">Change role:</div>
            <div className="flex flex-wrap gap-2">
              {['USER', 'ADMIN', 'SUPER_ADMIN'].map((role) => (
                <Button
                  key={role}
                  variant={user.role === role ? 'default' : 'outline'}
                  size="sm"
                  disabled={user.role === role}
                  onClick={() => handleChangeRole(role)}
                >
                  {role}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {activities.slice(0, 20).map((a) => (
                <div key={a.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2">
                  <div>
                    <span className="font-medium">{a.action}</span>
                    {a.resource && <span className="text-muted-foreground ml-2">{a.resource}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(a.timestamp).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
