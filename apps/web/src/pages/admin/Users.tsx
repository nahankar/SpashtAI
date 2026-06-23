import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useConfirm } from '@/hooks/useConfirm'
import { UserTable } from '@/components/admin/UserTable'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, UserPlus, UserX } from 'lucide-react'

interface UserRow {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  role: string
  lastLoginAt: string | null
  loginCount: number
  createdAt: string
  _count?: { sessions: number; replaySessions: number }
}

interface UsersResponse {
  users: UserRow[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

interface PlatformSettings {
  signupsPaused: boolean
  signupsPausedMessage: string | null
}

export function Users() {
  const confirm = useConfirm()
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [signupsPaused, setSignupsPaused] = useState(false)
  const [signupsMessage, setSignupsMessage] = useState('')
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [togglingSignups, setTogglingSignups] = useState(false)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' })
      if (search) params.set('search', search)

      const data = await apiClient<UsersResponse>(`/api/admin/users?${params}`)
      setUsers(data.users)
      setTotalPages(data.pagination.totalPages)
      setTotal(data.pagination.total)
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    apiClient<{ settings: PlatformSettings }>('/api/admin/platform')
      .then((res) => {
        setSignupsPaused(res.settings.signupsPaused)
        setSignupsMessage(res.settings.signupsPausedMessage ?? '')
      })
      .catch(console.error)
      .finally(() => setSettingsLoading(false))
  }, [])

  async function toggleSignups() {
    const nextPaused = !signupsPaused
    const ok = nextPaused
      ? await confirm({
          title: 'Pause signups?',
          description:
            'New email and Google registrations will be blocked. Existing users can still sign in.',
          confirmLabel: 'Pause signups',
          variant: 'destructive',
        })
      : true
    if (!ok) return

    setTogglingSignups(true)
    try {
      const res = await apiClient<{ settings: PlatformSettings }>('/api/admin/platform/signups', {
        method: 'PUT',
        body: JSON.stringify({ signupsPaused: nextPaused }),
      })
      setSignupsPaused(res.settings.signupsPaused)
      setSignupsMessage(res.settings.signupsPausedMessage ?? '')
      toast.success(nextPaused ? 'Signups paused' : 'Signups resumed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update signup settings')
    } finally {
      setTogglingSignups(false)
    }
  }

  async function handleDelete(id: string) {
    const ok = await confirm({ title: 'Delete User', description: 'Are you sure you want to delete this user? This cannot be undone.', confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await apiClient(`/api/admin/users/${id}`, { method: 'DELETE' })
      toast.success('User deleted')
      fetchUsers()
    } catch (err) {
      console.error('Delete failed:', err)
      toast.error('Failed to delete user.')
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">{total} registered users</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-lg">Registration</CardTitle>
              <CardDescription>
                Pause new signups while you test. Existing accounts can still log in.
              </CardDescription>
            </div>
            <Badge variant={signupsPaused ? 'secondary' : 'default'}>
              {settingsLoading ? '…' : signupsPaused ? 'Signups paused' : 'Signups open'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            variant={signupsPaused ? 'default' : 'destructive'}
            disabled={settingsLoading || togglingSignups}
            onClick={toggleSignups}
          >
            {togglingSignups ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating…
              </>
            ) : signupsPaused ? (
              <>
                <UserPlus className="mr-2 h-4 w-4" />
                Resume signups
              </>
            ) : (
              <>
                <UserX className="mr-2 h-4 w-4" />
                Pause signups
              </>
            )}
          </Button>
          {signupsPaused && signupsMessage && (
            <p className="text-sm text-muted-foreground">{signupsMessage}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Input
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <div className="animate-pulse text-muted-foreground">Loading users...</div>
      ) : (
        <>
          <UserTable users={users} onDelete={handleDelete} />

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
