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
import {
  FEEDBACK_PRIORITY_BADGE,
  FEEDBACK_STATUS_BADGE,
  FEEDBACK_TYPE_LABELS,
  formatRelativeDate,
} from '@/lib/feedback-constants'

interface AdminFeedbackSummary {
  id: string
  feedbackNumber: string
  type: string
  subject: string | null
  body: string
  status: string
  priority: string | null
  createdAt: string
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
  _count: { notes: number; attachments: number }
}

interface FeedbackStats {
  total: number
  open: number
  acknowledged: number
  considered: number
  implemented: number
  parked: number
}

export function AdminFeedback() {
  const [items, setItems] = useState<AdminFeedbackSummary[]>([])
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [listData, statsData] = await Promise.all([
        apiClient<{ feedback: AdminFeedbackSummary[] }>('/api/admin/feedback?limit=100'),
        apiClient<FeedbackStats>('/api/admin/feedback/stats'),
      ])
      setItems(listData.feedback || [])
      setStats(statsData)
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    let result = [...items]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (f) =>
          (f.subject || '').toLowerCase().includes(q) ||
          f.body.toLowerCase().includes(q) ||
          f.feedbackNumber.toLowerCase().includes(q) ||
          f.user.email.toLowerCase().includes(q) ||
          (f.user.firstName || '').toLowerCase().includes(q),
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((f) => f.status === statusFilter)
    }
    if (priorityFilter === 'unset') {
      result = result.filter((f) => !f.priority)
    } else if (priorityFilter !== 'all') {
      result = result.filter((f) => f.priority === priorityFilter)
    }
    return result
  }, [items, search, statusFilter, priorityFilter])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">User Feedback</h1>
        <p className="text-muted-foreground">Review submissions, set priority, and update status</p>
      </div>

      {stats && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: 'Total', value: stats.total, onClick: () => setStatusFilter('all') },
            { label: 'Open', value: stats.open, onClick: () => setStatusFilter('OPEN') },
            { label: 'Acknowledged', value: stats.acknowledged, onClick: () => setStatusFilter('ACKNOWLEDGED') },
            { label: 'Considered', value: stats.considered, onClick: () => setStatusFilter('CONSIDERED') },
            { label: 'Implemented', value: stats.implemented, onClick: () => setStatusFilter('IMPLEMENTED') },
            { label: 'Parked', value: stats.parked, onClick: () => setStatusFilter('PARKED') },
          ].map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={s.onClick}
              className="rounded-md border p-3 text-left hover:bg-accent transition-colors"
            >
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by subject, feedback #, or user email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
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
          <option value="ACKNOWLEDGED">Acknowledged</option>
          <option value="CONSIDERED">Considered</option>
          <option value="IMPLEMENTED">Implemented</option>
          <option value="PARKED">Parked</option>
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All Priorities</option>
          <option value="unset">Unprioritized</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        {(search || statusFilter !== 'all' || priorityFilter !== 'all') && (
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {items.length}
          </span>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading feedback…
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
            {items.length === 0 ? 'No feedback yet.' : 'No feedback matches your filters.'}
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((f) => {
            const statusBadge = FEEDBACK_STATUS_BADGE[f.status] || FEEDBACK_STATUS_BADGE.OPEN
            const priorityBadge = f.priority ? FEEDBACK_PRIORITY_BADGE[f.priority] : null
            const userName = f.user.firstName
              ? `${f.user.firstName}${f.user.lastName ? ` ${f.user.lastName}` : ''}`
              : f.user.email
            const title = f.subject || FEEDBACK_TYPE_LABELS[f.type] || f.type

            return (
              <Card key={f.id} className="transition-all hover:shadow-md">
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted">
                    <span className="text-[9px] font-bold text-muted-foreground text-center leading-tight px-1">
                      {f.feedbackNumber.replace('FB-', '#')}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium truncate">{title}</span>
                      <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                      {priorityBadge ? (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${priorityBadge.className}`}
                        >
                          {priorityBadge.label}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">No priority</span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="text-[10px] font-mono">{f.feedbackNumber}</span>
                      <span>{FEEDBACK_TYPE_LABELS[f.type] || f.type}</span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {userName}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {formatRelativeDate(f.createdAt)}
                      </span>
                      {f._count.notes > 0 && (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="h-3 w-3" />
                          {f._count.notes}
                        </span>
                      )}
                      {f._count.attachments > 0 && (
                        <span className="flex items-center gap-1">
                          <Paperclip className="h-3 w-3" />
                          {f._count.attachments}
                        </span>
                      )}
                    </div>
                  </div>

                  <Link to={`/admin/feedback/${f.id}`}>
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
