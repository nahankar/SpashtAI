import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
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

interface UserTableProps {
  users: UserRow[]
  onDelete?: (id: string) => void
}

function roleBadgeVariant(role: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (role === 'SUPER_ADMIN') return 'destructive'
  if (role === 'ADMIN') return 'default'
  return 'secondary'
}

export function UserTable({ users, onDelete }: UserTableProps) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-3 text-left font-medium">User</th>
            <th className="px-4 py-3 text-left font-medium">Role</th>
            <th className="px-4 py-3 text-left font-medium">Sessions</th>
            <th className="px-4 py-3 text-left font-medium">Last Login</th>
            <th className="px-4 py-3 text-left font-medium">Joined</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <Link to={`/admin/users/${user.id}`} className="hover:underline">
                  <div className="font-medium">{user.firstName || user.lastName ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : user.email}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </Link>
              </td>
              <td className="px-4 py-3">
                <Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {user._count ? `${user._count.sessions + user._count.replaySessions}` : '—'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString() : 'Never'}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(user.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="flex justify-end gap-2">
                  <Link to={`/admin/users/${user.id}`}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                  {onDelete && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => onDelete(user.id)}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                No users found
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
