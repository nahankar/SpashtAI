import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Target,
  MessageSquare,
  Download,
  ArrowLeft,
  RefreshCw,
  Loader2,
  User,
  Mic,
  ArrowRight,
} from 'lucide-react'
import type { ReplayResultData } from '@/hooks/useReplaySession'
import { inferFocusArea } from '@/lib/focus-areas'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

/** When user picks YYYY-MM-DD, anchor at local noon so calendar day is stable across time zones. */
function recordedAtFromDateInput(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00`).toISOString()
}

function recordedAtFromSessionMeetingDate(meetingDate: string | null | undefined): string | null {
  if (!meetingDate) return null
  const d = new Date(meetingDate)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

function getScoreTheme(score: number) {
  if (score >= 10) return { ring: '#22c55e', gap: '#dcfce7', micro: 'Excellent', target: 10 }
  if (score >= 9) return { ring: '#22c55e', gap: '#dcfce7', micro: 'Near Excellence', target: 10 }
  if (score >= 8) return { ring: '#22c55e', gap: '#fef3c7', micro: 'Great', target: 10 }
  if (score >= 6) return { ring: '#f59e0b', gap: '#fde68a', micro: `Improve to ${Math.ceil(score) + 1}+`, target: 9 }
  if (score >= 4) return { ring: '#f97316', gap: '#fed7aa', micro: 'Room to improve', target: 8 }
  return { ring: '#ef4444', gap: '#fecaca', micro: 'Needs focus', target: 7 }
}

function ScoreRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const strokeW = size >= 90 ? 7 : 6
  const r = (size - strokeW * 2) / 2
  const circ = 2 * Math.PI * r
  const theme = getScoreTheme(score)

  const scoreOffset = circ * (1 - score / 10)
  const targetOffset = circ * (1 - theme.target / 10)

  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`font-semibold ${size >= 90 ? 'text-sm' : 'text-xs'}`}>{label}</span>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={strokeW}
            stroke={theme.gap}
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={strokeW}
            stroke={theme.ring} opacity={0.2}
            strokeDasharray={circ} strokeDashoffset={targetOffset}
            strokeLinecap="round"
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" strokeWidth={strokeW}
            stroke={theme.ring}
            strokeDasharray={circ} strokeDashoffset={scoreOffset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold leading-none ${size >= 90 ? 'text-2xl' : 'text-xl'}`}>
            {score.toFixed(1)}
          </span>
        </div>
      </div>
      <span className="text-[11px] text-muted-foreground" style={{ color: theme.ring }}>
        {theme.micro}
      </span>
    </div>
  )
}

type MetricRating = 'good' | 'average' | 'bad' | null

const RATING_STYLES: Record<NonNullable<MetricRating>, { bg: string; text: string; label: string }> = {
  good:    { bg: 'bg-green-50 border-green-200', text: 'text-green-700', label: 'Good' },
  average: { bg: 'bg-amber-50 border-amber-200', text: 'text-amber-700', label: 'Average' },
  bad:     { bg: 'bg-red-50 border-red-200',     text: 'text-red-700',   label: 'Needs Work' },
}

function rateMetric(key: string, raw: number): MetricRating {
  switch (key) {
    case 'wpm':
      if (raw >= 120 && raw <= 180) return 'good'
      if (raw >= 80 && raw <= 220) return 'average'
      return 'bad'
    case 'fillerRate':
      if (raw < 2) return 'good'
      if (raw <= 5) return 'average'
      return 'bad'
    case 'avgSentenceLength':
      if (raw >= 12 && raw <= 20) return 'good'
      if (raw >= 8 && raw <= 25) return 'average'
      return 'bad'
    case 'vocabularyDiversity':
      if (raw > 30) return 'good'
      if (raw >= 20) return 'average'
      return 'bad'
    case 'speakingPercentage':
      if (raw >= 25 && raw <= 60) return 'good'
      if (raw >= 15 && raw <= 75) return 'average'
      return 'bad'
    case 'fillerWordCount':
      if (raw < 10) return 'good'
      if (raw <= 30) return 'average'
      return 'bad'
    case 'interruptionCount':
      if (raw === 0) return 'good'
      if (raw <= 3) return 'average'
      return 'bad'
    case 'longestMonologueSec':
      if (raw <= 60) return 'good'
      if (raw <= 120) return 'average'
      return 'bad'
    case 'questionsAsked':
      if (raw >= 3) return 'good'
      if (raw >= 1) return 'average'
      return 'bad'
    case 'repetitionRequests':
      if (raw === 0) return 'good'
      if (raw <= 1) return 'average'
      return 'bad'
    case 'avgResponseTimeSec':
      if (raw <= 2) return 'good'
      if (raw <= 5) return 'average'
      return 'bad'
    case 'hedgingRate':
      if (raw < 1.5) return 'good'
      if (raw <= 3) return 'average'
      return 'bad'
    default:
      return null
  }
}

