import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Paperclip,
  Send,
  Clock,
  User,
  Shield,
} from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
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
  attachments: Attachment[]
  comments: Comment[]
  assignedTo: {
    id: string
    firstName: string | null
    lastName: string | null
    email: string
  } | null
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
  BUG: 'Bug Report',
  FEATURE_REQUEST: 'Feature Request',
  ACCOUNT_ISSUE: 'Account Issue',
  BILLING: 'Billing',
  OTHER: 'Other',
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TicketDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const loadTicket = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const res = await fetch(`${API}/api/tickets/${id}`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load ticket')
      const data = await res.json()
      setTicket(data.ticket)
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadTicket() }, [loadTicket])

  const handleAddComment = async () => {
    if (!comment.trim() || !id) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API}/api/tickets/${id}/comments`, {
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
        <Link to="/tickets" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
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
  const priorityBadge = PRIORITY_BADGE[ticket.priority] || PRIORITY_BADGE.MEDIUM
  const isClosed = ticket.status === 'CLOSED' || ticket.status === 'RESOLVED'

  return (
    <div>
      <Link to="/tickets" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Link>

      {/* Ticket header */}
      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-mono text-muted-foreground mb-1">{ticket.ticketNumber}</p>
              <CardTitle className="text-xl">{ticket.subject}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${priorityBadge.className}`}>
                {priorityBadge.label}
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>{CATEGORY_LABELS[ticket.category] || ticket.category}</span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {formatDate(ticket.createdAt)}
            </span>
            {ticket.assignedTo && (
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Assigned to {ticket.assignedTo.firstName || ticket.assignedTo.email}
              </span>
            )}
            {ticket.resolvedAt && (
              <span className="flex items-center gap-1">
                Resolved {formatDate(ticket.resolvedAt)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="whitespace-pre-wrap text-sm">{ticket.description}</div>
        </CardContent>
      </Card>

      {/* Attachments */}
      {ticket.attachments.length > 0 && (
        <Card className="mb-4">
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
                  href={`${API}/api/tickets/${ticket.id}/attachments/${att.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative h-24 w-24 rounded-md border overflow-hidden hover:ring-2 hover:ring-primary transition-all"
                >
                  <img
                    src={`${API}/api/tickets/${ticket.id}/attachments/${att.id}`}
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
          <CardTitle className="text-base">
            Comments ({ticket.comments.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {ticket.comments.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No comments yet. Add a comment below.
            </p>
          )}

          {ticket.comments.length > 0 && (
            <div className="space-y-4 mb-6">
              {ticket.comments.map((c) => {
                const isMe = c.user.id === user?.id
                const displayName = c.user.firstName
                  ? `${c.user.firstName}${c.user.lastName ? ` ${c.user.lastName}` : ''}`
                  : c.user.email

                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border p-3 ${
                      c.isAdmin
                        ? 'border-primary/20 bg-primary/5'
                        : 'border-border bg-background'
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
                        {c.isAdmin && <span className="ml-1 text-primary">(Support)</span>}
                        {isMe && !c.isAdmin && <span className="ml-1 text-muted-foreground">(You)</span>}
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

          {/* Add comment form */}
          {!isClosed && (
            <div className="flex gap-2">
              <Textarea
                placeholder="Add a comment..."
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
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          )}

          {isClosed && (
            <p className="text-sm text-muted-foreground text-center py-2">
              This ticket is {ticket.status.toLowerCase().replace('_', ' ')}. No further comments can be added.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
