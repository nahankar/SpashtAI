import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { getAuthHeaders, getAuthenticatedMediaUrl } from '@/lib/api-client'
import { useIsPro } from '@/hooks/useIsPro'
import { UserTurnBubble, normalizeTurnMetricsFromApi } from '@/components/session/UserTurnMetrics'

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

const WORD_CLUSTER_GAP_SEC = 2.5
/** Short orphan blips at a turn start (e.g. "schedule?") belong on the prior turn. */
const LEAD_WORDS_MERGE_TO_PREV = 3

type WordCluster = { words: TurnWord[]; start: number; end: number; weight: number }

function clusterTurnWords(words: TurnWord[], gapSec = WORD_CLUSTER_GAP_SEC): WordCluster[] {
  const sorted = words
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .sort((a, b) => a.start - b.start)
  if (sorted.length === 0) return []

  const clusters: WordCluster[] = []
  let cur: WordCluster = {
    words: [sorted[0]],
    start: sorted[0].start,
    end: sorted[0].end,
    weight: 1,
  }
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start - cur.end > gapSec) {
      clusters.push(cur)
      cur = { words: [sorted[i]], start: sorted[i].start, end: sorted[i].end, weight: 1 }
    } else {
      cur.words.push(sorted[i])
      cur.end = Math.max(cur.end, sorted[i].end)
      cur.weight += 1
    }
  }
  clusters.push(cur)
  return clusters
}

function pickMainWordCluster(clusters: WordCluster[]): WordCluster | null {
  if (clusters.length === 0) return null
  return clusters.reduce((a, b) => {
    const scoreA = (a.end - a.start) * a.weight
    const scoreB = (b.end - b.start) * b.weight
    return scoreB > scoreA ? b : a
  })
}

function isNoiseWordCluster(cluster: WordCluster): boolean {
  return (
    cluster.words.length === 1 && cluster.words[0].w.replace(/[^\w]/g, '').length <= 1
  )
}

interface TurnPresentation {
  words: TurnWord[]
  playStart: number | null
  playEnd: number | null
}

/** Fix STT word bleed across turns; keep conversation text from turn.text (Analytics). */
function normalizeTurnPresentations(turns: ReplayTurn[]): Map<number, TurnPresentation> {
  const userTurns = turns.filter((t) => t.role === 'user')
  const out = new Map<number, TurnPresentation>()
  let prevTurnIndex: number | null = null

  for (const turn of userTurns) {
    if (!turn.words?.length) {
      out.set(turn.turnIndex, {
        words: [],
        playStart: turn.audioStart ?? null,
        playEnd: turn.audioEnd ?? null,
      })
      prevTurnIndex = turn.turnIndex
      continue
    }

    let clusters = clusterTurnWords(turn.words)

    while (
      clusters.length > 1 &&
      prevTurnIndex != null &&
      clusters[0].words.length <= LEAD_WORDS_MERGE_TO_PREV
    ) {
      const lead = clusters.shift()!
      const prev = out.get(prevTurnIndex)
      if (prev) {
        out.set(prevTurnIndex, {
          words: [...prev.words, ...lead.words],
          playStart: prev.playStart ?? lead.start,
          playEnd: lead.end,
        })
      }
    }

    while (clusters.length > 1 && isNoiseWordCluster(clusters[0])) {
      clusters.shift()
    }

    const main = pickMainWordCluster(clusters)
    if (main) {
      out.set(turn.turnIndex, {
        words: main.words,
        playStart: main.start,
        playEnd: main.end,
      })
    } else {
      out.set(turn.turnIndex, {
        words: [],
        playStart: turn.audioStart ?? null,
        playEnd: turn.audioEnd ?? null,
      })
    }
    prevTurnIndex = turn.turnIndex
  }

  return out
}

function buildSkipIntervalsFromTurnWords(
  turns: ReplayTurn[],
  gapSec = WORD_CLUSTER_GAP_SEC,
): { start: number; end: number }[] {
  const presentations = normalizeTurnPresentations(turns)
  const out: { start: number; end: number }[] = []

  for (const turn of turns) {
    if (turn.role !== 'user') continue
    const pres = presentations.get(turn.turnIndex)
    if (pres?.playStart != null && pres.playEnd != null) {
      out.push({ start: pres.playStart, end: pres.playEnd })
    } else if (turn.audioStart != null) {
      out.push({
        start: turn.audioStart,
        end: turn.audioEnd ?? turn.audioStart + 0.1,
      })
    }
  }

  return out.sort((a, b) => a.start - b.start)
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]

