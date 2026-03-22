import { useEffect, useState, useCallback } from 'react'
import { apiClient } from '@/lib/api-client'
import { UserTable } from '@/components/admin/UserTable'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

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

export function Users() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

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

  async function handleDelete(id: string) {
    if (!confirm('Are you sure you want to delete this user?')) return
    try {
      await apiClient(`/api/admin/users/${id}`, { method: 'DELETE' })
      fetchUsers()
    } catch (err) {
      console.error('Delete failed:', err)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <p className="text-muted-foreground">{total} registered users</p>
      </div>

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
