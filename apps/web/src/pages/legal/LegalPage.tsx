import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LEGAL_FALLBACK } from '@/lib/legal-fallback'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface LegalPageProps {
  slug: 'terms' | 'privacy'
}

function resolveBack(from: string | null): { to: string; label: string } {
  switch (from) {
    case 'signup':
    case 'register':
      return { to: '/auth/register', label: 'Back to Signup' }
    case 'login':
      return { to: '/auth/login', label: 'Back to Sign in' }
    default:
      return { to: '/auth/login', label: 'Back to Sign in' }
  }
}

export function LegalPage({ slug }: LegalPageProps) {
  const [searchParams] = useSearchParams()
  const from = searchParams.get('from')
  const { to: backTo, label: backLabel } = resolveBack(from)

  const fallback = LEGAL_FALLBACK[slug]
  const [title, setTitle] = useState(fallback.title)
  const [content, setContent] = useState(fallback.content)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${API}/api/legal/${slug}`)
      .then((r) => r.json())
      .then((d) => {
        setTitle(d.title?.trim() || fallback.title)
        setContent(d.content?.trim() || fallback.content)
      })
      .catch(() => {
        setTitle(fallback.title)
        setContent(fallback.content)
      })
      .finally(() => setLoading(false))
  }, [slug, fallback.title, fallback.content])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    )
  }

  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <Link
        to={backTo}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {backLabel}
      </Link>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
            {content}
          </div>
          <div className="mt-8 pt-4 border-t">
            <Link to={backTo}>
              <Button variant="outline">{backLabel}</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