export function SessionReplay({
  sessionId: sessionIdProp,
  embedded = false,
  focusRequest = null,
  autoPlayNonce = null,
}: {
  /** Override the route param so this can render inside the Elevate results tab. */
  sessionId?: string
  /** Hide the page header (back link + title) when shown inside another view. */
  embedded?: boolean
  /** @deprecated Use autoPlayNonce — kept so older callers compile. */
  focusRequest?: { skill: string; nonce: number } | null
  /** Bump to auto-press Play once the transport is ready (Elevate "Hear it"). */
  autoPlayNonce?: number | null
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
  const [speechRegions, setSpeechRegions] = useState<{ start: number; end: number }[]>([])
  const [skipPlaybackRegions, setSkipPlaybackRegions] = useState<{ start: number; end: number }[]>([])
  const [suggestions, setSuggestions] = useState<Record<number, TurnSuggestion>>({})
  // Used to line the trends ribbon up horizontally with the seek track (the
  // track is only the middle flex-1 region, not the full transport width).
  const transportRef = useRef<HTMLDivElement>(null)
  const trackWrapRef = useRef<HTMLDivElement>(null)
  const [trackBox, setTrackBox] = useState<{ left: number; width: number } | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const skipSeekingRef = useRef(false)
  const turnRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const handledFocusRef = useRef<number | null>(null)
  const effectiveAutoPlayNonce = autoPlayNonce ?? focusRequest?.nonce ?? null

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
        setSpeechRegions(
          Array.isArray(data.speechRegions)
            ? data.speechRegions.filter(
                (r: { start?: unknown; end?: unknown }) =>
                  typeof r?.start === 'number' && typeof r?.end === 'number',
              )
            : [],
        )
        setSkipPlaybackRegions(
          Array.isArray(data.skipPlaybackRegions)
            ? data.skipPlaybackRegions.filter(
                (r: { start?: unknown; end?: unknown }) =>
                  typeof r?.start === 'number' && typeof r?.end === 'number',
              )
            : [],
        )
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

  // Stream via authenticated URL so the browser can range-seek (blob WebM skips fail).
  useEffect(() => {
    if (!sessionId) return
    setAudioLoading(true)
    const url = getAuthenticatedMediaUrl(`/sessions/${sessionId}/recording/stream`)
    if (!url) {
      setAudioUrl(null)
      setAudioAvailable(false)
      setAudioLoading(false)
      return
    }
    setAudioUrl(url)
    setAudioAvailable(true)
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
    const audioDuration =
      duration && Number.isFinite(duration) && duration > 0 ? duration : null
    if (lastUserEnd > 0) {
      if (audioDuration == null) return lastUserEnd
      if (lastUserEnd < audioDuration) return lastUserEnd
      return audioDuration
    }
    if (audioDuration == null) return duration ?? 0
    return audioDuration
  }, [lastUserEnd, duration])

  // ── Transport ────────────────────────────────────────────────────────
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

  // Per-turn word clusters match manual playback (e.g. 0:18–0:49, 1:18–1:20, …).
  const wordSkipIntervals = useMemo(
    () => buildSkipIntervalsFromTurnWords(turns),
    [turns],
  )

  const skipIntervals = useMemo(() => {
    if (wordSkipIntervals.length > 0) return wordSkipIntervals

    const firstUserStart = turns.find(
      (t) => t.role === 'user' && t.audioStart != null,
    )?.audioStart as number | undefined
    const minStart = firstUserStart != null ? firstUserStart - 1.5 : 0

    const regions =
      skipPlaybackRegions.length > 0
        ? skipPlaybackRegions
        : speechRegions.length > 0
          ? speechRegions
          : []
    if (regions.length > 0) {
      return regions
        .filter((r) => r.end > minStart)
        .sort((a, b) => a.start - b.start)
    }
    return userIntervals
  }, [wordSkipIntervals, speechRegions, skipPlaybackRegions, userIntervals, turns])

  const resolveSkipGapsTime = useCallback(
    (t: number): number | 'stop' | null => {
      if (!skipGaps || skipIntervals.length === 0) return null
      const inside = skipIntervals.some(
        (iv) => t >= iv.start - 0.05 && t <= iv.end + 0.05,
      )
      if (inside) return null
      const next = skipIntervals.find((iv) => iv.start > t + 0.08)
      if (next) return next.start
      return 'stop'
    },
    [skipGaps, skipIntervals],
  )

  const applySkipGapsSeek = useCallback(
    (audio: HTMLAudioElement): Promise<void> =>
      new Promise((resolve) => {
        const finish = () => {
          skipSeekingRef.current = false
          resolve()
        }

        if (skipSeekingRef.current) {
          const wait = window.setInterval(() => {
            if (!skipSeekingRef.current) {
              window.clearInterval(wait)
              void applySkipGapsSeek(audio).then(resolve)
            }
          }, 20)
          return
        }

        const resolved = resolveSkipGapsTime(audio.currentTime)
        if (resolved === null) {
          resolve()
          return
        }
        if (resolved === 'stop') {
          const end =
            timelineEnd && Number.isFinite(timelineEnd) ? timelineEnd : audio.currentTime
          audio.pause()
          audio.currentTime = end
          setCurrentTime(end)
          resolve()
          return
        }
        if (Math.abs(audio.currentTime - resolved) < 0.05) {
          resolve()
          return
        }

        skipSeekingRef.current = true
        audio.pause()
        const onSeeked = () => {
          audio.removeEventListener('seeked', onSeeked)
          finish()
        }
        audio.addEventListener('seeked', onSeeked)
        audio.currentTime = resolved
        setCurrentTime(resolved)
        window.setTimeout(() => {
          if (skipSeekingRef.current) onSeeked()
        }, 150)
      }),
    [resolveSkipGapsTime, timelineEnd],
  )

  const syncSkipGapsDuringPlay = useCallback(
    async (audio: HTMLAudioElement) => {
      const wasPlaying = !audio.paused
      await applySkipGapsSeek(audio)
      if (wasPlaying && audio.paused) void audio.play()
    },
    [applySkipGapsSeek],
  )

  const togglePlay = useCallback(async () => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      const end =
        timelineEnd && Number.isFinite(timelineEnd) ? timelineEnd : duration
      if (end && Number.isFinite(end) && a.currentTime >= end - 0.15) {
        a.currentTime = 0
        setCurrentTime(0)
      }
      await applySkipGapsSeek(a)
      void a.play()
    } else {
      a.pause()
    }
  }, [applySkipGapsSeek, timelineEnd, duration])

  const seekTo = useCallback(
    async (t: number) => {
      const a = audioRef.current
      if (!a || !Number.isFinite(t)) return
      a.currentTime = Math.max(0, t)
      if (skipGaps) await applySkipGapsSeek(a)
      setCurrentTime(a.currentTime)
    },
    [skipGaps, applySkipGapsSeek],
  )

  const playFrom = useCallback(
    async (t: number) => {
      const a = audioRef.current
      if (!a || !Number.isFinite(t)) return
      a.currentTime = Math.max(0, t)
      if (skipGaps) await applySkipGapsSeek(a)
      setCurrentTime(a.currentTime)
      try {
        await a.play()
      } catch {
        /* browser may block autoplay when not directly tied to a click */
      }
    },
    [skipGaps, applySkipGapsSeek],
  )

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
  const turnPresentations = useMemo(() => normalizeTurnPresentations(turns), [turns])

  const activeTurnIndex = useMemo(() => {
    let active = -1
    for (const t of turns) {
      if (t.role !== 'user') continue
      const pres = turnPresentations.get(t.turnIndex)
      const start = pres?.playStart ?? t.audioStart
      const end = pres?.playEnd ?? t.audioEnd
      if (start == null) continue
      if (currentTime >= start && (end == null || currentTime <= end + 0.05)) {
        active = t.turnIndex
      }
    }
    return active
  }, [turns, turnPresentations, currentTime])

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

  // "Hear it" / Elevate deep link: land on Playback and press Play (skip gaps on).
  useEffect(() => {
    if (!effectiveAutoPlayNonce) return
    if (handledFocusRef.current === effectiveAutoPlayNonce) return
    if (turns.length === 0) return
    if (audioAvailable && !audioUrl) return
    const audio = audioRef.current
    if (audioAvailable && audioUrl && !audio) return
    if (audioLoading) return
    if (!timelineEnd || !Number.isFinite(timelineEnd) || timelineEnd <= 0) return
    // WebM often reports duration=Infinity until probed — wait so Play doesn't race it.
    if (
      audio &&
      (!duration || duration <= 0) &&
      (audio.duration === Infinity || !Number.isFinite(audio.duration))
    ) {
      return
    }

    handledFocusRef.current = effectiveAutoPlayNonce
    void togglePlay()
  }, [
    effectiveAutoPlayNonce,
    turns,
    audioUrl,
    audioAvailable,
    audioLoading,
    duration,
    timelineEnd,
    togglePlay,
  ])

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

  // Contiguous spans of YOUR speech (from the audio-aligned turns). Used for
  // karaoke / timeline when turn alignment succeeded.
  // skipIntervals (above) prefers ffmpeg speechRegions for gap skipping.

  // Snap immediately when skip-gaps is toggled on mid-session.
  useEffect(() => {
    if (!skipGaps) return
    const a = audioRef.current
    if (a) void applySkipGapsSeek(a)
  }, [skipGaps, applySkipGapsSeek])

  // timeupdate fires ~4×/s — poll faster while playing so gaps are not audible.
  useEffect(() => {
    if (!skipGaps || !isPlaying || skipIntervals.length === 0) return
    let raf = 0
    const tick = () => {
      const a = audioRef.current
      if (a && !a.paused && !skipSeekingRef.current) {
        const resolved = resolveSkipGapsTime(a.currentTime)
        if (
          resolved !== null &&
          (resolved === 'stop' || Math.abs(a.currentTime - resolved) >= 0.05)
        ) {
          void syncSkipGapsDuringPlay(a)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [skipGaps, isPlaying, skipIntervals.length, resolveSkipGapsTime, syncSkipGapsDuringPlay])

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
      if (skipGaps && skipIntervals.length > 0 && !a.paused && !skipSeekingRef.current) {
        const resolved = resolveSkipGapsTime(t)
        if (
          resolved !== null &&
          (resolved === 'stop' || Math.abs(t - resolved) >= 0.05)
        ) {
          void syncSkipGapsDuringPlay(a)
          return
        }
      }
      setCurrentTime(t)
    },
    [skipGaps, skipIntervals.length, timelineEnd, resolveSkipGapsTime, syncSkipGapsDuringPlay],
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
            presentation={turnPresentations.get(turn.turnIndex)}
            isActive={turn.turnIndex === activeTurnIndex}
            currentTime={currentTime}
            audioAvailable={audioAvailable}
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
            setAudioLoading(false)
            const d = a.duration
            if (Number.isFinite(d) && d > 0) {
              setDuration(d)
              return
            }
            // Some WebM files report duration=Infinity until the browser seeks to the end.
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
          onError={() => {
            setAudioLoading(false)
            setAudioAvailable(false)
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

// ── Per-turn bubble (matches Elevate conversation styling) ─────────────
function TurnBubble({
  turn,
  presentation,
  isActive,
  currentTime,
  audioAvailable,
  transcriptHidden,
  onPlayFrom,
  suggestion,
  registerRef,
}: {
  turn: ReplayTurn
  presentation?: TurnPresentation
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
  const playStart = presentation?.playStart ?? turn.audioStart
  const karaokeWords = presentation?.words?.length ? presentation.words : turn.words
  const turnMetrics = normalizeTurnMetricsFromApi(
    m
      ? {
          ...m,
          coaching_tip: tip ?? m.coaching_tip,
        }
      : null,
    turn.text,
  )

  const turnBody =
    transcriptHidden ? (
      <span className={`italic ${isUser ? 'text-white/80' : 'text-muted-foreground'}`}>
        Transcript hidden for your account
      </span>
    ) : isUser && karaokeWords && karaokeWords.length > 0 ? (
      <KaraokeText
        text={turn.text}
        words={karaokeWords}
        currentTime={currentTime}
        active={isActive}
        onSeek={(t) => onPlayFrom(t)}
        lightOnDark={isUser}
      />
    ) : (
      <p className="whitespace-pre-wrap break-words">{turn.text}</p>
    )

  return (
    <div
      ref={registerRef}
      className={`flex animate-in fade-in slide-in-from-bottom-2 duration-300 ${
        isUser ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`flex max-w-[85%] flex-col ${isUser ? 'items-end' : 'items-start'}`}
      >
        <div
          className={`rounded-2xl px-4 py-2.5 shadow-sm transition-shadow ${
            isUser
              ? `rounded-tr-sm bg-blue-500 text-white ${isActive ? 'ring-2 ring-blue-300 ring-offset-2' : ''}`
              : `rounded-tl-sm border border-gray-200 bg-gray-100 text-gray-900 dark:border-gray-700 dark:bg-muted dark:text-foreground ${
                  isActive ? 'ring-2 ring-primary/40 ring-offset-2' : ''
                }`
          }`}
        >
          {isUser && playStart != null && (
            <button
              onClick={() => audioAvailable && onPlayFrom(playStart)}
              disabled={!audioAvailable}
              className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-medium text-white/90 hover:bg-white/30 disabled:opacity-40"
              title={audioAvailable ? 'Play from here' : 'Audio unavailable'}
            >
              <Play className="h-3 w-3" /> {formatTime(playStart)}
            </button>
          )}

          <div className="text-[13px] leading-relaxed">
            {isUser && turnMetrics ? (
              <UserTurnBubble metrics={turnMetrics}>{turnBody}</UserTurnBubble>
            ) : (
              turnBody
            )}
          </div>

          {isUser && turn.score?.stars != null && (
            <span className="mt-1 inline-flex items-center gap-0.5 text-amber-200">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  className={`h-3 w-3 ${i < (turn.score?.stars ?? 0) ? 'fill-current' : 'opacity-25'}`}
                />
              ))}
            </span>
          )}
        </div>

        {!isUser && (
          <span className="mt-1 px-1 text-[10px] text-muted-foreground">Coach</span>
        )}

        {isUser && suggestion ? (
          <div className="mt-2 w-full rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200">
            <div className="flex items-center gap-1.5 font-medium">
              <Sparkles className="h-3 w-3 shrink-0" />
              <span>AI coach</span>
              <Badge variant="secondary" className="px-1 py-0 text-[9px] uppercase">
                {SUGGESTION_KIND_LABEL[suggestion.kind]}
              </Badge>
            </div>
            <p className="mt-1 leading-snug">{suggestion.suggestion}</p>
            {suggestion.rewrite && (
              <p className="mt-1 border-l-2 border-violet-300 pl-2 italic leading-snug opacity-90">
                Try: &ldquo;{suggestion.rewrite}&rdquo;
              </p>
            )}
          </div>
        ) : (
          isUser &&
          tip && (
            <div className="mt-2 flex w-full items-start gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{tip}</span>
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Karaoke highlighting on conversation text ──────────────────────────
const KARAOKE_BEHIND = 3
const KARAOKE_AHEAD = 3

function normalizeToken(s: string): string {
  return s.toLowerCase().replace(/[^\w]/g, '')
}

function KaraokeText({
  text,
  words,
  currentTime,
  active,
  onSeek,
  lightOnDark = false,
}: {
  text: string
  words: TurnWord[]
  currentTime: number
  active: boolean
  onSeek: (t: number) => void
  lightOnDark?: boolean
}) {
  let cur = -1
  if (active) {
    for (let i = 0; i < words.length; i++) {
      if (currentTime >= words[i].start) cur = i
      else break
    }
  }

  const bandStart = cur - KARAOKE_BEHIND
  const bandEnd = cur + KARAOKE_AHEAD

  // Walk turn.text and align timed words in order so trailing words (e.g.
  // "schedule?") stay on the correct turn even when STT attached them elsewhere.
  const parts: ReactNode[] = []
  let textIdx = 0
  let matched = 0

  for (let i = 0; i < words.length; i++) {
    const token = normalizeToken(words[i].w)
    if (!token) continue

    let pos = -1
    for (let scan = textIdx; scan < text.length; scan++) {
      const chunk = text.slice(scan)
      const m = chunk.match(/^[\s,;:.!?'"()-]*/)
      const afterPunct = scan + (m?.[0]?.length ?? 0)
      const candidate = text.slice(afterPunct, afterPunct + words[i].w.length + 4)
      if (normalizeToken(candidate.split(/\s/)[0] ?? '') === token) {
        pos = afterPunct
        break
      }
    }
    if (pos < 0) continue

    if (pos > textIdx) {
      parts.push(
        <span key={`gap-${i}`} className={lightOnDark ? 'text-white/90' : undefined}>
          {text.slice(textIdx, pos)}
        </span>,
      )
    }

    const surface = text.slice(pos).match(/^[^\s]+/)?.[0] ?? words[i].w
    const inBand = active && cur >= 0 && i >= bandStart && i <= bandEnd
    const isPast = active && cur >= 0 && i < bandStart

    parts.push(
      <span
        key={`w-${i}-${matched}`}
        onClick={() => onSeek(words[i].start)}
        className={`cursor-pointer rounded px-0.5 transition-colors ${
          inBand
            ? lightOnDark
              ? 'bg-white/30 text-white'
              : 'bg-primary/20 text-foreground'
            : isPast
              ? lightOnDark
                ? 'text-white'
                : 'text-foreground'
              : lightOnDark
                ? 'text-white/75'
                : 'text-muted-foreground'
        }`}
      >
        {surface}
      </span>,
    )
    textIdx = pos + surface.length
    matched++
  }

  if (textIdx < text.length) {
    parts.push(
      <span key="tail" className={lightOnDark ? 'text-white/90' : undefined}>
        {text.slice(textIdx)}
      </span>,
    )
  }

  if (matched === 0) {
    return <p className="whitespace-pre-wrap break-words">{text}</p>
  }

  return <p className="whitespace-pre-wrap break-words">{parts}</p>
}

export default SessionReplay
