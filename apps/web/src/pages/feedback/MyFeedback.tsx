import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, MessageSquarePlus, Pencil } from 'lucide-react'
import { FEEDBACK_STATUS_BADGE, FEEDBACK_TYPE_LABELS } from '@/lib/feedback-constants'

interface FeedbackItem {
  id: string
  feedbackNumber: string
  type: string
  subject: string | null
  body: string
  status: string
  createdAt: string
  notes: { isAdmin: boolean }[]
}

export function MyFeedback() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiClient<{ feedback: FeedbackItem[] }>('/api/feedback/mine')
      .then((res) => setItems(res.feedback))
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading feedback…
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Feedback</h1>
          <p className="text-muted-foreground text-sm">
            Track submissions and admin responses (earn points). Edit while status is Open.
          </p>
        </div>
        <Link to="/feedback/new">
          <Button>
            <MessageSquarePlus className="mr-2 h-4 w-4" /> Provide Feedback (earn points)
          </Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No feedback yet. Share your thoughts — earn 0.25 points when an admin marks your submission as Considered.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const statusBadge = FEEDBACK_STATUS_BADGE[item.status] || FEEDBACK_STATUS_BADGE.OPEN
            const title = item.subject || FEEDBACK_TYPE_LABELS[item.type] || item.type
            const hasAdminReply = item.notes.some((n) => n.isAdmin)
            const canEdit = item.status === 'OPEN'

            return (
              <Card key={item.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-mono text-muted-foreground">{item.feedbackNumber}</p>
                      <CardTitle className="text-base">{title}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm line-clamp-3 whitespace-pre-wrap">{item.body}</p>
                  {hasAdminReply && (
                    <p className="text-xs text-primary">Admin has responded — view details</p>
                  )}
                  <div className="flex gap-2">
                    <Link to={`/feedback/${item.id}`}>
                      <Button size="sm" variant="outline">
                        {canEdit ? (
                          <>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" /> View / Edit
                          </>
                        ) : (
                          'View details'
                        )}
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
