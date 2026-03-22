import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAuthHeaders } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Target,
  MessageSquare,
  Clock,
  Download,
  ArrowLeft,
} from 'lucide-react'
import type { ReplayResultData } from '@/hooks/useReplaySession'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

function ScoreRing({ score, label, size = 80 }: { score: number; label: string; size?: number }) {
  const pct = (score / 10) * 100
  const r = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - pct / 100)
  const color = score >= 7 ? 'text-green-500' : score >= 5 ? 'text-yellow-500' : 'text-red-500'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className={`${color} transition-all duration-700`}
          style={{ stroke: 'currentColor' }}
        />
      </svg>
      <span className="text-xl font-bold">{score.toFixed(1)}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

function MetricCard({ label, value, unit, optimal }: { label: string; value: string | number; unit?: string; optimal?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
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

export function ReplayResults() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<ReplayResultData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        Loading results...
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardContent className="py-12 text-center">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <p className="font-medium">{error || 'Results not found'}</p>
          <Link to="/replay">
            <Button variant="outline" className="mt-4">
              Back to Replay
            </Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  const { session, result } = data

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
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link to="/replay" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Replay
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
        <Button variant="outline" size="sm" onClick={handleDownload}>
          <Download className="mr-2 h-4 w-4" /> Export JSON
        </Button>
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
                  {(result.improvements as any[])?.map((imp: any, i: number) => (
                    <div key={i} className="text-sm">
                      <p className="font-medium">{imp.point}</p>
                      {imp.suggestion && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{imp.suggestion}</p>
                      )}
                    </div>
                  ))}
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
                <MetricCard label="Words Per Minute" value={result.wordsPerMinute} unit="WPM" optimal="140-160" />
                <MetricCard label="Filler Words" value={result.fillerWordCount} />
                <MetricCard label="Filler Rate" value={`${result.fillerWordRate.toFixed(1)}%`} optimal="< 2%" />
                <MetricCard label="Avg Sentence Length" value={result.avgSentenceLength.toFixed(1)} unit="words" optimal="15-20" />
                <MetricCard label="Vocabulary Diversity" value={`${result.vocabularyDiversity.toFixed(1)}%`} />
                <MetricCard label="Total Turns" value={result.totalTurns} />
                <MetricCard label="Speaking Percentage" value={`${result.speakingPercentage.toFixed(1)}%`} />
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
                {(result.contextSpecificFeedback as any[])?.map((f: any, i: number) => (
                  <div key={i} className="flex items-start justify-between gap-4 rounded-md border p-3">
                    <div>
                      <p className="text-sm font-medium">{f.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{f.detail}</p>
                    </div>
                    <RatingBadge rating={f.rating} />
                  </div>
                ))}
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
