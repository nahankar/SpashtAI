import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Calendar,
  MessageSquare,
  Loader2,
  AlertCircle,
  FileText,
  Paperclip,
  ArrowRight,
} from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

interface TicketSummary {
  id: string
  ticketNumber: string
  subject: string
  category: string
  priority: string
  status: string
  createdAt: string
  updatedAt: string
  _count: { comments: number; attachments: number }
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
  AWAITING_USER: { variant: 'outline', label: 'Awaiting You' },
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
  FEATURE_REQUEST: 'Feature Request',
  ACCOUNT_ISSUE: 'Account Issue',
  BILLING: 'Billing',
  OTHER: 'Other',
}

export function Tickets() {
  const [tickets, setTickets] = useState<TicketSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('all')

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API}/api/tickets`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error('Failed to load tickets')
      const data = await res.json()
      setTickets(data.tickets || [])
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTickets() }, [loadTickets])

  const filtered = useMemo(() => {
    let result = [...tickets]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.ticketNumber.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((t) => t.status === statusFilter)
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'name':
          cmp = a.subject.localeCompare(b.subject)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [tickets, search, sortField, sortDir, statusFilter])

  const sortOptions: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Subject' },
    { value: 'status', label: 'Status' },
  ]

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'OPEN', label: 'Open' },
    { value: 'IN_PROGRESS', label: 'In Progress' },
    { value: 'AWAITING_USER', label: 'Awaiting You' },
    { value: 'RESOLVED', label: 'Resolved' },
    { value: 'CLOSED', label: 'Closed' },
  ]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Tickets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your support requests and issues.
          </p>
        </div>
        <Link to="/tickets/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> New Ticket
          </Button>
        </Link>
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

      {!loading && !error && tickets.length > 0 && (
        <div className="mb-4">
          <SessionFilters
            search={search}
            onSearchChange={setSearch}
            sortField={sortField}
            sortDir={sortDir}
            onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
            sortOptions={sortOptions}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            statusOptions={statusOptions}
            totalCount={tickets.length}
            filteredCount={filtered.length}
          />
        </div>
      )}

      {!loading && !error && tickets.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">No tickets yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a ticket to report an issue or request a feature.
            </p>
            <Link to="/tickets/new">
              <Button className="mt-4">
                <Plus className="mr-2 h-4 w-4" /> Create Your First Ticket
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {!loading && !error && tickets.length > 0 && filtered.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No tickets match your filters.
          </CardContent>
        </Card>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const statusBadge = STATUS_BADGE[t.status] || STATUS_BADGE.OPEN
            const priorityBadge = PRIORITY_BADGE[t.priority] || PRIORITY_BADGE.MEDIUM
            return (
              <Card key={t.id} className="transition-all hover:shadow-md">
                <CardContent className="flex items-center gap-4 py-4">
                  {/* Ticket number circle */}
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted">
                    <span className="text-[10px] font-bold text-muted-foreground">
                      {t.ticketNumber.replace('TKT-', '#')}
                    </span>
                  </div>

                  {/* Details */}
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

                  {/* Action */}
                  <Link to={`/tickets/${t.id}`}>
                    <Button size="sm" variant="outline">
                      View <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
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