const METRIC_TIPS: Record<string, Record<NonNullable<MetricRating>, string>> = {
  wpm: {
    good: 'Your pace is comfortable and easy to follow.',
    average: 'Pace is slightly off — aim for 120-180 WPM for natural delivery.',
    bad: 'Your pace may make it hard for listeners. Practice speaking at a steady 140 WPM.',
  },
  fillerRate: {
    good: 'Minimal filler usage — your speech sounds polished.',
    average: 'Some filler words detected. Try pausing silently instead of "um" or "uh".',
    bad: 'Frequent fillers weaken your message. Practice replacing them with 1-second pauses.',
  },
  hedgingRate: {
    good: 'You sound confident and decisive.',
    average: 'Some hedging detected. Replace "I think" with direct statements when you\'re sure.',
    bad: 'Frequent hedging ("maybe", "I guess") reduces perceived confidence. State conclusions directly.',
  },
  avgSentenceLength: {
    good: 'Sentence length is clear and digestible.',
    average: 'Sentences could be more concise. Aim for 12-20 words per sentence.',
    bad: 'Sentences are too long or too short. Target 15 words for clarity.',
  },
  vocabularyDiversity: {
    good: 'Rich vocabulary — varied and engaging word choices.',
    average: 'Some word repetition. Try varying your phrasing to keep listeners engaged.',
    bad: 'Limited vocabulary range. Prepare varied phrases for key points beforehand.',
  },
  fillerWordCount: {
    good: 'Very few fillers — your speech sounds clean and confident.',
    average: 'Noticeable filler usage. Practice pausing silently instead of saying "um" or "you know".',
    bad: 'High filler count weakens your message. Try recording yourself and catching fillers in practice.',
  },
  speakingPercentage: {
    good: 'Balanced contribution — you\'re sharing space well.',
    average: 'Your share of the conversation is slightly unbalanced.',
    bad: 'You may be dominating or too passive. Aim for balanced participation.',
  },
  interruptionCount: {
    good: 'You listen well before responding.',
    average: 'A few interruptions. Try pausing 1 second after others finish before speaking.',
    bad: 'Frequent interruptions reduce collaboration. Let others finish their points completely.',
  },
  longestMonologueSec: {
    good: 'You keep your contributions concise.',
    average: 'Some long stretches. Consider breaking points into shorter chunks.',
    bad: 'Extended monologues may lose listeners. Pause and check for engagement every 30-45 seconds.',
  },
  questionsAsked: {
    good: 'Great engagement — you ask questions that drive the conversation.',
    average: 'Asking more questions can boost collaboration and show active listening.',
    bad: 'No questions asked. Try engaging others with "What do you think?" or clarifying questions.',
  },
  repetitionRequests: {
    good: 'Others understood you clearly.',
    average: 'Someone asked you to repeat. Slow down and enunciate on key points.',
    bad: 'Multiple repetition requests suggest clarity issues. Speak slower and structure key points.',
  },
  avgResponseTimeSec: {
    good: 'Quick and attentive responses.',
    average: 'Slight delay in responses. Stay engaged to respond within 1-2 seconds.',
    bad: 'Slow responses may signal disengagement. Focus on active listening to respond promptly.',
  },
}

function getMetricTip(key: string, rating: MetricRating): string | null {
  if (!rating) return null
  return METRIC_TIPS[key]?.[rating] ?? null
}

