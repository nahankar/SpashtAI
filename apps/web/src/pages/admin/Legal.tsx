import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2, Save, FileText } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

interface LegalDoc {
  slug: string
  title: string
  content: string
  updatedAt: string
}

const DOCS = [
  { slug: 'terms', label: 'Terms and Conditions', publicPath: '/terms' },
  { slug: 'privacy', label: 'Privacy Policy', publicPath: '/privacy' },
] as const

export function AdminLegal() {
  const [activeSlug, setActiveSlug] = useState<'terms' | 'privacy'>('terms')
  const [doc, setDoc] = useState<LegalDoc | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async (slug: string) => {
    setLoading(true)
    try {
      const data = await apiClient<{ document: LegalDoc }>(`/api/admin/legal/${slug}`)
      setDoc(data.document)
      setTitle(data.document.title)
      setContent(data.document.content)
    } catch {
      toast.error('Failed to load document')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(activeSlug)
  }, [activeSlug, load])

  async function handleSave() {
    setSaving(true)
    try {
      const data = await apiClient<{ document: LegalDoc }>(`/api/admin/legal/${activeSlug}`, {
        method: 'PUT',
        body: JSON.stringify({ title, content }),
      })
      setDoc(data.document)
      toast.success('Document saved')
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const meta = DOCS.find((d) => d.slug === activeSlug)!

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Legal Documents</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Edit Terms and Privacy Policy shown during registration and on public pages.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {DOCS.map((d) => (
          <Button
            key={d.slug}
            variant={activeSlug === d.slug ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveSlug(d.slug)}
          >
            <FileText className="mr-1.5 h-4 w-4" />
            {d.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{meta.label}</CardTitle>
            <CardDescription>
              Public page:{' '}
              <Link to={meta.publicPath} target="_blank" className="text-primary hover:underline">
                {meta.publicPath}
              </Link>
              {doc?.updatedAt && (
                <span className="block mt-1 text-xs">
                  Last updated {new Date(doc.updatedAt).toLocaleString()}
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="legal-title">Title</Label>
              <Input
                id="legal-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="legal-content">Content</Label>
              <Textarea
                id="legal-content"
                rows={22}
                className="font-mono text-xs leading-relaxed"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
