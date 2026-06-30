import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Play,
  Pause,
  Loader2,
  AlertCircle,
  Volume2,
  VolumeX,
  Gauge,
  MessageSquare,
  Star,
  Lightbulb,
  Search,
  FastForward,
  TrendingUp,
  Zap,
  Turtle,
  Sparkles,
  Lock,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { getAuthHeaders } from '@/lib/api-client'
import { useIsPro } from '@/hooks/useIsPro'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface TurnWord {
  w: string
  start: number
  end: number
}
interface TurnMetrics {
  word_count?: number
  filler_count?: number
  filler_rate?: number
  hedging_count?: number
  vocab_diversity?: number
  wpm?: number | null
  speaking_seconds?: number | null
  qualitative_pace?: string | null
  coaching_tip?: string | null
}
interface TurnScore {
  stars?: number
  confidence?: number
  tags?: string[]
}
interface ReplayTurn {
  id: string
  turnIndex: number
  role: string
  text: string
  audioStart?: number | null
  audioEnd?: number | null
  words?: TurnWord[] | null
  metrics?: TurnMetrics | null
  score?: TurnScore | null
  coachNote?: string | null
}

interface SessionInfo {
  module?: string | null
  sessionName?: string | null
  focusArea?: string | null
  startedAt?: string | null
  endedAt?: string | null
  durationSec?: number | null
}

type RoleFilter = 'all' | 'user' | 'assistant'
type QualityChip = 'fillers' | 'hesitations' | 'pace' | 'great' | 'improvements'

const QUALITY_CHIPS: { key: QualityChip; label: string }[] = [
  { key: 'fillers', label: 'Fillers' },
  { key: 'hesitations', label: 'Hesitations' },
  { key: 'pace', label: 'Pace issues' },
  { key: 'great', label: 'Great' },
  { key: 'improvements', label: 'Improvements' },
]

// Quality chips describe YOUR turns only (the coach is never the subject of a
// filler/pace/improvement filter), so when any are active the Coach view is
// disabled and matching is restricted to user turns.
function turnMatchesChip(t: ReplayTurn, c: QualityChip): boolean {
  if (t.role !== 'user' || !t.metrics) return false
  const m = t.metrics
  switch (c) {
    case 'fillers':
      return (m.filler_count ?? 0) > 0
    case 'hesitations':
      return (m.hedging_count ?? 0) > 0
    case 'pace':
      return !!m.qualitative_pace && m.qualitative_pace !== 'ideal'
    case 'great':
      return (t.score?.stars ?? 0) >= 4 || m.qualitative_pace === 'ideal'
    case 'improvements':
      return (
        !!(t.coachNote || m.coaching_tip) ||
        (t.score?.stars != null && t.score.stars <= 2)
      )
    default:
      return false
  }
}

const MODULE_LABELS: Record<string, string> = {
  elevate: 'Elevate',
  pitch: 'Pitch Rehearsal',
  fluency: 'Fluency',
  interview: 'Interview',
}

// ── Per-turn quality (for the timeline) ────────────────────────────────────
// Derived only from signals we actually persist per turn (stars/confidence,
// fillers, pace). No fabricated data — turns without metrics return null and
// render as a neutral segment.
type QualityTone = 'good' | 'ok' | 'bad'

// AI phrasing suggestion for a turn (from the LLM-backed /turn-suggestions API).
interface TurnSuggestion {
  turnIndex: number
  kind: 'concise' | 'wording' | 'clarity'
  suggestion: string
  rewrite?: string
}

const SUGGESTION_KIND_LABEL: Record<TurnSuggestion['kind'], string> = {
  concise: 'Tighten it',
  wording: 'Word choice',
  clarity: 'Make it clearer',
}

const QUALITY_FILL: Record<QualityTone, string> = {
  good: 'bg-emerald-500',
  ok: 'bg-amber-400',
  bad: 'bg-red-500',
}

function turnQuality(t: ReplayTurn): { score: number; tone: QualityTone } | null {
  if (t.role !== 'user') return null
  const m = t.metrics
  const hasSignal = !!m || t.score?.stars != null || t.score?.confidence != null
  if (!hasSignal) return null

  let base = 0.7
  if (t.score?.stars != null) {
    base = Math.max(0, Math.min(1, t.score.stars / 5))
  } else if (t.score?.confidence != null) {
    const c = t.score.confidence
    base = c > 1 ? Math.max(0, Math.min(1, c / 10)) : Math.max(0, Math.min(1, c))
  }

  if (m) {
    const fr = m.filler_rate ?? 0
    base -= Math.min(0.35, (fr / 100) * 3) // ~12% filler ⇒ ~-0.35
    const p = m.qualitative_pace
    if (p === 'rapid' || p === 'slow') base -= 0.15
    else if (p === 'fast') base -= 0.07
  }

  const score = Math.max(0, Math.min(1, base))
  const tone: QualityTone = score >= 0.66 ? 'good' : score >= 0.4 ? 'ok' : 'bad'
  return { score, tone }
}

// Friendly title for the playback header: prefer the user's session name, then a
// known module label, falling back to a humanized module key.
function sessionTitle(info: SessionInfo | null): string {
  if (!info) return 'Session'
  if (info.sessionName?.trim()) return info.sessionName.trim()
  const key = (info.module || '').toLowerCase()
  if (MODULE_LABELS[key]) return MODULE_LABELS[key]
  if (key) return key.charAt(0).toUpperCase() + key.slice(1)
  return 'Session'
}

