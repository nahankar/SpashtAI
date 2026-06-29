import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '../ui/card'
import { Award, Gauge, MessageSquare, Hash } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

const IDEAL_MIN = 120
const IDEAL_MAX = 160

/** Minimal shape we need from the historical SessionMetrics record. */
interface HistoricalLike {
  userWpm?: number | null
  userFillerRate?: number | null
  userFillerCount?: number | null
}

interface Props {
  sessionId: string
  metrics: HistoricalLike | null
  /** 'card' = standalone strip; 'inline' = compact row for the tab header. */
  variant?: 'card' | 'inline'
  /** Pre-fetched per-turn records (avoids a duplicate /turns fetch). */
  turns?: { role: string; metrics?: any }[]
}

function scoreTone(v: number): string {
  if (v >= 8) return 'text-green-600'
  if (v >= 6) return 'text-blue-600'
  if (v >= 4) return 'text-yellow-600'
  return 'text-red-600'
}

function fillerTone(rate: number): string {
  if (rate <= 2) return 'text-emerald-600'
  if (rate <= 5) return 'text-blue-600'
  if (rate <= 8) return 'text-yellow-600'
  return 'text-red-600'
}

function paceTone(wpm: number): { text: string; label: string } {
  if (wpm <= 0) return { text: 'text-muted-foreground', label: '' }
  if (wpm < 90) return { text: 'text-yellow-600', label: 'Slow' }
  if (wpm < IDEAL_MIN) return { text: 'text-blue-600', label: 'Measured' }
  if (wpm <= IDEAL_MAX) return { text: 'text-emerald-600', label: 'Ideal' }
  if (wpm <= 185) return { text: 'text-orange-600', label: 'Fast' }
  return { text: 'text-red-600', label: 'Rapid' }
}

/** Tiny inline WPM sparkline (no axes/legend) for the summary strip. */
function MiniSparkline({ values, width = 104, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1
  const y = (v: number) => height - 3 - ((v - min) / range) * (height - 6)
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  // Ideal band (clamped into view) for context.
  const bandTop = y(Math.min(max, IDEAL_MAX))
  const bandBottom = y(Math.max(min, IDEAL_MIN))
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      {bandBottom > bandTop && (
        <rect x={0} y={bandTop} width={width} height={Math.max(0, bandBottom - bandTop)} fill="rgb(34 197 94 / 0.12)" />
      )}
      <polyline points={pts} fill="none" stroke="rgb(34 197 94)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r={1.6} fill="rgb(34 197 94)" />
      ))}
    </svg>
  )
}

/**
 * Compact metrics strip for the top of Session Analytics — the post-session
 * mirror of the live "Show Metrics" panel: Communication Score, Filler, Hedging,
 * a small pace line graph, and WPM. Reads existing data only (skill-scores +
 * per-turn records); shows "—" for anything not captured.
 */
