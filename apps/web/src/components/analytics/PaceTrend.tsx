import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Gauge } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import {
  hasAvailablePace,
  MIN_PACE_TREND_TURNS,
  PACE_UNSCORED_NOTE,
  paceTrendTurns,
} from '@/lib/pace'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export interface PacePoint {
  /** Sequence label (turn number). */
  label: string | number
  wpm: number
}

interface TurnWithPace {
  role?: string
  metrics?: {
    wpm?: number | null
    word_count?: number | null
    pace_source?: string | null
  }
}

const IDEAL_MIN = 120
const IDEAL_MAX = 160

/**
 * Pace-variation line chart: your WPM across turns, with the ideal 120–160 band
 * shaded and your average drawn as a dashed line. Pure SVG so it renders the
 * same live and post-session.
 */
export function PaceTrend({
  points,
  canonicalWpm = null,
  provisional = false,
  idealMin = IDEAL_MIN,
  idealMax = IDEAL_MAX,
  height = 150,
}: {
  points: PacePoint[]
  canonicalWpm?: number | null
  provisional?: boolean
  idealMin?: number
  idealMax?: number
  height?: number
}) {
  const stats = useMemo(() => {
    const wpms = points.map((p) => p.wpm).filter((w) => Number.isFinite(w) && w > 0)
    const dataMax = wpms.length ? Math.max(...wpms) : idealMax
    const dataMin = wpms.length ? Math.min(...wpms) : idealMin
    const yMax = Math.max(200, Math.ceil((dataMax + 20) / 20) * 20)
    const yMin = Math.max(0, Math.min(60, Math.floor((dataMin - 20) / 20) * 20))
    return { yMax, yMin }
  }, [points, idealMin, idealMax])

  if (points.length < 2) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Speak across a few turns to see your pace vary over the conversation.
      </p>
    )
  }

  // viewBox coordinate space; the SVG scales to its container width.
  const W = 600
  const H = height
  const padL = 34
  const padR = 12
  const padT = 10
  const padB = 22
  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const { yMax, yMin } = stats
  const range = yMax - yMin || 1

  const x = (i: number) => padL + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const y = (v: number) => padT + innerH - ((Math.max(yMin, Math.min(yMax, v)) - yMin) / range) * innerH

  const linePts = points.map((p, i) => `${x(i)},${y(p.wpm)}`).join(' ')
  const bandTop = y(Math.min(idealMax, yMax))
  const bandBottom = y(Math.max(idealMin, yMin))

  const gridVals = [yMin, idealMin, idealMax, yMax].filter((v, i, a) => a.indexOf(v) === i)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }} preserveAspectRatio="none">
        {/* Ideal comparison is only meaningful after canonical pace qualifies. */}
        {!provisional && (
          <>
            <rect
              x={padL}
              y={bandTop}
              width={innerW}
              height={Math.max(0, bandBottom - bandTop)}
              fill="rgb(34 197 94 / 0.12)"
            />
            <line x1={padL} y1={bandTop} x2={padL + innerW} y2={bandTop} stroke="rgb(34 197 94 / 0.4)" strokeWidth={1} strokeDasharray="4 3" />
            <line x1={padL} y1={bandBottom} x2={padL + innerW} y2={bandBottom} stroke="rgb(34 197 94 / 0.4)" strokeWidth={1} strokeDasharray="4 3" />
          </>
        )}

        {/* Y grid labels */}
        {gridVals.map((v) => (
          <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="9">
            {v}
          </text>
        ))}

        {/* Average line */}
        {canonicalWpm != null && canonicalWpm > 0 && (
          <line x1={padL} y1={y(canonicalWpm)} x2={padL + innerW} y2={y(canonicalWpm)} stroke="rgb(100 116 139 / 0.7)" strokeWidth={1} strokeDasharray="2 2" />
        )}

        {/* Pace line */}
        <polyline points={linePts} fill="none" stroke="rgb(34 197 94)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.wpm)} r={3} fill="rgb(34 197 94)" />
        ))}

        {/* X labels: first / middle / last to avoid clutter */}
        {points.map((p, i) => {
          if (points.length > 6 && i !== 0 && i !== points.length - 1 && i !== Math.floor(points.length / 2)) {
            return null
          }
          return (
            <text key={`x-${i}`} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
              {String(p.label)}
            </text>
          )
        })}
      </svg>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-green-500" /> Your pace
        </span>
        {!provisional && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-sm bg-green-500/20" /> Ideal {idealMin}–{idealMax} WPM
          </span>
        )}
        {canonicalWpm != null && canonicalWpm > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded bg-slate-400" /> Session pace {Math.round(canonicalWpm)} WPM
          </span>
        ) : provisional ? (
          <span className="text-amber-700">
            Provisional turn samples — not a session pace score
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Post-session wrapper: pulls per-turn metrics from the replay turns endpoint
 * and charts the user-turn WPMs so the live pace trend is retained after the
 * conversation ends.
 */
export function PaceTrendCard({
  sessionId,
  isSessionEnded = true,
  points: pointsProp,
  paceAvailable: paceAvailableProp,
  canonicalWpm: canonicalWpmProp,
}: {
  sessionId: string
  isSessionEnded?: boolean
  /** Pre-derived pace points; when provided, skips the self-fetch. */
  points?: PacePoint[]
  paceAvailable?: boolean
  canonicalWpm?: number | null
}) {
  const [fetchedPoints, setFetchedPoints] = useState<PacePoint[] | null>(null)
  const [fetchedPace, setFetchedPace] = useState<{ available: boolean; wpm: number | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const points = pointsProp ?? fetchedPoints
  const paceAvailable = paceAvailableProp ?? fetchedPace?.available ?? false
  const canonicalWpm =
    paceAvailable && Number.isFinite(canonicalWpmProp ?? fetchedPace?.wpm)
      ? Number(canonicalWpmProp ?? fetchedPace?.wpm)
      : null

  useEffect(() => {
    if (!isSessionEnded || !sessionId || pointsProp) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers: getAuthHeaders() }),
      fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, { headers: getAuthHeaders() }),
    ])
      .then(async ([turnsRes, metricsRes]) => ({
        turnsData: turnsRes.ok ? await turnsRes.json() : null,
        metrics: metricsRes.ok ? await metricsRes.json() : null,
      }))
      .then(({ turnsData, metrics }) => {
        if (cancelled || !turnsData) return
        const turns: TurnWithPace[] = Array.isArray(turnsData.turns) ? turnsData.turns : []
        const available = hasAvailablePace(metrics?.processingStatus)
        const pts: PacePoint[] = paceTrendTurns(turns, available).map((t, index) => ({
          label: index + 1,
          wpm: Math.round(Number(t.metrics?.wpm)),
        }))
        setFetchedPoints(pts)
        setFetchedPace({
          available,
          wpm: available && Number.isFinite(metrics?.userWpm) ? Number(metrics.userWpm) : null,
        })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, isSessionEnded, pointsProp])

  if (!isSessionEnded) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-5 w-5" />
          Pace Variation
        </CardTitle>
        <CardDescription>Your speaking speed (WPM) across each of your turns</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && !points ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading pace trend…</p>
        ) : !paceAvailable ? (
          <p className="py-4 text-center text-xs text-muted-foreground">{PACE_UNSCORED_NOTE}</p>
        ) : points && points.length >= MIN_PACE_TREND_TURNS ? (
          <PaceTrend points={points} canonicalWpm={canonicalWpm} />
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">
            A pace trend needs at least {MIN_PACE_TREND_TURNS} turns of 15+ words with measured timing.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default PaceTrend