function formatSessionDate(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export function SessionReplay({
  sessionId: sessionIdProp,
  embedded = false,
  focusRequest = null,
}: {
  /** Override the route param so this can render inside the Elevate results tab. */
  sessionId?: string
  /** Hide the page header (back link + title) when shown inside another view. */
  embedded?: boolean
  /**
   * A one-shot request (from the analytics "Hear it" links) to jump playback to
   * the most relevant moment for a given skill. Bumping `nonce` re-triggers it.
   */
  focusRequest?: { skill: string; nonce: number } | null
} = {}) {
  const params = useParams<{ sessionId: string }>()
  const sessionId = sessionIdProp ?? params.sessionId
  const isPro = useIsPro()

  const [turns, setTurns] = useState<ReplayTurn[]>([])
  const [transcriptHidden, setTranscriptHidden] = useState(false)
  const [degraded, setDegraded] = useState(false)
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioAvailable, setAudioAvailable] = useState(true)
  const [audioLoading, setAudioLoading] = useState(true)

  const [isPlaying, setIsPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [rate, setRate] = useState(1)

  const [roleFilter, setRoleFilter] = useState<RoleFilter>('user')
  const [chips, setChips] = useState<Set<QualityChip>>(new Set())
  const [skipGaps, setSkipGaps] = useState(true)
  const [showTrends, setShowTrends] = useState(true)
  const [suggestions, setSuggestions] = useState<Record<number, TurnSuggestion>>({})
  // Used to line the trends ribbon up horizontally with the seek track (the
  // track is only the middle flex-1 region, not the full transport width).
  const transportRef = useRef<HTMLDivElement>(null)
  const trackWrapRef = useRef<HTMLDivElement>(null)
  const [trackBox, setTrackBox] = useState<{ left: number; width: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const turnRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const objectUrlRef = useRef<string | null>(null)
  const handledFocusRef = useRef<number | null>(null)

  // ── Data: per-turn records ───────────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load replay (${res.status})`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        setTurns(Array.isArray(data.turns) ? data.turns : [])
        setTranscriptHidden(Boolean(data.transcriptHidden))
        setDegraded(Boolean(data.degraded))
        setSessionInfo(data.session ?? null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load replay')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // ── Data: audio (fetched as a blob so we can pass the auth header) ────
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    setAudioLoading(true)
    fetch(`${API_BASE_URL}/sessions/${sessionId}/recording/stream`, { headers: getAuthHeaders() })
      .then(async (res) => {
        if (res.status === 404) {
          setAudioAvailable(false)
          return null
        }
        if (!res.ok) {
          setAudioAvailable(false)
          return null
        }
        return res.blob()
      })
      .then((blob) => {
        if (cancelled || !blob) return
        const url = URL.createObjectURL(blob)
        objectUrlRef.current = url
        setAudioUrl(url)
        setAudioAvailable(true)
      })
      .catch(() => {
        if (!cancelled) setAudioAvailable(false)
      })
      .finally(() => {
        if (!cancelled) setAudioLoading(false)
      })
    return () => {
      cancelled = true
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [sessionId])

  // Keep playback rate in sync.
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = rate
  }, [rate, audioUrl])

  // ── Data: AI phrasing suggestions (best-effort; never blocks the UI) ──
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    fetch(`${API_BASE_URL}/sessions/${sessionId}/turn-suggestions`, { headers: getAuthHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.suggestions) return
        const map: Record<number, TurnSuggestion> = {}
        for (const s of data.suggestions as TurnSuggestion[]) {
          if (s && typeof s.turnIndex === 'number' && s.suggestion) map[s.turnIndex] = s
        }
        setSuggestions(map)
      })
      .catch(() => {
        /* suggestions are optional — ignore failures */
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  // End the timeline at the user's last spoken turn — the coach's closing reply
  // and any trailing silence on the user track aren't part of "the conversation
  // you practiced", so we trim them from the scrubber, ribbon and play range.
  const lastUserEnd = useMemo(() => {
    let end = 0
    for (const t of turns) {
      if (t.role !== 'user') continue
      if (t.audioEnd != null) end = Math.max(end, t.audioEnd)
      else if (t.audioStart != null) end = Math.max(end, t.audioStart)
    }
    return end
  }, [turns])

  const timelineEnd = useMemo(() => {
    if (!duration || !Number.isFinite(duration)) return duration
    if (lastUserEnd > 0 && lastUserEnd < duration) return lastUserEnd
    return duration
  }, [lastUserEnd, duration])

  // ── Transport ────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }, [])

  const seekTo = useCallback((t: number) => {
    const a = audioRef.current
    // Guard against non-finite values (e.g. webm blobs report duration=Infinity
    // until metadata is fully decoded). Setting currentTime to NaN/Infinity throws.
    if (!a || !Number.isFinite(t)) return
    a.currentTime = Math.max(0, t)
    setCurrentTime(a.currentTime)
  }, [])

  const playFrom = useCallback((t: number) => {
    const a = audioRef.current
    if (!a || !Number.isFinite(t)) return
    a.currentTime = Math.max(0, t)
    void a.play()
  }, [])

  const onScrubberClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!timelineEnd || !Number.isFinite(timelineEnd)) return
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = (e.clientX - rect.left) / rect.width
      seekTo(ratio * timelineEnd)
    },
    [timelineEnd, seekTo],
  )

  // ── Active turn / word (karaoke) ─────────────────────────────────────
  const activeTurnIndex = useMemo(() => {
    let active = -1
    for (const t of turns) {
      if (t.audioStart == null) continue
      if (currentTime >= t.audioStart && (t.audioEnd == null || currentTime <= t.audioEnd)) {
        active = t.turnIndex
      }
    }
    return active
  }, [turns, currentTime])

  // Auto-scroll the active turn into view while playing.
  useEffect(() => {
    if (activeTurnIndex < 0 || !isPlaying) return
    const el = turnRefs.current[activeTurnIndex]
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeTurnIndex, isPlaying])

  // ── Filters ──────────────────────────────────────────────────────────
  const toggleChip = (c: QualityChip) =>
    setChips((prev) => {
      const n = new Set(prev)
      n.has(c) ? n.delete(c) : n.add(c)
      return n
    })

  const effectiveChips = chips

  // Any metric filter active → restrict to user turns, disable the Coach view.
  const coachDisabled = effectiveChips.size > 0

  // If a metric filter turns on while the user is viewing Coach-only, fall back
  // to All so they don't see an empty list.
  useEffect(() => {
    if (coachDisabled && roleFilter === 'assistant') setRoleFilter('all')
  }, [coachDisabled, roleFilter])

  const visibleTurns = useMemo(() => {
    return turns.filter((t) => {
      if (roleFilter !== 'all' && t.role !== roleFilter) return false
      if (effectiveChips.size > 0) {
        if (t.role !== 'user') return false
        const ok = Array.from(effectiveChips).some((c) => turnMatchesChip(t, c))
        if (!ok) return false
      }
      return true
    })
  }, [turns, roleFilter, effectiveChips])

  const userTurnCount = useMemo(() => turns.filter((t) => t.role === 'user').length, [turns])
  const hasTimings = useMemo(() => turns.some((t) => t.audioStart != null), [turns])

  // Colored quality segments for the seek bar — one per user turn that has audio
  // timing, positioned by its audio interval. Falls back to the plain bar when
  // there are no timings (older sessions), so playback is never regressed.
  const qualitySegments = useMemo(() => {
    if (!timelineEnd || !Number.isFinite(timelineEnd)) return []
    return turns
      .filter((t) => t.role === 'user' && t.audioStart != null)
      .map((t) => {
        const start = t.audioStart as number
        const end = Math.min(timelineEnd, t.audioEnd ?? start + 0.5)
        const q = turnQuality(t)
        const m = t.metrics
        const tipParts = [
          formatTime(start),
          m?.wpm != null ? `${Math.round(m.wpm)} WPM` : null,
          m?.filler_count != null ? `${m.filler_count} filler${m.filler_count === 1 ? '' : 's'}` : null,
        ].filter(Boolean)
        return {
          turnIndex: t.turnIndex,
          left: (start / timelineEnd) * 100,
          width: Math.max(0.6, ((end - start) / timelineEnd) * 100),
          tone: q?.tone ?? null,
          start,
          title: tipParts.join(' · '),
        }
      })
  }, [turns, timelineEnd])

  // Per-turn trend lines (Pace / Fluency / Confidence) over audio time. Only
  // signals we genuinely capture per turn are plotted — no interpolation of
  // session-level skills like Clarity/Structure.
  const trendPoints = useMemo(() => {
    return turns
      .filter((t) => t.role === 'user' && t.audioStart != null)
      .map((t) => {
        const m = t.metrics
        const wpm = m?.wpm ?? null
        const fluency =
          m?.filler_rate != null ? Math.max(0, Math.min(10, 10 - m.filler_rate)) : null
        let confidence: number | null = null
        if (t.score?.confidence != null) {
          confidence = t.score.confidence > 1 ? t.score.confidence / 10 : t.score.confidence * 10
          confidence = Math.max(0, Math.min(10, confidence))
        } else if (t.score?.stars != null) {
          confidence = Math.max(0, Math.min(10, (t.score.stars / 5) * 10))
        }
        // Plot at the midpoint of the turn so each point sits over its colored
        // segment on the slider (not at the segment's leading edge).
        const start = t.audioStart as number
        const end = t.audioEnd ?? start
        return { time: (start + end) / 2, wpm, fluency, confidence }
      })
  }, [turns])

  const trendsAvailable = useMemo(() => {
    if (!timelineEnd || !Number.isFinite(timelineEnd) || trendPoints.length < 2) return false
    return trendPoints.some((p) => p.wpm != null || p.fluency != null || p.confidence != null)
  }, [trendPoints, timelineEnd])

  // "Key moments" — the most instructive turns, derived only from real per-turn
  // metrics. Each is a one-click jump so the user can hear the evidence behind
  // their scores (traceability), not just read a number.
  const keyMoments = useMemo(() => {
    const us = turns.filter((t) => t.role === 'user' && t.audioStart != null)
    if (us.length < 2) return []
    type Tone = 'good' | 'warn' | 'bad'
    const out: {
      id: string
      label: string
      detail: string
      time: number
      tone: Tone
      icon: typeof Star
    }[] = []
    const seen = new Set<number>()

    const withQ = us
      .map((t) => ({ t, q: turnQuality(t) }))
      .filter((x): x is { t: ReplayTurn; q: { score: number; tone: QualityTone } } => !!x.q)
    if (withQ.length) {
      const best = withQ.reduce((a, b) => (b.q.score > a.q.score ? b : a))
      out.push({
        id: 'best',
        label: 'Strongest turn',
        detail: 'highest quality',
        time: best.t.audioStart as number,
        tone: 'good',
        icon: Star,
      })
      seen.add(best.t.turnIndex)
    }

    const withWpm = us.filter((t) => t.metrics?.wpm != null)
    if (withWpm.length) {
      const fast = withWpm.reduce((a, b) => ((b.metrics!.wpm as number) > (a.metrics!.wpm as number) ? b : a))
      out.push({
        id: 'fast',
        label: 'Fastest pace',
        detail: `${Math.round(fast.metrics!.wpm as number)} WPM`,
        time: fast.audioStart as number,
        tone: 'warn',
        icon: Zap,
      })
      seen.add(fast.turnIndex)
      const slow = withWpm.reduce((a, b) => ((b.metrics!.wpm as number) < (a.metrics!.wpm as number) ? b : a))
      if (!seen.has(slow.turnIndex)) {
        out.push({
          id: 'slow',
          label: 'Slowest pace',
          detail: `${Math.round(slow.metrics!.wpm as number)} WPM`,
          time: slow.audioStart as number,
          tone: 'warn',
          icon: Turtle,
        })
        seen.add(slow.turnIndex)
      }
    }

    const withFill = us.filter((t) => (t.metrics?.filler_count ?? 0) > 0)
    if (withFill.length) {
      const mf = withFill.reduce((a, b) =>
        (b.metrics!.filler_count as number) > (a.metrics!.filler_count as number) ? b : a,
      )
      out.push({
        id: 'fill',
        label: 'Most fillers',
        detail: `${mf.metrics!.filler_count} filler${mf.metrics!.filler_count === 1 ? '' : 's'}`,
        time: mf.audioStart as number,
        tone: 'bad',
        icon: MessageSquare,
      })
    }

    return out.sort((a, b) => a.time - b.time)
  }, [turns])

  // Map an analytics skill → the most relevant per-turn moment to "hear". Only
  // skills backed by real per-turn signals resolve to a time; the rest return
  // null so the analytics card can hide the link (no fake evidence).
  const momentTimeForSkill = useCallback(
    (skill: string): number | null => {
      const us = turns.filter((t) => t.role === 'user' && t.audioStart != null)
      if (!us.length) return null
      if (skill === 'pacing') {
        const w = us.filter((t) => t.metrics?.wpm != null)
        if (!w.length) return null
        const f = w.reduce((a, b) => ((b.metrics!.wpm as number) > (a.metrics!.wpm as number) ? b : a))
        return f.audioStart as number
      }
      if (skill === 'conciseness') {
        const w = us.filter((t) => (t.metrics?.filler_count ?? 0) > 0)
        if (!w.length) return null
        const f = w.reduce((a, b) =>
          (b.metrics!.filler_count as number) > (a.metrics!.filler_count as number) ? b : a,
        )
        return f.audioStart as number
      }
      if (skill === 'confidence' || skill === 'emotionalControl') {
        const val = (t: ReplayTurn): number | null => {
          if (t.score?.confidence != null) return t.score.confidence > 1 ? t.score.confidence / 10 : t.score.confidence
          if (t.score?.stars != null) return t.score.stars / 5
          return null
        }
        const w = us.filter((t) => val(t) != null)
        if (!w.length) return null
        const f = w.reduce((a, b) => ((val(b) as number) < (val(a) as number) ? b : a))
        return f.audioStart as number
      }
      return null
    },
    [turns],
  )

  // Consume a focus request once both turns and (when present) audio are ready.
  useEffect(() => {
    if (!focusRequest) return
    if (handledFocusRef.current === focusRequest.nonce) return
    if (turns.length === 0) return
    const time = momentTimeForSkill(focusRequest.skill)
    if (time == null) {
      handledFocusRef.current = focusRequest.nonce
      return
    }
    // Wait for audio to be ready so we can actually play the moment.
    if (audioAvailable && !audioUrl) return
    handledFocusRef.current = focusRequest.nonce

    // Scroll the matching turn into view immediately for visual confirmation.
    const target = turns.find(
      (t) => t.role === 'user' && t.audioStart != null && Math.abs((t.audioStart as number) - time) < 0.01,
    )
    if (target) {
      const el = turnRefs.current[target.turnIndex]
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    if (audioUrl) playFrom(time)
    else seekTo(time)
  }, [focusRequest, turns, audioUrl, audioAvailable, momentTimeForSkill, playFrom, seekTo])

  useLayoutEffect(() => {
    const measure = () => {
      const bar = transportRef.current
      const track = trackWrapRef.current
      if (!bar || !track) return
      const b = bar.getBoundingClientRect()
      const t = track.getBoundingClientRect()
      const padL = parseFloat(getComputedStyle(bar).paddingLeft) || 0
      setTrackBox({ left: t.left - (b.left + padL), width: t.width })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (transportRef.current) ro.observe(transportRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [showTrends, duration, turns.length, hasTimings, roleFilter])

  // Contiguous spans of YOUR speech (from the audio-aligned turns). Used to skip
  // the blank stretches where the coach is replying (silent on the user track).
  const userIntervals = useMemo(
    () =>
      turns
        .filter((t) => t.role === 'user' && t.audioStart != null)
        .map((t) => ({
          start: t.audioStart as number,
          end: t.audioEnd ?? (t.audioStart as number) + 0.1,
        }))
        .sort((a, b) => a.start - b.start),
    [turns],
  )

  // When "Skip gaps" is on, hop the playhead over any time that isn't inside one
  // of your speech spans (greeting lead-in + coach replies) so playback is a
  // back-to-back reel of just your turns.
  const handleTimeUpdate = useCallback(
    (e: React.SyntheticEvent<HTMLAudioElement>) => {
      const a = e.currentTarget
      const t = a.currentTime
      // Stop at the user's last turn — ignore trailing coach audio / silence.
      if (timelineEnd && Number.isFinite(timelineEnd) && t >= timelineEnd - 0.05 && !a.paused) {
        a.pause()
        a.currentTime = timelineEnd
        setCurrentTime(timelineEnd)
        return
      }
      if (skipGaps && userIntervals.length > 0 && !a.paused) {
        const inside = userIntervals.some(
          (iv) => t >= iv.start - 0.08 && t <= iv.end + 0.25,
        )
        if (!inside) {
          const next = userIntervals.find((iv) => iv.start > t + 0.08)
          if (next) {
            a.currentTime = next.start
            setCurrentTime(next.start)
            return
          }
          a.pause()
        }
      }
      setCurrentTime(t)
    },
    [skipGaps, userIntervals, timelineEnd],
  )

  // ── Render ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading playback…
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <Link to="/history?tab=elevate">
            <Button variant="outline" size="sm" className="mt-4">
              Back to Sessions
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  if (turns.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center">
          <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-medium">No playback available</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            This session was recorded before per-turn playback was enabled, or no
            turns were captured. New sessions will have full playback.
          </p>
          <Link to="/history?tab=elevate">
            <Button variant="outline" size="sm" className="mt-4">
              Back to Sessions
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="pb-32">
      {/* Header */}
      <div className="mb-4">
        {!embedded && (
          <>
            <Link
              to="/history?tab=elevate"
              className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Sessions
            </Link>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Playback
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold">{sessionTitle(sessionInfo)}</h1>
              {sessionInfo?.module && (
                <Badge variant="secondary" className="capitalize">
                  {MODULE_LABELS[(sessionInfo.module || '').toLowerCase()] || sessionInfo.module}
                </Badge>
              )}
            </div>
          </>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {formatSessionDate(sessionInfo?.startedAt) && (
            <span>{formatSessionDate(sessionInfo?.startedAt)}</span>
          )}
          {sessionInfo?.focusArea && (
            <span className="capitalize">Focus: {sessionInfo.focusArea.replace(/_/g, ' ')}</span>
          )}
          <span>{turns.length} turns</span>
          <span>{userTurnCount} of yours</span>
          {!audioAvailable && <span className="text-amber-600">Transcript-only (no audio)</span>}
          {audioAvailable && !hasTimings && (
            <span className="text-amber-600">Audio available · per-turn seek limited</span>
          )}
        </div>
      </div>

      {degraded && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing the saved transcript. Per-message timing and metrics weren't captured for this
          session — new sessions will include synced highlighting and per-turn analytics.
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border p-0.5">
          {(['all', 'user', 'assistant'] as RoleFilter[]).map((r) => {
            const disabled = r === 'assistant' && coachDisabled
            return (
              <button
                key={r}
                onClick={() => !disabled && setRoleFilter(r)}
                disabled={disabled}
                title={
                  disabled ? 'Coach turns are hidden while a quality filter is active' : undefined
                }
                className={`rounded px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  roleFilter === r
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {r === 'assistant' ? 'Coach' : r === 'user' ? 'You' : 'All'}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {QUALITY_CHIPS.map(({ key, label }) => {
            const active = chips.has(key)
            return (
              <button
                key={key}
                onClick={() => toggleChip(key)}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            )
          })}
        </div>
        {/* Ask AI Coach — conversational Q&A over this session (Pro) */}
        <div className="relative ml-auto w-full max-w-xs" title="Ask AI Coach is a Pro version feature">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value=""
            readOnly
            disabled
            placeholder="Ask AI Coach about this session…"
            className="h-8 cursor-not-allowed pl-8 pr-14 text-xs"
          />
          <Badge
            variant="secondary"
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
          >
            Pro
          </Badge>
        </div>
      </div>

      {effectiveChips.size > 0 && (
        <div className="mb-3 text-xs text-muted-foreground">
          <span>
            Showing your turns matching{' '}
            <span className="font-medium text-foreground">
              {Array.from(effectiveChips)
                .map((i) => QUALITY_CHIPS.find((q) => q.key === i)?.label ?? i)
                .join(', ')}
            </span>
            {' · '}
          </span>
          <span>
            {visibleTurns.length} snippet{visibleTurns.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      {/* Key moments — jump straight to the evidence behind the scores (Pro) */}
      {audioAvailable && keyMoments.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <span>Key moments — tap to hear the evidence</span>
            {!isPro && (
              <Badge
                variant="secondary"
                className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide"
              >
                <Lock className="mr-1 h-2.5 w-2.5" /> Pro
              </Badge>
            )}
          </div>
          <div
            className="flex flex-wrap gap-2"
            title={isPro ? undefined : 'Key moments is a Pro version feature'}
          >
            {keyMoments.map((mo) => {
              const toneCls =
                mo.tone === 'good'
                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  : mo.tone === 'bad'
                    ? 'border-red-300 text-red-700 hover:bg-red-50'
                    : 'border-amber-300 text-amber-700 hover:bg-amber-50'
              return (
                <button
                  key={mo.id}
                  onClick={isPro ? () => playFrom(mo.time) : undefined}
                  disabled={!isPro || !audioUrl}
                  title={isPro ? `Play from ${formatTime(mo.time)}` : 'Pro version feature'}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
                >
                  <mo.icon className="h-3.5 w-3.5" />
                  <span className="font-medium">{mo.label}</span>
                  <span className="opacity-70">· {mo.detail}</span>
                  <span className="tabular-nums opacity-60">{formatTime(mo.time)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div className="space-y-3">
        {visibleTurns.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No turns match these filters.
            </CardContent>
          </Card>
        )}
        {visibleTurns.map((turn) => (
          <TurnBubble
            key={turn.id}
            turn={turn}
            isActive={turn.turnIndex === activeTurnIndex}
            currentTime={currentTime}
            audioAvailable={audioAvailable && turn.audioStart != null}
            transcriptHidden={transcriptHidden}
            onPlayFrom={playFrom}
            suggestion={suggestions[turn.turnIndex]}
            registerRef={(el) => {
              turnRefs.current[turn.turnIndex] = el
            }}
          />
        ))}
      </div>

      {/* Sticky transport */}
      {audioAvailable && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div ref={transportRef} className="mx-auto max-w-6xl px-4 py-3">
            {trendsAvailable && showTrends && (
              <div
                style={{
                  marginLeft: trackBox?.left ?? 0,
                  width: trackBox?.width ?? undefined,
                }}
              >
                <TrendsRibbon
                  points={trendPoints}
                  duration={timelineEnd}
                  currentTime={currentTime}
                  onSeek={seekTo}
                />
              </div>
            )}
            <div className="flex items-center gap-3">
            <Button
              size="icon"
              onClick={togglePlay}
              disabled={!audioUrl || roleFilter === 'assistant'}
              title={
                roleFilter === 'assistant'
                  ? "Coach turns have no audio on this track — switch to All or You to play"
                  : undefined
              }
              className="h-10 w-10 shrink-0 rounded-full"
            >
              {audioLoading && !audioUrl ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>

            <button
              onClick={() => setSkipGaps((v) => !v)}
              title="Skip the blank stretches where the coach is replying"
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                skipGaps
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <FastForward className="h-3.5 w-3.5" /> Skip gaps
            </button>

            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
              {formatTime(currentTime)}
            </span>

            <div ref={trackWrapRef} className="relative flex-1">
            {hasTimings && qualitySegments.length > 0 && timelineEnd ? (
              // Quality timeline: each user turn is a colored segment (green/amber/
              // red) positioned by its audio interval. Still fully seekable.
              <div
                className="group relative h-2.5 w-full cursor-pointer overflow-hidden rounded-full bg-muted"
                onClick={onScrubberClick}
                title="Conversation quality timeline — click to jump"
              >
                {qualitySegments.map((seg) => (
                  <div
                    key={seg.turnIndex}
                    className={`absolute inset-y-0 ${seg.tone ? QUALITY_FILL[seg.tone] : 'bg-muted-foreground/30'}`}
                    style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
                    title={seg.title}
                  />
                ))}
                {/* Dim the portion already played */}
                <div
                  className="absolute inset-y-0 left-0 bg-background/45"
                  style={{ width: `${Math.min(100, (currentTime / timelineEnd) * 100)}%` }}
                />
                {/* Playhead */}
                <div
                  className="absolute top-1/2 h-4 w-1 -translate-y-1/2 -translate-x-1/2 rounded-full bg-foreground shadow"
                  style={{ left: `${Math.min(100, (currentTime / timelineEnd) * 100)}%` }}
                />
              </div>
            ) : (
              <div
                className="group relative h-2 w-full cursor-pointer rounded-full bg-muted"
                onClick={onScrubberClick}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: timelineEnd ? `${Math.min(100, (currentTime / timelineEnd) * 100)}%` : '0%' }}
                />
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100"
                  style={{ left: timelineEnd ? `${Math.min(100, (currentTime / timelineEnd) * 100)}%` : '0%' }}
                />
              </div>
            )}
            </div>

            <span className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">
              {formatTime(timelineEnd)}
            </span>

            <button
              onClick={() => setRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length])}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              title="Playback speed"
            >
              <Gauge className="h-3.5 w-3.5" /> {rate}×
            </button>

            {trendsAvailable && (
              <button
                onClick={() => setShowTrends((v) => !v)}
                title="Show pace / fluency / confidence trends over the conversation"
                className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                  showTrends
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" /> Trends
              </button>
            )}

            <Button
              size="icon"
              variant="ghost"
              className="h-9 w-9 shrink-0"
              onClick={() => {
                const a = audioRef.current
                if (!a) return
                a.muted = !a.muted
                setMuted(a.muted)
              }}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>
            </div>
          </div>
        </div>
      )}

      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          onLoadedMetadata={(e) => {
            const a = e.currentTarget
            const d = a.duration
            if (Number.isFinite(d) && d > 0) {
              setDuration(d)
              return
            }
            // MediaRecorder webm blobs report duration=Infinity until the browser
            // seeks to the end. Force it to resolve, then snap back to the start.
            const resolve = () => {
              a.removeEventListener('timeupdate', resolve)
              setDuration(Number.isFinite(a.duration) ? a.duration : 0)
              a.currentTime = 0
            }
            a.addEventListener('timeupdate', resolve)
            try {
              a.currentTime = 1e7
            } catch {
              a.removeEventListener('timeupdate', resolve)
            }
          }}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  )
}

// ── Trends ribbon ──────────────────────────────────────────────────────
// Pace / Fluency / Confidence over the conversation, sharing the playback
// timeline. Click anywhere to seek; the playhead line stays in sync.
interface TrendPoint {
  time: number
  wpm: number | null
  fluency: number | null
  confidence: number | null
}

const TREND_SERIES: {
  key: 'wpm' | 'fluency' | 'confidence'
  label: string
  color: string
  max: number
  unit: string
}[] = [
  { key: 'wpm', label: 'Pace', color: '#22c55e', max: 200, unit: 'WPM' },
  { key: 'fluency', label: 'Fluency', color: '#a855f7', max: 10, unit: '/10' },
  { key: 'confidence', label: 'Confidence', color: '#0ea5e9', max: 10, unit: '/10' },
]

function TrendsRibbon({
  points,
  duration,
  currentTime,
  onSeek,
}: {
  points: TrendPoint[]
  duration: number
  currentTime: number
  onSeek: (t: number) => void
}) {
  const [hoverRatio, setHoverRatio] = useState<number | null>(null)
  const W = 1000
  const H = 100
  const padT = 8
  const padB = 8
  const innerH = H - padT - padB

  const activeSeries = useMemo(
    () => TREND_SERIES.filter((s) => points.some((p) => p[s.key] != null)),
    [points],
  )

  if (!duration || !Number.isFinite(duration) || activeSeries.length === 0) return null

  const x = (time: number) => (Math.max(0, Math.min(duration, time)) / duration) * W
  const y = (v: number, max: number) => padT + innerH - Math.max(0, Math.min(1, v / max)) * innerH

  const playheadX = (currentTime / duration) * 100

  const nearest =
    hoverRatio != null
      ? points.reduce<TrendPoint | null>((best, p) => {
          const d = Math.abs(p.time - hoverRatio * duration)
          if (!best) return p
          return d < Math.abs(best.time - hoverRatio * duration) ? p : best
        }, null)
      : null

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    onSeek(ratio * duration)
  }

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-3 text-[10px] text-muted-foreground">
        {activeSeries.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1">
            <span className="h-0.5 w-3 rounded" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto opacity-70">click to jump</span>
      </div>

      <div
        className="relative h-16 w-full cursor-pointer rounded-md border bg-muted/20"
        onClick={handleSeek}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          setHoverRatio((e.clientX - rect.left) / rect.width)
        }}
        onMouseLeave={() => setHoverRatio(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="none">
          {activeSeries.map((s) => {
            const pts = points
              .filter((p) => p[s.key] != null)
              .map((p) => `${x(p.time)},${y(p[s.key] as number, s.max)}`)
              .join(' ')
            return (
              <polyline
                key={s.key}
                points={pts}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
          {activeSeries.flatMap((s) =>
            points
              .filter((p) => p[s.key] != null)
              .map((p, i) => (
                <circle key={`${s.key}-${i}`} cx={x(p.time)} cy={y(p[s.key] as number, s.max)} r={2} fill={s.color} />
              )),
          )}
        </svg>

        {/* Playhead */}
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
          style={{ left: `${playheadX}%` }}
        />

        {/* Hover guide + tooltip */}
        {hoverRatio != null && nearest && (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30"
              style={{ left: `${hoverRatio * 100}%` }}
            />
            <div
              className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[10px] shadow"
              style={{ left: `${Math.max(8, Math.min(92, hoverRatio * 100))}%` }}
            >
              <div className="mb-0.5 font-medium text-foreground">{formatTime(nearest.time)}</div>
              {activeSeries.map((s) => {
                const v = nearest[s.key]
                if (v == null) return null
                return (
                  <div key={s.key} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="ml-auto font-medium text-foreground">
                      {s.key === 'wpm' ? Math.round(v) : v.toFixed(1)} {s.unit}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Per-turn bubble ────────────────────────────────────────────────────
function TurnBubble({
  turn,
  isActive,
  currentTime,
  audioAvailable,
  transcriptHidden,
  onPlayFrom,
  suggestion,
  registerRef,
}: {
  turn: ReplayTurn
  isActive: boolean
  currentTime: number
  audioAvailable: boolean
  transcriptHidden: boolean
  onPlayFrom: (t: number) => void
  suggestion?: TurnSuggestion
  registerRef: (el: HTMLDivElement | null) => void
}) {
  const isUser = turn.role === 'user'
  const m = turn.metrics
  const tip = turn.coachNote || m?.coaching_tip

  return (
    <div
      ref={registerRef}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-2xl border p-3 transition-shadow ${
          isUser ? 'bg-primary/5' : 'bg-muted/40'
        } ${isActive ? 'ring-2 ring-primary shadow-md' : ''}`}
      >
        {/* Header row */}
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {isUser ? 'You' : 'Coach'}
          </span>
          {turn.audioStart != null && (
            <button
              onClick={() => audioAvailable && onPlayFrom(turn.audioStart as number)}
              disabled={!audioAvailable}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-40"
              title={audioAvailable ? 'Play from here' : 'Audio unavailable'}
            >
              <Play className="h-3 w-3" /> {formatTime(turn.audioStart)}
            </button>
          )}
          {turn.score?.stars != null && (
            <span className="inline-flex items-center gap-0.5 text-amber-500">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3 w-3 ${i < (turn.score?.stars ?? 0) ? 'fill-current' : 'opacity-25'}`}
                />
              ))}
            </span>
          )}
        </div>

        {/* Text (with karaoke when active + word timings present) */}
        <div className="text-sm leading-relaxed">
          {transcriptHidden ? (
            <span className="italic text-muted-foreground">Transcript hidden for your account</span>
          ) : isUser && turn.words && turn.words.length > 0 ? (
            <Karaoke
              words={turn.words}
              currentTime={currentTime}
              active={isActive}
              onSeek={(t) => onPlayFrom(t)}
            />
          ) : (
            turn.text
          )}
        </div>

        {/* Metric chips (user turns) */}
        {isUser && m && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {m.wpm != null && (
              <Badge variant="secondary" className="text-[10px]">
                {Math.round(m.wpm)} WPM
              </Badge>
            )}
            {m.filler_count != null && m.filler_count > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {m.filler_count} filler{m.filler_count === 1 ? '' : 's'}
              </Badge>
            )}
            {m.hedging_count != null && m.hedging_count > 0 && (
              <Badge variant="outline" className="text-[10px]">
                {m.hedging_count} hedge{m.hedging_count === 1 ? '' : 's'}
              </Badge>
            )}
            {m.vocab_diversity != null && (
              <Badge variant="outline" className="text-[10px]">
                {Math.round(m.vocab_diversity * 100)}% variety
              </Badge>
            )}
            {turn.score?.tags?.map((t) => (
              <Badge key={t} variant="secondary" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>
        )}

        {/* AI phrasing suggestion (preferred over the rule-based tip — it's
            more specific) when the coach found something worth rephrasing. */}
        {isUser && suggestion ? (
          <div className="mt-2 rounded-md border border-violet-300/60 bg-violet-500/10 p-2 text-[11px] text-violet-800 dark:text-violet-300">
            <div className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-3 w-3 shrink-0" />
              <span>AI coach</span>
              <span className="rounded bg-violet-500/15 px-1 py-px text-[9px] uppercase tracking-wide">
                {SUGGESTION_KIND_LABEL[suggestion.kind]}
              </span>
            </div>
            <p className="mt-1 leading-snug">{suggestion.suggestion}</p>
            {suggestion.rewrite && (
              <p className="mt-1 border-l-2 border-violet-400/50 pl-2 italic leading-snug text-violet-700/90 dark:text-violet-200/80">
                Try: “{suggestion.rewrite}”
              </p>
            )}
          </div>
        ) : (
          isUser &&
          tip && (
            <div className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{tip}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Karaoke word highlighting ──────────────────────────────────────────
// Band of words highlighted around the current position. Per-word timings are
// estimated (no forced alignment), so highlighting a span keeps the spoken word
// inside the lit region even when a single-word estimate would drift.
const KARAOKE_BEHIND = 3
const KARAOKE_AHEAD = 3

function Karaoke({
  words,
  currentTime,
  active,
  onSeek,
}: {
  words: TurnWord[]
  currentTime: number
  active: boolean
  onSeek: (t: number) => void
}) {
  // Index of the latest word whose estimated start has passed — the centre of
  // the highlighted band.
  let cur = -1
  if (active) {
    for (let i = 0; i < words.length; i++) {
      if (currentTime >= words[i].start) cur = i
      else break
    }
    if (cur < 0 && currentTime > 0) cur = 0
  }
  const bandStart = cur - KARAOKE_BEHIND
  const bandEnd = cur + KARAOKE_AHEAD

  return (
    <span>
      {words.map((word, i) => {
        const inBand = active && cur >= 0 && i >= bandStart && i <= bandEnd
        const isPast = active && cur >= 0 && i < bandStart
        return (
          <span
            key={i}
            onClick={() => onSeek(word.start)}
            className={`cursor-pointer px-0.5 transition-colors ${
              inBand
                ? 'bg-primary/25 text-foreground'
                : isPast
                  ? 'text-foreground/90'
                  : 'text-muted-foreground/70'
            } hover:bg-primary/10`}
          >
            {word.w}{' '}
          </span>
        )
      })}
    </span>
  )
}

export default SessionReplay
