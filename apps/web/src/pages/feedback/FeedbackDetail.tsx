import { useState, useEffect, useCallback, useContext } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Loader2, AlertCircle, Upload, X, Save } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { FeedbackAttachmentLink } from '@/components/feedback/FeedbackAttachmentLink'
import { FEEDBACK_STATUS_BADGE, FEEDBACK_TYPE_LABELS } from '@/lib/feedback-constants'
import { AuthContext } from '@/contexts/AuthContext'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const TYPES = [
  { value: 'FEEDBACK', label: 'General Feedback' },
  { value: 'ISSUE', label: 'Issue / Bug' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request' },
]

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
  pointsAwarded?: boolean
  attachments: { id: string; fileName: string }[]
  notes: FeedbackNote[]
  createdAt: string
}

export function FeedbackDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { updateUser } = useContext(AuthContext)!
  const [feedback, setFeedback] = useState<FeedbackData | null>(null)
  const [editable, setEditable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [type, setType] = useState('FEEDBACK')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      setLoading(true)
      const data = await apiClient<{ feedback: FeedbackData; editable: boolean }>(
        `/api/feedback/${id}`,
      )
      setFeedback(data.feedback)
      setEditable(data.editable)
      setType(data.feedback.type)
      setSubject(data.feedback.subject || '')
      setBody(data.feedback.body)
      setError(null)
      if (data.feedback.status === 'CONSIDERED' && data.feedback.pointsAwarded) {
        const me = await apiClient<{ user: { rewardPoints?: number } }>('/api/auth/me')
        if (me.user.rewardPoints != null) {
          updateUser({ rewardPoints: me.user.rewardPoints })
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load feedback')
    } finally {
      setLoading(false)
    }
  }, [id, updateUser])

  useEffect(() => {
    load()
  }, [load])

  const handleSave = async () => {
    if (!id || !body.trim()) return
    setSaving(true)
    try {
      const form = new FormData()
      form.append('type', type)
      if (subject.trim()) form.append('subject', subject.trim())
      form.append('body', body.trim())
      newFiles.forEach((file) => form.append('attachments', file))

      const token = localStorage.getItem('spashtai_token')
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`

      const res = await fetch(`${API}/api/feedback/${id}`, {
        method: 'PUT',
        headers,
        body: form,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save')
      }
      const data = await res.json()
      setFeedback(data.feedback)
      setEditable(data.editable)
      setNewFiles([])
      toast.success('Feedback updated')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  if (error || !feedback) {
    return (
      <div>
        <Link
          to="/feedback"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Feedback
        </Link>
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" /> {error || 'Not found'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusBadge = FEEDBACK_STATUS_BADGE[feedback.status] || FEEDBACK_STATUS_BADGE.OPEN
  const title = feedback.subject || FEEDBACK_TYPE_LABELS[feedback.type] || feedback.type
  const adminNotes = feedback.notes.filter((n) => n.isAdmin)

  return (
    <div>
      <Link
        to="/feedback"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Feedback
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-mono text-muted-foreground">{feedback.feedbackNumber}</p>
              <CardTitle>{editable ? 'Edit Feedback' : title}</CardTitle>
              <CardDescription>
                Submitted {new Date(feedback.createdAt).toLocaleString()}
              </CardDescription>
            </div>
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!editable && feedback.status === 'ACKNOWLEDGED' && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This feedback has been acknowledged by an admin and can no longer be edited.
            </p>
          )}
          {!editable && feedback.status === 'CONSIDERED' && feedback.pointsAwarded && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Your feedback was considered — 0.25 points have been added to your account.
            </p>
          )}
          {!editable && feedback.status === 'CONSIDERED' && !feedback.pointsAwarded && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              This feedback has been marked as considered and can no longer be edited.
            </p>
          )}

          {editable ? (
            <>
              <div className="space-y-1">
                <Label htmlFor="type">Type</Label>
                <select
                  id="type"
                  className="flex h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="subject">Subject (optional)</Label>
                <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="body">Description</Label>
                <Textarea id="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
              {feedback.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {feedback.attachments.map((a) => (
                    <FeedbackAttachmentLink
                      key={a.id}
                      href={`/api/feedback/${feedback.id}/attachments/${a.id}`}
                      fileName={a.fileName}
                    />
                  ))}
                </div>
              )}
              <div className="space-y-2">
                <Label>Add attachments</Label>
                <div className="flex flex-wrap gap-2">
                  {newFiles.map((file, i) => (
                    <div key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs">
                      <span className="truncate max-w-[140px]">{file.name}</span>
                      <button type="button" onClick={() => setNewFiles((p) => p.filter((_, j) => j !== i))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <Upload className="h-4 w-4" />
                  Add files
                  <input
                    type="file"
                    className="sr-only"
                    multiple
                    onChange={(e) => {
                      const picked = Array.from(e.target.files || [])
                      setNewFiles((p) => [...p, ...picked].slice(0, 5))
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSave} disabled={saving || !body.trim()}>
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save changes
                </Button>
                <Button variant="outline" onClick={() => navigate('/feedback')}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm whitespace-pre-wrap">{feedback.body}</p>
              {feedback.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {feedback.attachments.map((a) => (
                    <FeedbackAttachmentLink
                      key={a.id}
                      href={`/api/feedback/${feedback.id}/attachments/${a.id}`}
                      fileName={a.fileName}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {adminNotes.length > 0 && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
              <p className="text-xs font-semibold text-primary">Admin response</p>
              {adminNotes.map((n) => (
                <div key={n.id} className="text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
