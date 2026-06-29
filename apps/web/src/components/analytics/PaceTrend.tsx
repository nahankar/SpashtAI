import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Gauge } from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

export interface PacePoint {
  /** Sequence label (turn number). */
  label: string | number
  wpm: number
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
  idealMin = IDEAL_MIN,
  idealMax = IDEAL_MAX,
  height = 150,
}: {
  points: PacePoint[]
  idealMin?: number
  idealMax?: number
  height?: number
}) {
  const stats = useMemo(() => {
    const wpms = points.map((p) => p.wpm).filter((w) => Number.isFinite(w) && w > 0)
    const avg = wpms.length ? wpms.reduce((s, w) => s + w, 0) / wpms.length : 0
    const dataMax = wpms.length ? Math.max(...wpms) : idealMax
    const dataMin = wpms.length ? Math.min(...wpms) : idealMin
    const yMax = Math.max(200, Math.ceil((dataMax + 20) / 20) * 20)
    const yMin = Math.max(0, Math.min(60, Math.floor((dataMin - 20) / 20) * 20))
    return { avg, yMax, yMin }
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
  const { yMax, yMin, avg } = stats
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
        {/* Ideal band */}
        <rect
          x={padL}
          y={bandTop}
          width={innerW}
          height={Math.max(0, bandBottom - bandTop)}
          fill="rgb(34 197 94 / 0.12)"
        />
        <line x1={padL} y1={bandTop} x2={padL + innerW} y2={bandTop} stroke="rgb(34 197 94 / 0.4)" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={padL} y1={bandBottom} x2={padL + innerW} y2={bandBottom} stroke="rgb(34 197 94 / 0.4)" strokeWidth={1} strokeDasharray="4 3" />

        {/* Y grid labels */}
        {gridVals.map((v) => (
          <text key={v} x={padL - 6} y={y(v) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="9">
            {v}
          </text>
        ))}

        {/* Average line */}
        {avg > 0 && (
          <line x1={padL} y1={y(avg)} x2={padL + innerW} y2={y(avg)} stroke="rgb(100 116 139 / 0.7)" strokeWidth={1} strokeDasharray="2 2" />
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
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-green-500/20" /> Ideal {idealMin}–{idealMax} WPM
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded bg-slate-400" /> Your average {Math.round(avg)} WPM
        </span>
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
}: {
  sessionId: string
  isSessionEnded?: boolean
  /** Pre-derived pace points; when provided, skips the self-fetch. */
  points?: PacePoint[]
}) {
  const [fetchedPoints, setFetchedPoints] = useState<PacePoint[] | null>(null)
  const [loading, setLoading] = useState(false)
  const points = pointsProp ?? fetchedPoints

  useEffect(() => {
    if (!isSessionEnded || !sessionId || pointsProp) return
    let cancelled = false
    setLoading(true)
    fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        const turns = Array.isArray(data.turns) ? data.turns : []
        let n = 0
        const pts: PacePoint[] = turns
          .filter((t: any) => t.role === 'user' && t.metrics?.wpm != null && t.metrics.wpm > 0)
          .map((t: any) => {
            n += 1
            return { label: n, wpm: Math.round(Number(t.metrics.wpm)) }
          })
        setFetchedPoints(pts)
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
        ) : points && points.length >= 2 ? (
          <PaceTrend points={points} />
        ) : (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Per-turn pace wasn&apos;t captured for this session, so the pace trend isn&apos;t available.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export default PaceTrend