type ConfidenceLevel = 'high' | 'medium' | 'low'

const CONFIDENCE_STYLES: Record<ConfidenceLevel, { icon: string; label: string; className: string }> = {
  high: { icon: '●', label: 'High confidence', className: 'text-green-500' },
  medium: { icon: '◐', label: 'Estimated from text', className: 'text-amber-500' },
  low: { icon: '○', label: 'Low confidence — audio needed', className: 'text-muted-foreground/50' },
}

const METRIC_CONFIDENCE: Record<string, ConfidenceLevel> = {
  wpm: 'high',
  fillerRate: 'high',
  hedgingRate: 'high',
  fillerWordCount: 'high',
  avgSentenceLength: 'high',
  vocabularyDiversity: 'high',
  speakingPercentage: 'high',
  questionsAsked: 'high',
  interruptionCount: 'low',
  repetitionRequests: 'medium',
  avgResponseTimeSec: 'medium',
  longestMonologueSec: 'medium',
}

function MetricCard({
  metricKey,
  label,
  value,
  unit,
  optimal,
  rating,
}: {
  metricKey?: string
  label: string
  value: string | number
  unit?: string
  optimal?: string
  rating?: MetricRating
}) {
  const style = rating ? RATING_STYLES[rating] : null
  const tip = metricKey ? getMetricTip(metricKey, rating ?? null) : null
  const confidence = metricKey ? METRIC_CONFIDENCE[metricKey] : undefined
  const confStyle = confidence ? CONFIDENCE_STYLES[confidence] : null
  return (
    <div className={`rounded-lg border p-3 ${style?.bg || ''}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{label}</p>
        {style && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${style.text} ${style.bg}`}>
            {style.label}
          </span>
        )}
      </div>
      <p className="mt-1 text-lg font-semibold">
        {value}
        {unit && <span className="text-sm font-normal text-muted-foreground"> {unit}</span>}
      </p>
      {optimal && <p className="mt-0.5 text-[11px] text-muted-foreground">Optimal: {optimal}</p>}
      {value === 'N/A' && metricKey === 'interruptionCount' && (
        <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/80 italic">Requires audio upload for reliable detection. Text transcripts have imprecise timestamps.</p>
      )}
      {tip && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/80 italic">{tip}</p>}
      {confStyle && (
        <p className={`mt-1 text-[10px] ${confStyle.className}`} title={confStyle.label}>
          <span className="mr-0.5">{confStyle.icon}</span> {confStyle.label}
        </p>
      )}
    </div>
  )
}

function RatingBadge({ rating }: { rating?: string }) {
  if (!rating) return null
  const map: Record<string, string> = {
    excellent: 'bg-green-100 text-green-700',
    good: 'bg-blue-100 text-blue-700',
    needs_work: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${map[rating] || 'bg-gray-100 text-gray-700'}`}>
      {rating.replace('_', ' ')}
    </span>
  )
}

type ReanalyzeStatus = 'idle' | 'transcribing' | 'analyzing' | 'completed' | 'failed'

function useReanalyze(sessionId: string | undefined, onComplete: () => void) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reanalyzing, setReanalyzing] = useState<ReanalyzeStatus>('idle')
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  useEffect(() => () => stopPolling(), [stopPolling])

  const startReanalyze = useCallback(
    async (participantName: string | null) => {
      if (!sessionId) return
      setReanalyzeError(null)
      setReanalyzing('transcribing')
      setDialogOpen(false)

      try {
        await fetch(`${API_BASE_URL}/api/replay/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ participantName: participantName || '' }),
        })

        const processRes = await fetch(
          `${API_BASE_URL}/api/replay/sessions/${sessionId}/process`,
          { method: 'POST', headers: getAuthHeaders() }
        )
        if (!processRes.ok) {
          const body = await processRes.json()
          throw new Error(body.error || 'Failed to start re-analysis')
        }

        pollRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(
              `${API_BASE_URL}/api/replay/sessions/${sessionId}/status`,
              { headers: getAuthHeaders() }
            )
            if (!statusRes.ok) return
            const statusData = await statusRes.json()

            if (statusData.status === 'completed') {
              stopPolling()
              setReanalyzing('completed')
              onComplete()
            } else if (statusData.status === 'failed') {
              stopPolling()
              setReanalyzing('failed')
              setReanalyzeError(statusData.errorMessage || 'Re-analysis failed')
            } else {
              setReanalyzing(statusData.status)
            }
          } catch {
            // transient polling failure
          }
        }, 3000)
      } catch (e: any) {
        setReanalyzing('failed')
        setReanalyzeError(e.message)
      }
    },
    [sessionId, stopPolling, onComplete]
  )

  return { dialogOpen, setDialogOpen, reanalyzing, reanalyzeError, startReanalyze }
}

