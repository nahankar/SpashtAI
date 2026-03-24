import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ArrowLeft, Upload, X, Loader2 } from 'lucide-react'

const API = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:4000'

const CATEGORIES = [
  { value: 'BUG', label: 'Bug Report' },
  { value: 'FEATURE_REQUEST', label: 'Feature Request' },
  { value: 'ACCOUNT_ISSUE', label: 'Account Issue' },
  { value: 'BILLING', label: 'Billing' },
  { value: 'OTHER', label: 'Other' },
]

export function NewTicket() {
  const navigate = useNavigate()
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [screenshots, setScreenshots] = useState<File[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = subject.trim() && category && description.trim()

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    setScreenshots((prev) => [...prev, ...imageFiles].slice(0, 5))
    e.target.value = ''
  }

  const removeFile = (index: number) => {
    setScreenshots((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)

    try {
      const form = new FormData()
      form.append('subject', subject.trim())
      form.append('category', category)
      form.append('description', description.trim())
      screenshots.forEach((file) => form.append('screenshots', file))

      const token = localStorage.getItem('spashtai_token')
      const res = await fetch(`${API}/api/tickets`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to create ticket')
      }

      const data = await res.json()
      navigate(`/tickets/${data.ticket.id}`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <Link
        to="/tickets"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to tickets
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New Support Ticket</CardTitle>
          <CardDescription>
            Describe your issue and we'll get back to you as soon as possible.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="subject">Subject *</Label>
            <input
              id="subject"
              type="text"
              placeholder="Brief summary of the issue"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="category">Category *</Label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select category...</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe the issue in detail. Include steps to reproduce if applicable."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
            />
          </div>

          <div className="grid gap-2">
            <Label>Screenshots (optional, max 5)</Label>
            <div className="flex flex-wrap gap-3">
              {screenshots.map((file, i) => (
                <div
                  key={i}
                  className="relative group h-20 w-20 rounded-md border overflow-hidden"
                >
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    onClick={() => removeFile(i)}
                    className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-4 w-4 text-white" />
                  </button>
                </div>
              ))}
              {screenshots.length < 5 && (
                <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-md border-2 border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 transition-colors">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, GIF up to 5MB each.
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1"
              onClick={() => navigate('/tickets')}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="lg"
              className="flex-1"
              disabled={!canSubmit || loading}
              onClick={handleSubmit}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating...
                </>
              ) : (
                'Submit Ticket'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
