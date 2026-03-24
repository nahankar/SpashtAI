import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
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
    default:
      return null
  }
}

function MetricCard({
  label,
  value,
  unit,
  optimal,
  rating,
}: {
  label: string
  value: string | number
  unit?: string
  optimal?: string
  rating?: MetricRating
}) {
  const style = rating ? RATING_STYLES[rating] : null
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
          <Card>
            <CardHeader>
              <CardTitle>Speaking Metrics</CardTitle>
              <CardDescription>Quantitative analysis of the conversation</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <MetricCard label="Words Per Minute" value={result.wordsPerMinute} unit="WPM" optimal="120-180" rating={rateMetric('wpm', result.wordsPerMinute)} />
                <MetricCard label="Filler Words" value={result.fillerWordCount} rating={rateMetric('fillerWordCount', result.fillerWordCount)} />
                <MetricCard label="Filler Rate" value={`${result.fillerWordRate.toFixed(1)}%`} optimal="< 2%" rating={rateMetric('fillerRate', result.fillerWordRate)} />
                <MetricCard label="Avg Sentence Length" value={result.avgSentenceLength.toFixed(1)} unit="words" optimal="12-20" rating={rateMetric('avgSentenceLength', result.avgSentenceLength)} />
                <MetricCard label="Vocabulary Diversity" value={`${result.vocabularyDiversity.toFixed(1)}%`} optimal="> 30%" rating={rateMetric('vocabularyDiversity', result.vocabularyDiversity)} />
                <MetricCard label="Total Turns" value={result.totalTurns} />
                <MetricCard label="Speaking Percentage" value={`${result.speakingPercentage.toFixed(1)}%`} optimal="25-60%" rating={rateMetric('speakingPercentage', result.speakingPercentage)} />
                <MetricCard label="Speakers Detected" value={result.speakerCount} />
                <MetricCard label="Transcription Source" value={result.transcriptionSource.replace('_', ' ')} />
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Processing Info</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <p className="text-muted-foreground">Model</p>
                <p className="font-medium">{result.modelUsed || 'N/A'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Prompt Tokens</p>
                <p className="font-medium">{result.promptTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Completion Tokens</p>
                <p className="font-medium">{result.completionTokens.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Processing Time</p>
                <p className="font-medium">{(result.processingTimeMs / 1000).toFixed(1)}s</p>
              </div>
            </CardContent>
          </Card>
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
                  {(result.annotatedTranscript as any[]).map((seg: any, i: number) => (
                    <div key={i} className="rounded-md border p-3">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {seg.speaker}
                        </span>
                        {seg.annotations?.map((a: string) => (
                          <span
                            key={a}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              a === 'strong_statement'
                                ? 'bg-green-100 text-green-700'
                                : a === 'filler_word'
                                  ? 'bg-yellow-100 text-yellow-700'
                                  : a === 'hedging'
                                    ? 'bg-orange-100 text-orange-700'
                                    : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            {a.replace('_', ' ')}
                          </span>
                        ))}
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
