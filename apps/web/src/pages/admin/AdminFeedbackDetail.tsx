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
  Send,
  Clock,
  User,
  Save,
} from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { FeedbackAttachmentLink } from '@/components/feedback/FeedbackAttachmentLink'
import {
  FEEDBACK_PRIORITY_BADGE,
  FEEDBACK_STATUS_BADGE,
  FEEDBACK_TYPE_LABELS,
} from '@/lib/feedback-constants'

interface FeedbackNote {
  id: string
  body: string
  isAdmin: boolean
  createdAt: string
}

interface FeedbackData {
  id: string
  feedbackNumber: string
  type: string
  subject: string | null
  body: string
  status: string
  priority: string | null
  acknowledgedAt: string | null
  createdAt: string
  updatedAt: string
  user: { id: string; email: string; firstName: string | null; lastName: string | null }
  attachments: { id: string; fileName: string }[]
  notes: FeedbackNote[]
}

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: 'CONSIDERED', label: 'Considered (+0.25 pts)' },
  { value: 'IMPLEMENTED', label: 'Implemented' },
  { value: 'PARKED', label: 'Parked' },
]

const PRIORITY_OPTIONS = [
  { value: '', label: 'Unprioritized' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
]

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function AdminFeedbackDetail() {
  const { id } = useParams<{ id: string }>()
  const [feedback, setFeedback] = useState<FeedbackData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [editStatus, setEditStatus] = useState('')
  const [editPriority, setEditPriority] = useState('')
  const [saving, setSaving] = useState(false)

  const [comment, setComment] = useState('')
  const [sendingComment, setSendingComment] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const data = await apiClient<{ feedback: FeedbackData }>(`/api/admin/feedback/${id}`)
      setFeedback(data.feedback)
      setEditStatus(data.feedback.status)
      setEditPriority(data.feedback.priority || '')
      setError(null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function saveChanges() {
    if (!id || !feedback) return
    setSaving(true)
    try {
      const body: { status?: string; priority?: string | null } = {}
      if (editStatus !== feedback.status) body.status = editStatus
      const nextPriority = editPriority || null
      if (nextPriority !== feedback.priority) body.priority = nextPriority
      if (Object.keys(body).length === 0) return

      const data = await apiClient<{ feedback: FeedbackData; pointsAwarded?: number }>(
        `/api/admin/feedback/${id}`,
        {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setFeedback(data.feedback)
      setEditStatus(data.feedback.status)
      setEditPriority(data.feedback.priority || '')
      if (data.pointsAwarded && data.pointsAwarded > 0) {
        toast.success(`User awarded ${data.pointsAwarded} points`)
      } else {
        toast.success('Feedback updated')
      }
    } catch {
      toast.error('Failed to update feedback')
    } finally {
      setSaving(false)
    }
  }

  async function sendComment() {
    if (!id || !comment.trim()) return
    setSendingComment(true)
    try {
      const data = await apiClient<{ note: FeedbackNote }>(`/api/admin/feedback/${id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: comment.trim() }),
      })
      setFeedback((prev) =>
        prev ? { ...prev, notes: [...prev.notes, data.note] } : prev,
      )
      setComment('')
      toast.success('Comment sent to user')
    } catch {
      toast.error('Failed to send comment')
    } finally {
      setSendingComment(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading feedback…
      </div>
    )
  }

  if (error || !feedback) {
    return (
      <div>
        <Link
          to="/admin/feedback"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to feedback
        </Link>
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" /> {error || 'Feedback not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusBadge = FEEDBACK_STATUS_BADGE[feedback.status] || FEEDBACK_STATUS_BADGE.OPEN
  const priorityBadge = feedback.priority ? FEEDBACK_PRIORITY_BADGE[feedback.priority] : null
  const userName = feedback.user.firstName
    ? `${feedback.user.firstName}${feedback.user.lastName ? ` ${feedback.user.lastName}` : ''}`
    : feedback.user.email
  const title = feedback.subject || FEEDBACK_TYPE_LABELS[feedback.type] || feedback.type
  const hasChanges =
    editStatus !== feedback.status || (editPriority || null) !== (feedback.priority || null)

  return (
    <div>
      <Link
        to="/admin/feedback"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to feedback
      </Link>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-1">{feedback.feedbackNumber}</p>
                  <CardTitle className="text-xl">{title}</CardTitle>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  {priorityBadge && (
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${priorityBadge.className}`}
                    >
                      {priorityBadge.label}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-2">
                <span>{FEEDBACK_TYPE_LABELS[feedback.type]}</span>
                <span className="flex items-center gap-1">
                  <User className="h-3 w-3" /> {userName} ({feedback.user.email})
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatDate(feedback.createdAt)}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="whitespace-pre-wrap text-sm">{feedback.body}</div>
              {feedback.attachments.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {feedback.attachments.map((a) => (
                    <FeedbackAttachmentLink
                      key={a.id}
                      href={`/api/admin/feedback/${feedback.id}/attachments/${a.id}`}
                      fileName={a.fileName}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Comments ({feedback.notes.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {feedback.notes.length === 0 && (
                <p className="text-sm text-muted-foreground">No comments yet.</p>
              )}
              {feedback.notes.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-md border p-3 text-sm ${n.isAdmin ? 'border-primary/20 bg-primary/5' : 'bg-muted/30'}`}
                >
                  <p className="text-xs font-medium mb-1">{n.isAdmin ? 'Admin' : 'User'}</p>
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-2">{formatDate(n.createdAt)}</p>
                </div>
              ))}

              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="admin-comment">Send comment to user (optional)</Label>
                <Textarea
                  id="admin-comment"
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Your response visible to the user…"
                />
                <Button
                  size="sm"
                  onClick={sendComment}
                  disabled={sendingComment || !comment.trim()}
                >
                  {sendingComment ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Send comment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Manage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Status</Label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Priority (internal)</Label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {PRIORITY_OPTIONS.map((o) => (
                    <option key={o.value || 'unset'} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button className="w-full" onClick={saveChanges} disabled={saving || !hasChanges}>
                {saving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Save changes
              </Button>
              {editStatus === 'ACKNOWLEDGED' && feedback.status === 'OPEN' && (
                <p className="text-xs text-muted-foreground">
                  Saving as Acknowledged locks user edits on this feedback.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 py-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Feedback #</span>
                <span className="font-mono text-xs">{feedback.feedbackNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span className="text-xs">{formatDate(feedback.createdAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-xs">{formatDate(feedback.updatedAt)}</span>
              </div>
              {feedback.acknowledgedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Acknowledged</span>
                  <span className="text-xs">{formatDate(feedback.acknowledgedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
