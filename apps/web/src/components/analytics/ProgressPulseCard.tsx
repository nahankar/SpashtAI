import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Minus, Mic, Target } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { getFocusAreaLabel } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface PulseSummaryItem {
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

function scoreBg(score: number): string {
  if (score >= 8) return 'bg-green-500'
  if (score >= 5) return 'bg-amber-500'
  return 'bg-red-500'
}

function statusLabel(score: number, delta: number | null): { text: string; className: string } {
  if (delta != null && delta > 0.3) return { text: 'Improving', className: 'text-green-600' }
  if (score >= 8) return { text: 'Strong', className: 'text-green-600' }
  if (delta != null && delta < -0.3) return { text: 'Declining', className: 'text-red-500' }
  if (score >= 5) return { text: 'Developing', className: 'text-amber-600' }
  return { text: 'Needs Focus', className: 'text-red-500' }
}

function buildPulseSummary(items: PulseSummaryItem[]): string {
  if (items.length === 0) return ''

  const improving = items
    .filter((i) => i.delta != null && i.delta > 0.2)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
  const needsFocus = items
    .filter((i) => i.currentScore < 6)
    .sort((a, b) => a.currentScore - b.currentScore)

  const parts: string[] = []

  if (improving.length > 0) {
    const names = improving.slice(0, 2).map((i) => getFocusAreaLabel(i.skill).toLowerCase())
    parts.push(`You're improving in ${names.join(' and ')}`)
  }

  if (needsFocus.length > 0) {
    const focus = getFocusAreaLabel(needsFocus[0].skill).toLowerCase()
    parts.push(`focus on ${focus} next`)
  } else if (improving.length === 0) {
    const lowest = [...items].sort((a, b) => a.currentScore - b.currentScore)[0]
    if (lowest) parts.push(`Keep working on ${getFocusAreaLabel(lowest.skill).toLowerCase()}`)
  }

  if (parts.length === 0) {
    return 'Great progress across all skills — keep it up!'
  }

  return parts.join('. ') + '.'
}

function getFocusSkill(items: PulseSummaryItem[]): string | null {
  const needsFocus = items
    .filter((i) => i.currentScore < 7)
    .sort((a, b) => a.currentScore - b.currentScore)
  return needsFocus.length > 0 ? needsFocus[0].skill : null
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null
  if (Math.abs(delta) < 0.1) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
        <Minus className="h-3 w-3" /> Steady
      </span>
    )
  }
  if (delta > 0) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs text-green-600">
        <TrendingUp className="h-3 w-3" /> +{delta.toFixed(1)}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-red-500">
      <TrendingDown className="h-3 w-3" /> {delta.toFixed(1)}
    </span>
  )
}

export function ProgressPulseCard() {
  const [summary, setSummary] = useState<PulseSummaryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/progress-pulse/summary`, {
          headers: getAuthHeaders(),
        })
        if (res.ok) {
          const data = await res.json()
          setSummary(data.summary || [])
        }
      } catch {
        // non-critical
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Loading progress...
        </CardContent>
      </Card>
    )
  }

  if (summary.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Progress Pulse</CardTitle>
          <CardDescription>
            Complete a Replay analysis or Elevate session and choose to track it.
          </CardDescription>
        </CardHeader>
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          No data yet — your progress will appear here after you track your first session.
        </CardContent>
      </Card>
    )
  }

  const pulseSummary = buildPulseSummary(summary)
  const focusSkill = getFocusSkill(summary)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Progress Pulse</CardTitle>
        <CardDescription>
          {summary.length} skill{summary.length !== 1 ? 's' : ''} tracked across your sessions. Improving / declining
          compares your latest vs previous score per skill, ordered by the <strong>meeting date</strong> you set when
          tracking Replay (not upload order).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {/* Pulse Summary */}
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <p className="text-sm text-foreground">{pulseSummary}</p>
          {focusSkill && (
            <div className="mt-2 flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-medium text-primary">
                Focus area: {getFocusAreaLabel(focusSkill)}
              </span>
            </div>
          )}
        </div>

        {/* Skill Cards */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.map((item) => {
            const status = statusLabel(item.currentScore, item.delta)
            return (
              <div
                key={item.skill}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <span className={`text-lg font-bold ${scoreColor(item.currentScore)}`}>
                      {item.currentScore.toFixed(1)}
                    </span>
                    <div className="mt-1 h-1.5 w-12 overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all ${scoreBg(item.currentScore)}`}
                        style={{ width: `${item.currentScore * 10}%` }}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{getFocusAreaLabel(item.skill)}</p>
                    <div className="flex items-center gap-2">
                      <DeltaBadge delta={item.delta} />
                      <span className="text-xs text-muted-foreground">
                        {item.totalSessions} session{item.totalSessions !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <p className={`mt-0.5 text-[11px] font-medium ${status.className}`}>
                      {status.text}
                    </p>
                  </div>
                </div>
                <Link
                  to={`/elevate?focus=${item.skill}&newSession=true`}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <Mic className="h-3 w-3" /> Practice in Elevate
                </Link>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
