import { useState, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Upload, X, Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const TYPES = [
  { value: 'FEEDBACK', label: 'General Feedback' },
  { value: 'ISSUE', label: 'Issue / Bug' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request' },
]

export function NewFeedback() {
  const navigate = useNavigate()
  const [type, setType] = useState('FEEDBACK')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pasteRef = useRef<HTMLDivElement>(null)

  const canSubmit = body.trim().length > 0

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    setFiles((prev) => [...prev, ...picked].slice(0, 5))
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    const imageFiles: File[] = []
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) imageFiles.push(f)
      }
    }
    if (imageFiles.length) {
      e.preventDefault()
      setFiles((prev) => [...prev, ...imageFiles].slice(0, 5))
    }
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('type', type)
      if (subject.trim()) form.append('subject', subject.trim())
      form.append('body', body.trim())
      files.forEach((file) => form.append('attachments', file))

      const token = localStorage.getItem('spashtai_token')
      const res = await fetch(`${API}/api/feedback`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to submit feedback')
      }
      const data = await res.json()
      navigate(`/feedback/${data.feedback.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to submit')
    } finally {
      setLoading(false)
    }
  }

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
          <CardTitle>Provide Feedback</CardTitle>
          <CardDescription>
            Share feedback, report issues, or request features. Earn 0.25 points when an admin marks your
            submission as Considered. Paste screenshots directly into the description.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4" onPaste={handlePaste} ref={pasteRef}>
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="fb-type">Type</Label>
            <select
              id="fb-type"
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
            <Label htmlFor="fb-subject">Subject (optional)</Label>
            <Input
              id="fb-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="fb-body">Description</Label>
            <Textarea
              id="fb-body"
              rows={6}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Describe your feedback… (Ctrl+V to paste screenshots)"
            />
          </div>

          <div className="space-y-2">
            <Label>Attachments</Label>
            <div className="flex flex-wrap gap-2">
              {files.map((file, i) => (
                <div
                  key={`${file.name}-${i}`}
                  className="flex items-center gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <span className="truncate max-w-[140px]">{file.name}</span>
                  <button type="button" onClick={() => removeFile(i)} aria-label="Remove">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
              <Upload className="h-4 w-4" />
              Add files
              <input type="file" className="sr-only" multiple onChange={handleFileChange} />
            </label>
          </div>

          <Button onClick={handleSubmit} disabled={!canSubmit || loading} className="w-full sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              'Submit Feedback'
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
