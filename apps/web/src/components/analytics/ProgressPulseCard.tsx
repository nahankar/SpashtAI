import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Minus, Mic, Target } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { getFocusAreaLabel } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface PulseHistoryPoint {
  score: number
  date: string
}

interface PulseSummaryItem {
  skill: string
  currentScore: number
  previousScore: number | null
  delta: number | null
  longTermDelta?: number | null
  totalSessions: number
  history?: PulseHistoryPoint[]
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
  if (delta != null && delta > 0.5) return { text: 'Improving', className: 'text-green-600' }
  if (score >= 8) return { text: 'Strong', className: 'text-green-600' }
  if (delta != null && delta < -0.5) return { text: 'Declining', className: 'text-red-500' }
  if (delta != null && Math.abs(delta) <= 0.5) return { text: 'Stable', className: 'text-blue-600' }
  if (score >= 5) return { text: 'Developing', className: 'text-amber-600' }
  return { text: 'Needs Focus', className: 'text-red-500' }
}

function buildPulseSummary(items: PulseSummaryItem[]): string {
  if (items.length === 0) return ''

  const improving = items
    .filter((i) => i.delta != null && i.delta > 0.5)
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

function buildPredictiveInsight(items: PulseSummaryItem[]): string | null {
  if (items.length < 3) return null

  const sorted = [...items].sort((a, b) => a.currentScore - b.currentScore)
  const weakest = sorted[0]
  if (!weakest || weakest.currentScore >= 8) return null

  const avgOthers = items
    .filter((i) => i.skill !== weakest.skill)
    .reduce((sum, i) => sum + i.currentScore, 0) / (items.length - 1)

  const targetScore = Math.min(10, weakest.currentScore + 2)
  const projectedOverall = ((avgOthers * (items.length - 1)) + targetScore) / items.length

  const skillName = getFocusAreaLabel(weakest.skill).toLowerCase()
  return `If your ${skillName} improves from ${weakest.currentScore.toFixed(1)} to ${targetScore.toFixed(1)}, your average communication score could reach ${projectedOverall.toFixed(1)}.`
}

function getFocusSkill(items: PulseSummaryItem[]): string | null {
  const needsFocus = items
    .filter((i) => i.currentScore < 7)
    .sort((a, b) => a.currentScore - b.currentScore)
  return needsFocus.length > 0 ? needsFocus[0].skill : null
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta == null) return null
  if (Math.abs(delta) <= 0.3) {
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

function LongTermDelta({ delta, sessions }: { delta: number | null | undefined; sessions: number }) {
  if (delta == null || sessions < 3) return null
  const color = delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-muted-foreground'
  return (
    <span className={`text-[10px] ${color}`}>
      Since first session: {delta > 0 ? '+' : ''}{delta.toFixed(1)}
    </span>
  )
}

function Sparkline({ points, color, width = 80, height = 28 }: { points: number[]; color: string; width?: number; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points, 0)
  const max = Math.max(...points, 10)
  const range = max - min || 1
  const pad = 2
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const coords = points.map((v, i) => ({
    x: pad + (i / (points.length - 1)) * innerW,
    y: pad + innerH - ((v - min) / range) * innerH,
  }))
  const polyline = coords.map((c) => `${c.x},${c.y}`).join(' ')
  const last = coords[coords.length - 1]
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </svg>
  )
}

export function ProgressPulseCard() {
  const [summary, setSummary] = useState<PulseSummaryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSummary = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`${API_BASE_URL}/api/progress-pulse/summary`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load progress data')
      const data = await res.json()
      setSummary(data.summary || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSummary()
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

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Progress Pulse</CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={loadSummary}
            className="mt-3 text-xs font-medium text-primary hover:underline"
          >
            Retry
          </button>
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
  const predictiveInsight = buildPredictiveInsight(summary)

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Progress Pulse</CardTitle>
        <CardDescription>
          {summary.length} skill{summary.length !== 1 ? 's' : ''} tracked across your sessions. Trends compare your
          latest score against the average of your last 3 sessions to filter out noise.
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
          {predictiveInsight && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2">
              <TrendingUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500" />
              <p className="text-xs text-blue-800">{predictiveInsight}</p>
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
                {item.history && item.history.length >= 2 && (
                  <div className="flex flex-col gap-0.5 pt-1 border-t border-border/50">
                    <div className="flex items-center gap-2">
                      <Sparkline
                        points={item.history.map((h) => h.score)}
                        color={item.currentScore >= 8 ? '#22c55e' : item.currentScore >= 5 ? '#f59e0b' : '#ef4444'}
                      />
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {item.history[0].date} \u2192 {item.history[item.history.length - 1].date}
                      </span>
                    </div>
                    <LongTermDelta delta={item.longTermDelta} sessions={item.totalSessions} />
                  </div>
                )}
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
