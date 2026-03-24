import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Calendar,
  MessageSquare,
  Loader2,
  AlertCircle,
  ArrowRight,
  Paperclip,
  User,
  Search,
  X,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'

interface AdminTicketSummary {
  id: string
  ticketNumber: string
  subject: string
  category: string
  priority: string
  status: string
  createdAt: string
  updatedAt: string
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
  assignedTo: { id: string; email: string; firstName: string | null } | null
  _count: { comments: number; attachments: number }
}

interface TicketStats {
  total: number
  open: number
  inProgress: number
  awaitingUser: number
  resolved: number
  closed: number
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  OPEN: { variant: 'destructive', label: 'Open' },
  IN_PROGRESS: { variant: 'secondary', label: 'In Progress' },
  AWAITING_USER: { variant: 'outline', label: 'Awaiting User' },
  RESOLVED: { variant: 'default', label: 'Resolved' },
  CLOSED: { variant: 'outline', label: 'Closed' },
}

const PRIORITY_BADGE: Record<string, { className: string; label: string }> = {
  LOW: { className: 'bg-slate-100 text-slate-700 border-slate-200', label: 'Low' },
  MEDIUM: { className: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Medium' },
  HIGH: { className: 'bg-orange-100 text-orange-700 border-orange-200', label: 'High' },
  CRITICAL: { className: 'bg-red-100 text-red-700 border-red-200', label: 'Critical' },
}

const CATEGORY_LABELS: Record<string, string> = {
  BUG: 'Bug',
  FEATURE_REQUEST: 'Feature',
  ACCOUNT_ISSUE: 'Account',
  BILLING: 'Billing',
  OTHER: 'Other',
}

export function AdminTickets() {
  const [tickets, setTickets] = useState<AdminTicketSummary[]>([])
  const [stats, setStats] = useState<TicketStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [ticketData, statsData] = await Promise.all([
        apiClient<{ tickets: AdminTicketSummary[] }>('/api/admin/tickets?limit=100'),
        apiClient<TicketStats>('/api/admin/tickets/stats'),
      ])
      setTickets(ticketData.tickets || [])
      setStats(statsData)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    let result = [...tickets]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.ticketNumber.toLowerCase().includes(q) ||
          t.user.email.toLowerCase().includes(q) ||
          (t.user.firstName || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter)
    }
    if (priorityFilter !== 'all') {
      result = result.filter((t) => t.priority === priorityFilter)
    }
    return result
  }, [tickets, search, statusFilter, priorityFilter])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">Manage user support tickets</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Total', value: stats.total, onClick: () => setStatusFilter('all') },
            { label: 'Open', value: stats.open, onClick: () => setStatusFilter('OPEN') },
            { label: 'In Progress', value: stats.inProgress, onClick: () => setStatusFilter('IN_PROGRESS') },
            { label: 'Awaiting User', value: stats.awaitingUser, onClick: () => setStatusFilter('AWAITING_USER') },
            { label: 'Resolved', value: stats.resolved, onClick: () => setStatusFilter('RESOLVED') },
            { label: 'Closed', value: stats.closed, onClick: () => setStatusFilter('CLOSED') },
          ].map((s) => (
            <button
              key={s.label}
              onClick={s.onClick}
              className="rounded-md border p-3 text-left hover:bg-accent transition-colors"
            >
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by subject, ticket #, or user email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Statuses</option>
          <option value="OPEN">Open</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="AWAITING_USER">Awaiting User</option>
          <option value="RESOLVED">Resolved</option>
          <option value="CLOSED">Closed</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Priorities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        {(search || statusFilter !== 'all' || priorityFilter !== 'all') && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {tickets.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading tickets...
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" /> {error}
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tickets.length === 0 ? 'No tickets yet.' : 'No tickets match your filters.'}
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const statusBadge = STATUS_BADGE[t.status] || STATUS_BADGE.OPEN
            const priorityBadge = PRIORITY_BADGE[t.priority] || PRIORITY_BADGE.MEDIUM
            const userName = t.user.firstName
              ? `${t.user.firstName}${t.user.lastName ? ` ${t.user.lastName}` : ''}`
              : t.user.email
            return (
              <Card key={t.id} className="transition-all hover:shadow-md">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted">
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {t.ticketNumber.replace('TKT-', '#')}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{t.subject}</span>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${priorityBadge.className}`}>
                        {priorityBadge.label}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="text-[10px] font-mono">{t.ticketNumber}</span>
                      <span>{CATEGORY_LABELS[t.category] || t.category}</span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {userName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatRelativeDate(t.createdAt)}
                      </span>
                      {t._count.comments > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {t._count.comments}
                        </span>
                      )}
                      {t._count.attachments > 0 && (
                        <span className="flex items-center gap-1">
                          <Paperclip className="h-3 w-3" />
                          {t._count.attachments}
                        </span>
                      )}
                    </div>
                  </div>

                  <Link to={`/admin/tickets/${t.id}`}>
                    <Button size="sm" variant="outline">
                      Manage <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