function ReanalyzeDialog({
  open,
  onOpenChange,
  currentParticipant,
  detectedSpeakers,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentParticipant: string
  detectedSpeakers: string[]
  onConfirm: (name: string | null) => void
}) {
  const [name, setName] = useState(currentParticipant)

  useEffect(() => {
    if (open) setName(currentParticipant)
  }, [open, currentParticipant])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Re-analyze Transcript</DialogTitle>
          <DialogDescription>
            Re-run the AI analysis on the same transcript. You can change the participant or keep the current one.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="participant-name">Participant Name</Label>
            <Input
              id="participant-name"
              placeholder="Enter participant name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {detectedSpeakers.length > 0 && (
            <div className="grid gap-2">
              <Label className="text-muted-foreground">Detected speakers in transcript</Label>
              <div className="flex flex-wrap gap-2">
                {detectedSpeakers.map((speaker) => (
                  <button
                    key={speaker}
                    type="button"
                    onClick={() => setName(speaker)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:border-primary hover:bg-primary/5 ${
                      name === speaker ? 'border-primary bg-primary/10 font-medium' : ''
                    }`}
                  >
                    <User className="h-3.5 w-3.5 text-muted-foreground" />
                    {speaker}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(name.trim() || null)}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Re-analyze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const REANALYZE_STEPS = [
  { key: 'transcribing', label: 'Processing transcript', pct: 33 },
  { key: 'analyzing', label: 'Analyzing content with AI', pct: 66 },
  { key: 'completed', label: 'Analysis complete', pct: 100 },
]

function ReanalyzeOverlay({ status, error }: { status: ReanalyzeStatus; error: string | null }) {
  const step = REANALYZE_STEPS.find((s) => s.key === status)
  const pct = status === 'failed' ? 0 : (step?.pct ?? 10)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === 'failed' ? (
              <AlertCircle className="h-5 w-5 text-destructive" />
            ) : (
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            )}
            {status === 'failed' ? 'Re-analysis Failed' : 'Re-analyzing...'}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {status !== 'failed' && <Progress value={pct} className="h-2" />}
          <div className="grid gap-2">
            {REANALYZE_STEPS.map((s) => {
              const isDone = pct > s.pct || (pct === s.pct && status === 'completed')
              const isActive = s.key === status
              return (
                <div
                  key={s.key}
                  className={`flex items-center gap-2 text-sm ${
                    isDone ? 'text-green-600' : isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  {isDone ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <div className="h-4 w-4 rounded-full border" />
                  )}
                  {s.label}
                </div>
              )
            })}
          </div>
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export function ReplayResults() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const cameFromHistory = searchParams.get('from') === 'history'
  const backTo = cameFromHistory ? '/history?tab=replay' : '/replay'
  const backLabel = cameFromHistory ? 'Back to My Sessions' : 'Back to Replay'
  const [data, setData] = useState<ReplayResultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadResults = useCallback(() => {
    if (!id) return
    setLoading(true)
    fetch(`${API_BASE_URL}/api/replay/sessions/${id}/results`, {
      headers: getAuthHeaders(),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || 'Failed to load')
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => { loadResults() }, [loadResults])

  const { dialogOpen, setDialogOpen, reanalyzing, reanalyzeError, startReanalyze } =
    useReanalyze(id, loadResults)

  const [pulseStatus, setPulseStatus] = useState<string | null>(null)
  const [pulseLoading, setPulseLoading] = useState(false)
  const [pulseMeetingDate, setPulseMeetingDate] = useState('')

  useEffect(() => {
    if (data?.session?.progressPulseStatus) {
      setPulseStatus(data.session.progressPulseStatus)
    }
  }, [data])

  useEffect(() => {
    const md = data?.session?.meetingDate
    if (!md) {
      setPulseMeetingDate('')
      return
    }
    const s = typeof md === 'string' ? md : String(md)
    setPulseMeetingDate(s.includes('T') ? s.slice(0, 10) : s)
  }, [data?.session?.meetingDate])

  const handleTrackPulse = async () => {
    if (!data || !id) return
    const { session, result } = data
    setPulseLoading(true)
    try {
      let recordedAt = recordedAtFromSessionMeetingDate(session.meetingDate)
      if (!recordedAt && pulseMeetingDate.trim()) {
        const patchRes = await fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ meetingDate: pulseMeetingDate.trim() }),
        })
        if (!patchRes.ok) {
          const err = await patchRes.json().catch(() => ({}))
          throw new Error(err.error || 'Failed to save meeting date')
        }
        recordedAt = recordedAtFromDateInput(pulseMeetingDate.trim())
        setData((prev) =>
          prev
            ? {
                ...prev,
                session: { ...prev.session, meetingDate: pulseMeetingDate.trim() },
              }
            : prev
        )
      }
      if (!recordedAt) {
        toast.error(
          'Add the date this meeting happened. My Progress Pulse uses it to order improving / declining trends — not the day you uploaded.'
        )
        return
      }

      const entries: { skill: string; score: number }[] = []

      if (result.clarityScore > 0) entries.push({ skill: 'clarity', score: result.clarityScore })
      if (result.confidenceScore > 0) entries.push({ skill: 'confidence', score: result.confidenceScore })
      if (result.engagementScore > 0) entries.push({ skill: 'engagement', score: result.engagementScore })
      if (result.fillerWordRate != null) {
        entries.push({ skill: 'filler_words', score: Math.max(0, Math.min(10, 10 - result.fillerWordRate * 2)) })
      }
      if (result.wordsPerMinute) {
        const wpm = result.wordsPerMinute
        entries.push({ skill: 'pacing', score: wpm >= 120 && wpm <= 180 ? 9 : wpm >= 100 && wpm <= 200 ? 7 : 5 })
      }

      await fetch(`${API_BASE_URL}/api/progress-pulse`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ entries, sessionId: id, source: 'replay', recordedAt }),
      })
      setPulseStatus('tracked')
      toast.success('Session tracked in My Progress Pulse')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to track session')
    } finally {
      setPulseLoading(false)
    }
  }

  const handleSkipPulse = async () => {
    if (!id) return
    setPulseLoading(true)
    try {
      await fetch(`${API_BASE_URL}/api/progress-pulse/skip`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sessionId: id, source: 'replay' }),
      })
      setPulseStatus('skipped')
      toast.info('Session skipped from progress tracking')
    } catch {
      toast.error('Failed to update')
    } finally {
      setPulseLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading results...
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="py-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <p className="font-medium">{error || 'Results not found'}</p>
          <Link to={backTo}>
            <Button variant="outline" className="mt-4">
              {backLabel}
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  const { session, result } = data

  const detectedSpeakers: string[] = Array.isArray(result.structuredTranscript)
    ? [...new Set((result.structuredTranscript as any[]).map((s: any) => s.speaker as string))]
    : []

  const handleDownload = () => {
    const report = {
      session,
      metrics: {
        wordsPerMinute: result.wordsPerMinute,
        fillerWordRate: result.fillerWordRate,
        vocabularyDiversity: result.vocabularyDiversity,
        avgSentenceLength: result.avgSentenceLength,
        totalTurns: result.totalTurns,
        speakingPercentage: result.speakingPercentage,
        hedgingCount: result.hedgingCount,
        hedgingRate: result.hedgingRate,
        interruptionCount: result.interruptionCount,
        longestMonologueSec: result.longestMonologueSec,
        questionsAsked: result.questionsAsked,
        repetitionRequests: result.repetitionRequests,
        avgResponseTimeSec: result.avgResponseTimeSec,
      },
      scores: {
        overall: result.overallScore,
        clarity: result.clarityScore,
        confidence: result.confidenceScore,
        engagement: result.engagementScore,
      },
      strengths: result.strengths,
      improvements: result.improvements,
      recommendations: result.recommendations,
      transcript: result.transcriptText,
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `replay-${id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      {reanalyzing !== 'idle' && reanalyzing !== 'completed' && (
        <ReanalyzeOverlay status={reanalyzing} error={reanalyzeError} />
      )}

      <ReanalyzeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentParticipant={session.participantName || ''}
        detectedSpeakers={detectedSpeakers}
        onConfirm={startReanalyze}
      />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link to={backTo} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
          </Link>
          <h1 className="text-2xl font-bold">Replay Results</h1>
          {session.participantName && (
            <p className="mt-0.5 text-sm font-medium text-primary">
              Analysis for: {session.participantName}
            </p>
          )}
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{session.meetingType}</Badge>
            <span>{session.userRole}</span>
            {session.meetingDate && (
              <>
                <span>&middot;</span>
                <span>{new Date(session.meetingDate).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Re-analyze
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" /> Export JSON
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid gap-6">
            {/* Scores */}
            <Card>
              <CardContent className="flex flex-wrap items-center justify-around gap-6 pt-6">
                <ScoreRing score={result.overallScore} label="Overall" size={96} />
                <ScoreRing score={result.clarityScore} label="Clarity" />
                <ScoreRing score={result.confidenceScore} label="Confidence" />
                <ScoreRing score={result.engagementScore} label="Engagement" />
              </CardContent>
            </Card>

            {/* Progress Pulse Prompt */}
            {!pulseStatus && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="flex flex-col gap-4 py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="font-medium">Track this session in My Progress Pulse?</p>
                      <p className="text-sm text-muted-foreground">
                        Trends (improving / declining) are ordered by the <strong>meeting date</strong>, not when you
                        upload or click track — so backfilled recordings still show a correct timeline.
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button variant="outline" size="sm" onClick={handleSkipPulse} disabled={pulseLoading}>
                        Skip — won't be added later
                      </Button>
                      <Button size="sm" onClick={handleTrackPulse} disabled={pulseLoading}>
                        {pulseLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        Yes, track this
                      </Button>
                    </div>
                  </div>
                  {!session.meetingDate && (
                    <div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-3 text-sm dark:bg-amber-950/20">
                      <Label htmlFor="pulseMeetingDate" className="text-foreground">
                        Meeting date (required for this older session)
                      </Label>
                      <input
                        id="pulseMeetingDate"
                        type="date"
                        value={pulseMeetingDate}
                        onChange={(e) => setPulseMeetingDate(e.target.value)}
                        className="mt-2 flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <p className="mt-2 text-xs text-muted-foreground">
                        New Replay sessions ask for this up front. Set it here once, then track — we save it on your
                        session.
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            {pulseStatus === 'tracked' && (
              <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-700">
                <CheckCircle2 className="h-4 w-4" /> This session is tracked in My Progress Pulse.
              </div>
            )}
            {pulseStatus === 'skipped' && (
              <div className="flex items-center gap-2 rounded-md border border-muted px-4 py-2.5 text-sm text-muted-foreground">
                <AlertCircle className="h-4 w-4" /> This session was not included in progress tracking.
              </div>
            )}

            {/* Strengths & Improvements */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="h-4 w-4 text-green-500" /> Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {(result.strengths as any[])?.map((s: any, i: number) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium">{s.point}</p>
                      {s.example && (
                        <p className="mt-0.5 text-xs text-muted-foreground italic">"{s.example}"</p>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Target className="h-4 w-4 text-yellow-500" /> Areas for Improvement
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3">
                  {(result.improvements as any[])?.map((imp: any, i: number) => {
                    const focus = inferFocusArea(imp.point + ' ' + (imp.suggestion || ''))
                    const ctx = encodeURIComponent(imp.point)
                    return (
                      <div key={i} className="rounded-md border border-dashed p-3 text-sm">
                        <p className="font-medium">{imp.point}</p>
                        {imp.suggestion && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{imp.suggestion}</p>
                        )}
                        <Link
                          to={`/elevate?focus=${focus}&context=${ctx}&newSession=true`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Mic className="h-3 w-3" /> Practice this in Elevate <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>
            </div>

            {/* Recommendations */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Lightbulb className="h-4 w-4 text-blue-500" /> Recommendations
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="grid gap-2 text-sm">
                  {(result.recommendations as string[])?.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-semibold text-muted-foreground">{i + 1}.</span>
                      {r}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* Elevate CTA */}
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex flex-col items-center gap-3 py-6 sm:flex-row sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Mic className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold">Ready to improve?</p>
                    <p className="text-sm text-muted-foreground">
                      Practice with an AI coach in Elevate and work on your areas for improvement.
                    </p>
                  </div>
                </div>
                <Link to={`/elevate?focus=clarity&context=${encodeURIComponent('Practice areas from Replay analysis')}&newSession=true`}>
                  <Button size="lg">
                    <Mic className="mr-2 h-4 w-4" /> Start Elevate Session
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Metrics */}
        <TabsContent value="metrics">
          <div className="grid gap-6">
            {/* AI Scores */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">AI Assessment Scores</CardTitle>
                <CardDescription>LLM-evaluated communication quality</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-around gap-6">
                <ScoreRing score={result.clarityScore} label="Clarity" />
                <ScoreRing score={result.confidenceScore} label="Confidence" />
                <ScoreRing score={result.engagementScore} label="Engagement" />
              </CardContent>
            </Card>

            {/* Delivery Quality */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  <CardTitle className="text-base">Delivery Quality</CardTitle>
                </div>
                <CardDescription>How you speak — pace, clarity, vocabulary, and confidence signals</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <MetricCard metricKey="wpm" label="Words Per Minute" value={result.wordsPerMinute} unit="WPM" optimal="120-180" rating={rateMetric('wpm', result.wordsPerMinute)} />
                  <MetricCard metricKey="fillerRate" label="Filler Rate" value={`${result.fillerWordRate.toFixed(1)}%`} optimal="< 2%" rating={rateMetric('fillerRate', result.fillerWordRate)} />
                  <MetricCard metricKey="hedgingRate" label="Hedging Language" value={`${(result.hedgingRate ?? 0).toFixed(1)}%`} optimal="< 1.5%" rating={rateMetric('hedgingRate', result.hedgingRate ?? 0)} />
                  <MetricCard metricKey="avgSentenceLength" label="Avg Sentence Length" value={result.avgSentenceLength.toFixed(1)} unit="words" optimal="12-20" rating={rateMetric('avgSentenceLength', result.avgSentenceLength)} />
                  <MetricCard metricKey="vocabularyDiversity" label="Vocabulary Diversity" value={`${result.vocabularyDiversity.toFixed(1)}%`} optimal="> 30%" rating={rateMetric('vocabularyDiversity', result.vocabularyDiversity)} />
                  <MetricCard metricKey="fillerWordCount" label="Filler Words" value={result.fillerWordCount} optimal="< 10" rating={rateMetric('fillerWordCount', result.fillerWordCount)} />
                </div>
              </CardContent>
            </Card>

            {/* Collaboration & Interaction */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <CardTitle className="text-base">Collaboration & Interaction</CardTitle>
                </div>
                <CardDescription>How you behave in conversation — listening, turn-taking, and engagement</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  <MetricCard metricKey="speakingPercentage" label="Speaking Share" value={`${result.speakingPercentage.toFixed(1)}%`} optimal="25-60%" rating={rateMetric('speakingPercentage', result.speakingPercentage)} />
                  <MetricCard
                    metricKey="interruptionCount"
                    label="Interruptions"
                    value={result.transcriptionSource === 'aws_transcribe' ? (result.interruptionCount ?? 0) : 'N/A'}
                    optimal={result.transcriptionSource === 'aws_transcribe' ? '0' : undefined}
                    rating={result.transcriptionSource === 'aws_transcribe' ? rateMetric('interruptionCount', result.interruptionCount ?? 0) : null}
                  />
                  <MetricCard metricKey="questionsAsked" label="Questions Asked" value={result.questionsAsked ?? 0} optimal="3+" rating={rateMetric('questionsAsked', result.questionsAsked ?? 0)} />
                  <MetricCard metricKey="avgResponseTimeSec" label="Avg Response Time" value={result.avgResponseTimeSec != null ? `${result.avgResponseTimeSec.toFixed(1)}s` : '—'} optimal="< 2s" rating={result.avgResponseTimeSec != null ? rateMetric('avgResponseTimeSec', result.avgResponseTimeSec) : null} />
                  <MetricCard metricKey="longestMonologueSec" label="Longest Monologue" value={result.longestMonologueSec ? `${Math.floor(result.longestMonologueSec / 60)}m ${result.longestMonologueSec % 60}s` : '—'} optimal="< 1 min" rating={rateMetric('longestMonologueSec', result.longestMonologueSec ?? 0)} />
                  <MetricCard metricKey="repetitionRequests" label="Repetition Requests" value={result.repetitionRequests ?? 0} optimal="0" rating={rateMetric('repetitionRequests', result.repetitionRequests ?? 0)} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* AI Insights */}
        <TabsContent value="insights">
          <div className="grid gap-4">
            {/* Context-specific feedback */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Context-Specific Feedback</CardTitle>
                <CardDescription>{session.meetingType} evaluation criteria</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                {(result.contextSpecificFeedback as any[])?.map((f: any, i: number) => {
                  const focus = inferFocusArea(f.label + ' ' + (f.detail || ''))
                  const ctx = encodeURIComponent(f.label)
                  return (
                    <div key={i} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">{f.label}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">{f.detail}</p>
                        </div>
                        <RatingBadge rating={f.rating} />
                      </div>
                      {f.rating === 'needs_work' && (
                        <Link
                          to={`/elevate?focus=${focus}&context=${ctx}&newSession=true`}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Mic className="h-3 w-3" /> Practice this in Elevate <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            {/* Key Moments */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Key Moments</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {(result.keyMoments as any[])?.map((m: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    {m.type === 'strength' ? (
                      <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    ) : m.type === 'weakness' ? (
                      <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    ) : (
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    )}
                    <span>{m.text}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Elevate CTA */}
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Mic className="h-4 w-4 text-primary" />
                <span>Work on these insights with a live AI coaching session</span>
              </div>
              <Link to={`/elevate?focus=clarity&context=${encodeURIComponent('Work on insights from Replay')}&newSession=true`}>
                <Button size="sm" variant="default">
                  Open Elevate <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </div>
        </TabsContent>

        {/* Transcript */}
        <TabsContent value="transcript">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Annotated Transcript</CardTitle>
              <CardDescription>
                AI-highlighted segments from the conversation
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(result.annotatedTranscript as any[])?.length > 0 ? (
                <div className="grid gap-3">
                  <p className="text-xs text-muted-foreground italic">
                    Showing the most notable segments from {session.participantName || 'the participant'}. The full conversation is analyzed for scores and insights above.
                  </p>
                  {(result.annotatedTranscript as any[]).map((seg: any, i: number) => (
                      <div key={i} className="rounded-md border p-3">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">
                            {seg.speaker}
                          </span>
                          {seg.annotations?.map((a: string) => {
                            const colorMap: Record<string, string> = {
                              strong_statement: 'bg-green-100 text-green-700',
                              filler_word: 'bg-yellow-100 text-yellow-700',
                              hedging: 'bg-orange-100 text-orange-700',
                              key_point: 'bg-blue-100 text-blue-700',
                              action_item: 'bg-purple-100 text-purple-700',
                              decision: 'bg-emerald-100 text-emerald-700',
                              clarification: 'bg-sky-100 text-sky-700',
                              recommendation: 'bg-indigo-100 text-indigo-700',
                              update: 'bg-slate-100 text-slate-700',
                            }
                            return (
                              <span
                                key={a}
                                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorMap[a] || 'bg-gray-100 text-gray-700'}`}
                              >
                                {a.replace(/_/g, ' ')}
                              </span>
                            )
                          })}
                        </div>
                        <p className="text-sm">{seg.text}</p>
                      </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border p-4">
                  <p className="whitespace-pre-wrap text-sm">{result.transcriptText}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
