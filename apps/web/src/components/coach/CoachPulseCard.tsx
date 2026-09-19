import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Loader2, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getAuthHeaders } from '@/lib/api-client'
import { getFocusAreaLabel } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

type PulseSummaryItem = {
  skill: string
  currentScore: number
  previousScore: number | null
  delta: number | null
  totalSessions: number
}

function scoreColor(score: number): string {
  if (score >= 8) return 'text-green-600'
  if (score >= 5) return 'text-amber-600'
  return 'text-red-500'
}

function buildPulseSummary(items: PulseSummaryItem[]): string {
  if (items.length === 0) return ''
  const improving = items
    .filter((item) => item.delta != null && item.delta > 0.5)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
  const needsFocus = items
    .filter((item) => item.currentScore < 6)
    .sort((a, b) => a.currentScore - b.currentScore)
  const parts: string[] = []
  if (improving.length > 0) {
    const names = improving.slice(0, 2).map((item) => getFocusAreaLabel(item.skill).toLowerCase())
    parts.push(`You're improving in ${names.join(' and ')}`)
  }
  if (needsFocus.length > 0) {
    parts.push(`focus on ${getFocusAreaLabel(needsFocus[0].skill).toLowerCase()} next`)
  }
  if (parts.length === 0) return 'Scores are steady across tracked skills.'
  return `${parts.join('. ')}.`
}

export function CoachPulseCard({ threadId }: { threadId?: string }) {
  const [items, setItems] = useState<PulseSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_BASE_URL}/api/progress-pulse/summary`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load Pulse')
        return res.json() as Promise<{ summary?: PulseSummaryItem[] }>
      })
      .then((data) => {
        if (!cancelled) setItems(data.summary ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Pulse')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const weakest = [...items].sort((a, b) => a.currentScore - b.currentScore)[0] ?? null
  const narrative = buildPulseSummary(items)
  const practiceSearch = new URLSearchParams({
    focus: weakest?.skill ?? 'clarity',
    newSession: 'true',
    coach: '1',
  })
  if (threadId) practiceSearch.set('thread', threadId)
  const progressSearch = new URLSearchParams({ coach: '1' })
  if (threadId) progressSearch.set('thread', threadId)
  const progressHref = `/progress?${progressSearch.toString()}`

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1.5 pb-3">
        <CardTitle className="text-base">Your Pulse</CardTitle>
        <CardDescription>
          {loading
            ? 'Loading scores from tracked sessions…'
            : error
              ? error
              : items.length === 0
                ? 'No tracked sessions yet. Complete an Elevate or Replay and choose to track it.'
                : narrative}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading Pulse…
          </div>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {items.map((item) => (
              <div
                key={item.skill}
                className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium">{getFocusAreaLabel(item.skill)}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.totalSessions} session{item.totalSessions === 1 ? '' : 's'}
                    {item.delta != null && Math.abs(item.delta) > 0.3
                      ? ` · ${item.delta > 0 ? '+' : ''}${item.delta.toFixed(1)}`
                      : ''}
                  </p>
                </div>
                <span className={`text-base font-semibold ${scoreColor(item.currentScore)}`}>
                  {item.currentScore.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          {weakest ? (
            <>
              <Button asChild size="sm" className="gap-2">
                <Link to={`/elevate?${practiceSearch.toString()}`}>
                  <Mic className="h-4 w-4" />
                  Practice {getFocusAreaLabel(weakest.skill)}
                </Link>
              </Button>
              <Link
                to={progressHref}
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Open Progress Pulse
              </Link>
            </>
          ) : (
            <Button asChild size="sm" className="gap-2">
              <Link to={progressHref}>
                Open Progress Pulse
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