export function SessionMetricsSummary({ sessionId, metrics, variant = 'card', turns }: Props) {
  const [score, setScore] = useState<number | null>(null)
  const [fetchedTurns, setFetchedTurns] = useState<{ role: string; metrics?: any }[] | null>(null)

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.scores) return
        const vals = Object.values(data.scores).filter(
          (v): v is number => typeof v === 'number' && Number.isFinite(v),
        )
        if (vals.length) setScore(vals.reduce((s, v) => s + v, 0) / vals.length)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // Only self-fetch turns if the parent didn't supply them.
  useEffect(() => {
    if (!sessionId || turns) return
    let cancelled = false
    fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setFetchedTurns(Array.isArray(data.turns) ? data.turns : [])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [sessionId, turns])

  const effectiveTurns = turns ?? fetchedTurns ?? []

  const { pacePoints, hedging } = useMemo(() => {
    const userTurns = effectiveTurns.filter((t) => t.role === 'user')
    const pts = userTurns
      .filter((t) => t.metrics?.wpm != null && t.metrics.wpm > 0)
      .map((t) => Math.round(Number(t.metrics.wpm)))
    let hedge = 0
    let hasHedge = false
    for (const t of userTurns) {
      if (t.metrics?.hedging_count != null) {
        hedge += Number(t.metrics.hedging_count) || 0
        hasHedge = true
      }
    }
    return { pacePoints: pts, hedging: hasHedge ? hedge : null }
  }, [effectiveTurns])

  const wpm = metrics?.userWpm && metrics.userWpm > 0 ? Math.round(metrics.userWpm) : null
  const fillerRate = metrics?.userFillerRate != null ? metrics.userFillerRate : null
  const fillerCount = metrics?.userFillerCount != null ? metrics.userFillerCount : null
  const pace = paceTone(wpm ?? 0)

  if (variant === 'inline') {
    return (
      <span className="inline-flex min-w-0 items-center gap-x-4 whitespace-nowrap text-xs font-normal">
        <span className="flex shrink-0 items-center gap-1.5">
          <Award className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Communication Score</span>
          <span className={`font-bold ${score != null ? scoreTone(score) : 'text-muted-foreground'}`}>
            {score != null ? score.toFixed(1) : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">/10</span>
        </span>
        <span className="h-4 w-px shrink-0 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Filler</span>
          <span className={`font-bold ${fillerRate != null ? fillerTone(fillerRate) : 'text-muted-foreground'}`}>
            {fillerRate != null ? fillerRate.toFixed(1) : '—'}
          </span>
          <span className="text-[10px] text-muted-foreground">
            %{fillerCount != null ? ` (${fillerCount})` : ''}
          </span>
        </span>
        <span className="h-4 w-px shrink-0 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Pace</span>
          <MiniSparkline values={pacePoints} width={72} height={22} />
        </span>
        <span className="h-4 w-px shrink-0 bg-border" />
        <span className="flex shrink-0 items-center gap-1.5">
          <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">WPM</span>
          <span className={`font-bold ${wpm != null ? pace.text : 'text-muted-foreground'}`}>
            {wpm != null ? wpm : '—'}
          </span>
          {wpm != null && pace.label && (
            <span className={`text-[10px] uppercase tracking-wide ${pace.text}`}>{pace.label}</span>
          )}
        </span>
      </span>
    )
  }

  return (
    <Card>
      <CardContent className="py-4">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
          {/* Communication Score */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Award className="h-3.5 w-3.5" /> Communication Score
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`text-2xl font-bold ${score != null ? scoreTone(score) : 'text-muted-foreground'}`}>
                {score != null ? score.toFixed(1) : '—'}
              </span>
              <span className="text-xs text-muted-foreground">/10</span>
            </div>
          </div>

          {/* Filler */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageSquare className="h-3.5 w-3.5" /> Filler
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-bold ${fillerRate != null ? fillerTone(fillerRate) : 'text-muted-foreground'}`}>
                {fillerRate != null ? fillerRate.toFixed(1) : '—'}
              </span>
              {fillerRate != null && <span className="text-xs text-muted-foreground">%</span>}
              {fillerCount != null && (
                <span className="text-xs text-muted-foreground">({fillerCount})</span>
              )}
            </div>
          </div>

          {/* Hedging */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Hash className="h-3.5 w-3.5" /> Hedging
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold">{hedging != null ? hedging : '—'}</span>
              {hedging != null && (
                <span className="text-xs text-muted-foreground">{hedging === 1 ? 'phrase' : 'phrases'}</span>
              )}
            </div>
          </div>

          {/* Pace (small line graph) */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" /> Pace
            </div>
            <MiniSparkline values={pacePoints} />
          </div>

          {/* WPM */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" /> WPM
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className={`text-2xl font-bold ${wpm != null ? pace.text : 'text-muted-foreground'}`}>
                {wpm != null ? wpm : '—'}
              </span>
              {wpm != null && pace.label && (
                <span className={`text-[10px] uppercase tracking-wide ${pace.text}`}>{pace.label}</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default SessionMetricsSummary
