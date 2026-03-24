import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Paperclip,
  Send,
  Clock,
  User,
  Shield,
  Save,
} from 'lucide-react'
import { apiClient, getAuthHeaders } from '@/lib/api-client'
import { useAuth } from '@/hooks/useAuth'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

interface Attachment {
  id: string
  originalName: string
  fileSize: number
  mimeType: string
  createdAt: string
}

interface Comment {
  id: string
  content: string
  isAdmin: boolean
  createdAt: string
  user: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
    role: string
  }
}

interface TicketData {
  id: string
  ticketNumber: string
  subject: string
  description: string
  category: string
  priority: string
  status: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  userId: string
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
  assignedTo: { id: string; email: string; firstName: string | null; lastName: string | null } | null
  attachments: Attachment[]
  comments: Comment[]
}

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'AWAITING_USER', label: 'Awaiting User' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
]

const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
]

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  OPEN: { variant: 'destructive', label: 'Open' },
  IN_PROGRESS: { variant: 'secondary', label: 'In Progress' },
  AWAITING_USER: { variant: 'outline', label: 'Awaiting User' },
  RESOLVED: { variant: 'default', label: 'Resolved' },
  CLOSED: { variant: 'outline', label: 'Closed' },
}

const CATEGORY_LABELS: Record<string, string> = {
  BUG: 'Bug Report',
  FEATURE_REQUEST: 'Feature Request',
  ACCOUNT_ISSUE: 'Account Issue',
  BILLING: 'Billing',
  OTHER: 'Other',
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AdminTicketDetail() {
  const { id } = useParams<{ id: string }>()
  const { user: authUser } = useAuth()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit fields
  const [editStatus, setEditStatus] = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [saving, setSaving] = useState(false)

  // Comment
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadTicket = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const data = await apiClient<{ ticket: TicketData }>(`/api/admin/tickets/${id}`)
      setTicket(data.ticket)
      setEditStatus(data.ticket.status)
      setEditPriority(data.ticket.priority)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadTicket() }, [loadTicket])

  const handleSave = async () => {
    if (!id || !ticket) return
    setSaving(true)
    try {
      const changes: any = {}
      if (editStatus !== ticket.status) changes.status = editStatus
      if (editPriority !== ticket.priority) changes.priority = editPriority

      if (Object.keys(changes).length === 0) {
        setSaving(false)
        return
      }

      const data = await apiClient<{ ticket: any }>(`/api/admin/tickets/${id}`, {
        method: 'PUT',
        body: JSON.stringify(changes),
      })

      setTicket((prev) => prev ? { ...prev, ...data.ticket } : prev)
      toast.success('Ticket updated')
    } catch {
      toast.error('Failed to update ticket')
    } finally {
      setSaving(false)
    }
  }

  const handleAddComment = async () => {
    if (!comment.trim() || !id) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/admin/tickets/${id}/comments`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ content: comment.trim() }),
      })
      if (!res.ok) throw new Error('Failed to add comment')
      const data = await res.json()
      setTicket((prev) =>
        prev ? { ...prev, comments: [...prev.comments, data.comment] } : prev
      )
      setComment('')
    } catch {
      toast.error('Failed to add comment')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading ticket...
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div>
        <Link to="/admin/tickets" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
        </Link>
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" /> {error || 'Ticket not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusBadge = STATUS_BADGE[ticket.status] || STATUS_BADGE.OPEN
  const userName = ticket.user.firstName
    ? `${ticket.user.firstName}${ticket.user.lastName ? ` ${ticket.user.lastName}` : ''}`
    : ticket.user.email
  const hasChanges = editStatus !== ticket.status || editPriority !== ticket.priority

  return (
    <div>
      <Link to="/admin/tickets" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Link>

      <div className="grid gap-4 lg:grid-cols-[1fr,300px]">
        {/* Main content */}
        <div className="space-y-4">
          {/* Ticket header */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-1">{ticket.ticketNumber}</p>
                  <CardTitle className="text-xl">{ticket.subject}</CardTitle>
                </div>
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{CATEGORY_LABELS[ticket.category] || ticket.category}</span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> {userName} ({ticket.user.email})
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatDate(ticket.createdAt)}
                </span>
                {ticket.resolvedAt && (
                  <span>Resolved {formatDate(ticket.resolvedAt)}</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm">{ticket.description}</div>
            </CardContent>
          </Card>

          {/* Attachments */}
          {ticket.attachments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="h-4 w-4" /> Attachments ({ticket.attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-3">
                  {ticket.attachments.map((att) => (
                    <a
                      key={att.id}
                      href={`${API}/api/admin/tickets/${ticket.id}/attachments/${att.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative h-24 w-24 rounded-md border overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                    >
                      <img
                        src={`${API}/api/admin/tickets/${ticket.id}/attachments/${att.id}`}
                        alt={att.originalName}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                        <p className="text-[9px] text-white truncate">{att.originalName}</p>
                        <p className="text-[8px] text-white/70">{formatBytes(att.fileSize)}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comments ({ticket.comments.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.comments.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No comments yet.
                </p>
              )}

              {ticket.comments.length > 0 && (
                <div className="space-y-4 mb-6">
                  {ticket.comments.map((c) => {
                    const displayName = c.user.firstName
                      ? `${c.user.firstName}${c.user.lastName ? ` ${c.user.lastName}` : ''}`
                      : c.user.email
                    return (
                      <div
                        key={c.id}
                        className={`rounded-lg border p-3 ${
                          c.isAdmin ? 'border-primary/20 bg-primary/5' : 'border-border bg-background'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium ${
                            c.isAdmin ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                          }`}>
                            {c.isAdmin ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          </div>
                          <span className="text-xs font-medium">
                            {displayName}
                            {c.isAdmin && <span className="ml-1 text-primary">(Admin)</span>}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {formatDate(c.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap pl-8">{c.content}</p>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Admin comment form */}
              <div className="flex gap-2">
                <Textarea
                  placeholder="Add an admin response..."
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={2}
                  className="flex-1"
                />
                <Button
                  size="icon"
                  className="shrink-0 self-end h-10 w-10"
                  disabled={!comment.trim() || submitting}
                  onClick={handleAddComment}
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — admin controls */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manage Ticket</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Status</Label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label>Priority</Label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              <Button
                className="w-full"
                disabled={!hasChanges || saving}
                onClick={handleSave}
              >
                {saving ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="mr-2 h-4 w-4" /> Save Changes</>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Ticket #</span>
                <span className="font-mono text-xs">{ticket.ticketNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created by</span>
                <span className="truncate ml-2">{userName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="truncate ml-2">
                  {ticket.assignedTo
                    ? ticket.assignedTo.firstName || ticket.assignedTo.email
                    : 'Unassigned'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{formatDate(ticket.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span>{formatDate(ticket.updatedAt)}</span>
              </div>
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Resolved</span>
                  <span>{formatDate(ticket.resolvedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
