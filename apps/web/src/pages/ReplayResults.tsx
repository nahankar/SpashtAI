import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
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
  CalendarDays,
} from 'lucide-react'
import type { ReplayResultData } from '@/hooks/useReplaySession'
import { inferFocusArea, EXERCISE_PREVIEWS, getFocusAreaLabel } from '@/lib/focus-areas'
import { generateSessionPdf, type SessionReport } from '@/lib/generate-session-pdf'
import { FileText } from 'lucide-react'

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

function RadarChart({ skills, size = 260 }: { skills: { label: string; score: number }[]; size?: number }) {
  if (skills.length < 3) return null
  const cx = size / 2
  const cy = size / 2
  const maxR = size * 0.38
  const levels = [2, 4, 6, 8, 10]
  const n = skills.length
  const angleStep = (2 * Math.PI) / n
  const offset = -Math.PI / 2

  const pointAt = (i: number, r: number) => ({
    x: cx + r * Math.cos(offset + i * angleStep),
    y: cy + r * Math.sin(offset + i * angleStep),
  })

  const dataPoints = skills.map((s, i) => pointAt(i, (s.score / 10) * maxR))
  const polygon = dataPoints.map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="overflow-visible">
        {levels.map((lv) => {
          const r = (lv / 10) * maxR
          const pts = skills.map((_, i) => pointAt(i, r))
          return (
            <polygon
              key={lv}
              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              className="text-border"
              strokeWidth={lv === 10 ? 1.5 : 0.5}
            />
          )
        })}
        {skills.map((_, i) => {
          const end = pointAt(i, maxR)
          return <line key={i} x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="currentColor" className="text-border" strokeWidth={0.5} />
        })}
        <polygon points={polygon} fill="hsl(var(--primary) / 0.15)" stroke="hsl(var(--primary))" strokeWidth={2} />
        {dataPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3.5} fill="hsl(var(--primary))" />
        ))}
        {skills.map((s, i) => {
          const labelR = maxR + 18
          const pt = pointAt(i, labelR)
          const anchor = pt.x < cx - 5 ? 'end' : pt.x > cx + 5 ? 'start' : 'middle'
          return (
            <text key={i} x={pt.x} y={pt.y} textAnchor={anchor} dominantBaseline="central" className="fill-foreground text-[11px] font-medium">
              {s.label} ({s.score.toFixed(1)})
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function PacingInsight({ wpm }: { wpm: number }) {
  const idealMin = 120
  const idealMax = 160
  const idealMid = 140
  if (wpm >= idealMin && wpm <= idealMax) return null
  const diff = Math.abs(wpm - idealMid)
  const pctDiff = Math.round((diff / idealMid) * 100)
  const direction = wpm < idealMin ? 'slower' : 'faster'
  return (
    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-medium text-amber-900">
        Speech speed: {wpm} WPM &middot; Recommended: {idealMin}\u2013{idealMax} WPM
      </p>
      <p className="mt-1 text-xs text-amber-700">
        Your speech was ~{pctDiff}% {direction} than ideal.
        {direction === 'slower'
          ? ' This can make meetings feel slow or hesitant. Try increasing your pace slightly on straightforward points.'
          : ' This can make it hard for listeners to follow. Try pausing between key points.'}
      </p>
    </div>
  )
}

function MeetingSummaryCard({ summary }: { summary: { topicsDiscussed?: string[]; keyOutcomes?: string[]; openQuestions?: string[] } }) {
  const hasTopics = summary.topicsDiscussed && summary.topicsDiscussed.length > 0
  const hasOutcomes = summary.keyOutcomes && summary.keyOutcomes.length > 0
  const hasQuestions = summary.openQuestions && summary.openQuestions.length > 0
  if (!hasTopics && !hasOutcomes && !hasQuestions) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-blue-500" /> Meeting Summary
        </CardTitle>
        <CardDescription>AI-generated overview of the conversation</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {hasTopics && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Topics Discussed</p>
              <ul className="space-y-1">
                {summary.topicsDiscussed!.map((t, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasOutcomes && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Key Outcomes</p>
              <ul className="space-y-1">
                {summary.keyOutcomes!.map((o, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-500" />
                    {o}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasQuestions && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Open Questions</p>
              <ul className="space-y-1">
                {summary.openQuestions!.map((q, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-sm">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function DecisionClarityCard({
  decisions,
  actionItems,
  decisionsList,
  actionItemsList,
  summary,
}: {
  decisions: number
  actionItems: number
  decisionsList?: string[]
  actionItemsList?: string[]
  summary?: string
}) {
  const hasIssue = decisions === 0 && actionItems === 0
  return (
    <Card className={hasIssue ? 'border-amber-200 bg-amber-50/50' : ''}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Target className="h-4 w-4 text-blue-500" /> Decision Clarity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-6 mb-3">
          <div className="text-center">
            <p className={`text-2xl font-bold ${decisions > 0 ? 'text-green-600' : 'text-amber-600'}`}>{decisions}</p>
            <p className="text-xs text-muted-foreground">Decisions</p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold ${actionItems > 0 ? 'text-green-600' : 'text-amber-600'}`}>{actionItems}</p>
            <p className="text-xs text-muted-foreground">Action Items</p>
          </div>
        </div>
        {summary && <p className="text-sm text-muted-foreground mb-3">{summary}</p>}
        {decisionsList && decisionsList.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-emerald-700 mb-1">Decisions</p>
            <ul className="space-y-1">
              {decisionsList.map((d, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                  <span>{d}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {actionItemsList && actionItemsList.length > 0 && (
          <div className="mb-2">
            <p className="text-xs font-medium text-purple-700 mb-1">Action Items</p>
            <ul className="space-y-1">
              {actionItemsList.map((a, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-purple-500" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {hasIssue && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-100/60 p-2.5 text-xs text-amber-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>No clear decisions or action items were captured. Try closing meetings with explicit next steps and owners.</span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function TopCoachingActions({ result, coachingInsights }: { result: any; coachingInsights: any }) {
  const actions: { text: string; detail: string; metric?: string }[] = []

  if (coachingInsights?.primaryImprovement) {
    actions.push({
      text: coachingInsights.primaryImprovement,
      detail: coachingInsights.actionableAdvice || '',
    })
  }

  if (result.fillerWordRate > 2 && actions.length < 3) {
    const targetCount = Math.max(0, Math.round(result.fillerWordCount * 0.3))
    actions.push({
      text: `Reduce filler words from ${result.fillerWordCount} to ~${targetCount}`,
      detail: `Currently ${result.fillerWordRate.toFixed(1)}% of your words are fillers. Try pausing silently instead of saying "um", "like", or "you know".`,
      metric: `${result.fillerWordCount} \u2192 ${targetCount}`,
    })
  }

  if (result.wordsPerMinute < 80 && actions.length < 3) {
    actions.push({
      text: `Increase speaking speed from ${result.wordsPerMinute} to 120+ WPM`,
      detail: `Your speech is ${Math.round(((120 - result.wordsPerMinute) / 120) * 100)}% slower than the ideal 120\u2013160 WPM range. This can make meetings feel hesitant.`,
      metric: `${result.wordsPerMinute} \u2192 120 WPM`,
    })
  } else if (result.wordsPerMinute > 180 && actions.length < 3) {
    actions.push({
      text: `Slow down from ${result.wordsPerMinute} to ~150 WPM`,
      detail: 'Aim for 120\u2013160 WPM. Pause after key points to let ideas land.',
      metric: `${result.wordsPerMinute} \u2192 150 WPM`,
    })
  }

  const hedging = result.hedgingRate ?? 0
  if (hedging > 2 && actions.length < 3) {
    const hedgingCount = result.hedgingCount ?? 0
    const targetHedge = Math.max(0, Math.round(hedgingCount * 0.4))
    actions.push({
      text: `Reduce hedging from ${hedgingCount} to ~${targetHedge} instances`,
      detail: `Currently ${hedging.toFixed(1)}% hedging rate. Replace "I think", "maybe", "probably" with direct statements when confident.`,
      metric: `${hedgingCount} \u2192 ${targetHedge}`,
    })
  }

  if (result.questionsAsked < 3 && actions.length < 3) {
    actions.push({
      text: `Ask more questions (${result.questionsAsked} \u2192 5+ per session)`,
      detail: `You asked only ${result.questionsAsked} question${result.questionsAsked !== 1 ? 's' : ''}. Try "What do you think?" or clarifying questions to boost engagement.`,
      metric: `${result.questionsAsked} \u2192 5+`,
    })
  }

  if (actions.length === 0) return null

  return (
    <Card className="border-2 border-blue-200 bg-blue-50/30">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-blue-500" /> What Would Improve Your Score Fastest
        </CardTitle>
        <CardDescription>Data-driven actions ranked by impact</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {actions.slice(0, 3).map((a, i) => (
          <div key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {i + 1}
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">{a.text}</p>
                {a.metric && (
                  <span className="inline-flex shrink-0 items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                    {a.metric}
                  </span>
                )}
              </div>
              {a.detail && <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function computeMeetingImpact(result: any, coachingInsights: any) {
  const dc = coachingInsights?.decisionClarity
  const decisionScore = dc
    ? Math.min(10, (dc.decisionsDetected ?? 0) * 2.5 + (dc.actionItemsDetected ?? 0) * 1.5)
    : 0
  const sp = result.speakingPercentage ?? 0
  const participationScore = sp >= 25 && sp <= 60 ? 10 : sp >= 15 && sp <= 75 ? 7 : sp >= 5 ? 4 : 2
  const qr = result.questionsAsked ?? 0
  const engagementScore = qr >= 10 ? 10 : qr >= 5 ? 8 : qr >= 2 ? 6 : qr >= 1 ? 4 : 2
  const score = Math.round(((decisionScore * 0.4) + (participationScore * 0.3) + (engagementScore * 0.3)) * 10) / 10
  const label = score >= 8 ? 'Highly Effective' : score >= 6 ? 'Effective' : score >= 4 ? 'Moderate' : 'Needs Improvement'
  return { score, label, decisionScore, participationScore, engagementScore }
}

const ANNOTATION_COLORS: Record<string, { bg: string; dot: string }> = {
  strong_statement: { bg: 'bg-green-100', dot: 'bg-green-500' },
  filler_word: { bg: 'bg-yellow-100', dot: 'bg-yellow-500' },
  hedging: { bg: 'bg-orange-100', dot: 'bg-orange-500' },
  key_point: { bg: 'bg-blue-100', dot: 'bg-blue-500' },
  action_item: { bg: 'bg-purple-100', dot: 'bg-purple-500' },
  decision: { bg: 'bg-emerald-100', dot: 'bg-emerald-500' },
  clarification: { bg: 'bg-sky-100', dot: 'bg-sky-500' },
  recommendation: { bg: 'bg-indigo-100', dot: 'bg-indigo-500' },
  suggestion: { bg: 'bg-teal-100', dot: 'bg-teal-500' },
  conversation_control: { bg: 'bg-gray-100', dot: 'bg-gray-400' },
  update: { bg: 'bg-slate-100', dot: 'bg-slate-500' },
}

function CommunicationTimeline({
  segments,
  onSelect,
  activeIndex,
}: {
  segments: any[]
  onSelect: (index: number) => void
  activeIndex: number | null
}) {
  if (!segments?.length) return null

  const typeCounts: Record<string, number> = {}
  segments.forEach((seg: any) => {
    seg.annotations?.forEach((a: string) => {
      typeCounts[a] = (typeCounts[a] || 0) + 1
    })
  })

  return (
    <div className="mb-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Communication Timeline</p>
        <p className="text-[10px] text-muted-foreground">{segments.length} segments</p>
      </div>
      <div className="flex h-8 w-full items-center gap-px rounded-md border bg-muted/30 px-1">
        {segments.map((seg: any, i: number) => {
          const primary = seg.annotations?.[0] || 'update'
          const color = ANNOTATION_COLORS[primary] || ANNOTATION_COLORS.update
          const isActive = activeIndex === i
          return (
            <button
              key={i}
              onClick={() => onSelect(i)}
              title={`${seg.speaker}: ${(seg.annotations || []).map((a: string) => a.replace(/_/g, ' ')).join(', ')}`}
              className={`flex-1 h-5 min-w-[3px] rounded-sm transition-all cursor-pointer hover:opacity-80 ${color.dot} ${isActive ? 'ring-2 ring-primary ring-offset-1 scale-y-125' : 'opacity-60'}`}
            />
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-2">
        {Object.entries(typeCounts)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => {
            const color = ANNOTATION_COLORS[type] || ANNOTATION_COLORS.update
            return (
              <span key={type} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className={`inline-block h-2 w-2 rounded-full ${color.dot}`} />
                {type.replace(/_/g, ' ')} ({count})
              </span>
            )
          })}
      </div>
    </div>
  )
}

function MeetingImpactCard({ result, coachingInsights }: { result: any; coachingInsights: any }) {
  const mi = computeMeetingImpact(result, coachingInsights)
  const { score: impact, decisionScore, participationScore, engagementScore } = mi
  const impactColor = impact >= 7 ? 'text-green-600' : impact >= 4 ? 'text-amber-600' : 'text-red-500'

  const dc = coachingInsights?.decisionClarity
  const sp = result.speakingPercentage ?? 0
  const qr = result.questionsAsked ?? 0

  const items = [
    { label: 'Decision Clarity', score: decisionScore, detail: `${dc?.decisionsDetected ?? 0} decisions, ${dc?.actionItemsDetected ?? 0} action items captured` },
    { label: 'Conversation Participation', score: participationScore, detail: `${sp.toFixed(0)}% speaking share (ideal: 25\u201360%)` },
    { label: 'Conversation Engagement', score: engagementScore, detail: `${qr} questions asked to drive discussion` },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-blue-500" /> Meeting Impact Score
        </CardTitle>
        <CardDescription>Did this meeting drive outcomes, not just good communication?</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6 mb-4">
          <div className="text-center">
            <p className={`text-3xl font-bold ${impactColor}`}>{impact.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">/10</p>
          </div>
          <div>
            <p className={`text-sm font-medium ${impactColor}`}>{mi.label}</p>
            <p className="text-xs text-muted-foreground">Decision clarity \u00b7 Conversation participation \u00b7 Conversation engagement</p>
          </div>
        </div>
        <div className="grid gap-2">
          {items.map((it) => {
            const barColor = it.score >= 7 ? 'bg-green-500' : it.score >= 4 ? 'bg-amber-500' : 'bg-red-500'
            return (
              <div key={it.label} className="flex items-center gap-3">
                <div className="w-36 text-xs font-medium text-muted-foreground">{it.label}</div>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${it.score * 10}%` }} />
                </div>
                <div className="w-8 text-right text-xs font-medium">{it.score.toFixed(1)}</div>
                <div className="w-40 text-[10px] text-muted-foreground truncate">{it.detail}</div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
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
    async (participantName: string | null, meetingDate: string | null) => {
      if (!sessionId) return
      setReanalyzeError(null)
      setReanalyzing('transcribing')
      setDialogOpen(false)

      try {
        const patchBody: Record<string, string> = { participantName: participantName || '' }
        if (meetingDate) patchBody.meetingDate = meetingDate

        await fetch(`${API_BASE_URL}/api/replay/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify(patchBody),
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
  currentMeetingDate,
  detectedSpeakers,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentParticipant: string
  currentMeetingDate: string
  detectedSpeakers: string[]
  onConfirm: (name: string | null, meetingDate: string | null) => void
}) {
  const [name, setName] = useState(currentParticipant)
  const [meetingDate, setMeetingDate] = useState(currentMeetingDate)

  useEffect(() => {
    if (open) {
      setName(currentParticipant)
      setMeetingDate(currentMeetingDate)
    }
  }, [open, currentParticipant, currentMeetingDate])

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

          {!currentMeetingDate && (
            <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50/80 p-3">
              <Label htmlFor="reanalyze-meeting-date" className="text-sm font-medium">
                Meeting Date <span className="text-amber-600">(missing)</span>
              </Label>
              <input
                id="reanalyze-meeting-date"
                type="date"
                value={meetingDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Required for Progress Pulse trend tracking. When did this meeting happen?
              </p>
            </div>
          )}

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
          <Button
            disabled={!currentMeetingDate && !meetingDate.trim()}
            onClick={() => onConfirm(name.trim() || null, meetingDate.trim() || null)}
          >
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
  const [nudgeDate, setNudgeDate] = useState('')
  const [nudgeSaving, setNudgeSaving] = useState(false)
  const [nudgeDismissed, setNudgeDismissed] = useState(false)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null)
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([])

  const saveNudgeDate = async () => {
    if (!nudgeDate || !id) return
    setNudgeSaving(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify({ meetingDate: nudgeDate }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Meeting date saved — Progress Pulse can now track this session.')
      setNudgeDismissed(true)
      loadResults()
    } catch {
      toast.error('Failed to save meeting date')
    } finally {
      setNudgeSaving(false)
    }
  }

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

      // Use new skill-based scores when available; fall back to legacy Bedrock scores
      const skillScores = data.skillScores?.scores
      if (skillScores) {
        if (skillScores.clarity != null) entries.push({ skill: 'clarity', score: skillScores.clarity })
        if (skillScores.conciseness != null) entries.push({ skill: 'conciseness', score: skillScores.conciseness })
        if (skillScores.confidence != null) entries.push({ skill: 'confidence', score: skillScores.confidence })
        if (skillScores.structure != null) entries.push({ skill: 'structure', score: skillScores.structure })
        if (skillScores.engagement != null) entries.push({ skill: 'engagement', score: skillScores.engagement })
        if (skillScores.pacing != null) entries.push({ skill: 'pacing', score: skillScores.pacing })
        if (skillScores.delivery != null) entries.push({ skill: 'delivery', score: skillScores.delivery })
        if (skillScores.emotionalControl != null) entries.push({ skill: 'emotional_control', score: skillScores.emotionalControl })
      } else {
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
      skillScores: data.skillScores ?? null,
      coachingInsights: data.coachingInsights ?? null,
      metrics: {
        deliveryQuality: {
          wordsPerMinute: result.wordsPerMinute,
          fillerWordCount: result.fillerWordCount,
          fillerWordRate: result.fillerWordRate,
          hedgingCount: result.hedgingCount,
          hedgingRate: result.hedgingRate,
          avgSentenceLength: result.avgSentenceLength,
          vocabularyDiversity: result.vocabularyDiversity,
        },
        collaborationInteraction: {
          totalTurns: result.totalTurns,
          speakingPercentage: result.speakingPercentage,
          interruptionCount: result.interruptionCount,
          questionsAsked: result.questionsAsked,
          avgResponseTimeSec: result.avgResponseTimeSec,
          longestMonologueSec: result.longestMonologueSec,
          repetitionRequests: result.repetitionRequests,
        },
        speakerCount: result.speakerCount,
        transcriptionSource: result.transcriptionSource,
      },
      aiAssessmentScores: {
        overall: result.overallScore,
        clarity: result.clarityScore,
        confidence: result.confidenceScore,
        engagement: result.engagementScore,
      },
      aiInsights: {
        contextSpecificFeedback: result.contextSpecificFeedback ?? [],
        keyMoments: result.keyMoments ?? [],
      },
      strengths: result.strengths,
      improvements: result.improvements,
      recommendations: result.recommendations,
      transcript: result.transcriptText,
      structuredTranscript: result.structuredTranscript ?? null,
      annotatedTranscript: result.annotatedTranscript ?? null,
      meetingImpact: computeMeetingImpact(result, data.coachingInsights),
      processingInfo: {
        modelUsed: result.modelUsed ?? null,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        processingTimeMs: result.processingTimeMs,
      },
      exportedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const safeName = (session.sessionName || session.meetingType || 'replay').replace(/[^a-zA-Z0-9]/g, '-')
    a.download = `${safeName}-${id?.slice(0, 8)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportPdf = async () => {
    if (!data) return
    setPdfLoading(true)
    try {
      const { session: s, result: r } = data
      const pdfReport: SessionReport = {
        title: s.sessionName || s.meetingType,
        subtitle: `${s.meetingType} — ${s.userRole}`,
        source: 'replay',
        metadata: [
          ...(s.participantName ? [{ label: 'Participant', value: s.participantName }] : []),
          ...(s.meetingDate ? [{ label: 'Meeting Date', value: new Date(s.meetingDate).toLocaleDateString() }] : []),
          { label: 'Role', value: s.userRole },
          { label: 'Status', value: s.status },
        ],
        overallScore: r.overallScore,
        skillScores: data.skillScores ?? null,
        coachingInsights: data.coachingInsights ?? null,
        legacyScores: [
          { label: 'Clarity', score: r.clarityScore },
          { label: 'Confidence', score: r.confidenceScore },
          { label: 'Engagement', score: r.engagementScore },
        ],
        metrics: [
          {
            section: 'Delivery Quality',
            items: [
              { label: 'Words Per Minute', value: String(r.wordsPerMinute), unit: 'WPM' },
              { label: 'Filler Words', value: String(r.fillerWordCount) },
              { label: 'Filler Rate', value: `${r.fillerWordRate.toFixed(1)}`, unit: '%' },
              { label: 'Hedging Language', value: `${(r.hedgingRate ?? 0).toFixed(1)}`, unit: '%' },
              { label: 'Avg Sentence Length', value: String(r.avgSentenceLength), unit: 'words' },
              { label: 'Vocabulary Diversity', value: `${r.vocabularyDiversity.toFixed(1)}`, unit: '%' },
            ],
          },
          {
            section: 'Collaboration & Interaction',
            items: [
              { label: 'Speaking Share', value: `${r.speakingPercentage.toFixed(0)}`, unit: '%' },
              { label: 'Questions Asked', value: String(r.questionsAsked) },
              { label: 'Interruptions', value: String(r.interruptionCount) },
              ...(r.avgResponseTimeSec != null ? [{ label: 'Avg Response Time', value: `${r.avgResponseTimeSec.toFixed(1)}`, unit: 's' }] : []),
              ...(r.longestMonologueSec ? [{ label: 'Longest Monologue', value: `${Math.floor(r.longestMonologueSec / 60)}m ${r.longestMonologueSec % 60}s` }] : []),
              { label: 'Repetition Requests', value: String(r.repetitionRequests) },
            ],
          },
        ],
        contextSpecificFeedback: (r.contextSpecificFeedback as { label: string; detail: string; rating?: string }[]) ?? [],
        keyMoments: (r.keyMoments as { text: string; type: string }[]) ?? [],
        strengths: r.strengths,
        improvements: r.improvements,
        recommendations: r.recommendations,
        transcript: r.transcriptText,
        structuredTranscript: Array.isArray(r.structuredTranscript)
          ? (r.structuredTranscript as { speaker: string; text: string }[])
          : undefined,
        meetingImpact: computeMeetingImpact(r, data.coachingInsights),
      }
      await generateSessionPdf(pdfReport)
    } catch (e) {
      toast.error('Failed to generate PDF')
      console.error(e)
    } finally {
      setPdfLoading(false)
    }
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
        currentMeetingDate={session.meetingDate ? new Date(session.meetingDate).toISOString().slice(0, 10) : ''}
        detectedSpeakers={detectedSpeakers}
        onConfirm={startReanalyze}
      />

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <Link to={backTo} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
          </Link>
          <h1 className="text-2xl font-bold">{session.sessionName || 'Replay Results'}</h1>
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
          {pulseLoading ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
            </Button>
          ) : pulseStatus === 'tracked' ? (
            <Button
              variant="outline"
              size="sm"
              className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
              onClick={handleSkipPulse}
            >
              <CheckCircle2 className="mr-2 h-4 w-4" /> Tracked in Pulse
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleTrackPulse}
              disabled={!session.meetingDate}
              title={!session.meetingDate ? 'Set a meeting date first' : 'Track this session in Progress Pulse'}
            >
              <TrendingUp className="mr-2 h-4 w-4" /> {pulseStatus === 'skipped' ? 'Track in Pulse' : 'Track in Pulse'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Re-analyze
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={pdfLoading}>
            {pdfLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}
            Export PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="mr-2 h-4 w-4" /> Export JSON
          </Button>
        </div>
      </div>

      {/* Missing meeting date nudge */}
      {!session.meetingDate && !nudgeDismissed && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-900">Meeting date missing</p>
              <p className="text-xs text-amber-700">
                Required for Progress Pulse trend tracking and re-analysis. When did this meeting happen?
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={nudgeDate}
              onChange={(e) => setNudgeDate(e.target.value)}
              className="h-9 rounded-md border border-amber-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <Button size="sm" disabled={!nudgeDate || nudgeSaving} onClick={saveNudgeDate}>
              {nudgeSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 w-full justify-start">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="insights">AI Insights</TabsTrigger>
          <TabsTrigger value="transcript">Transcript</TabsTrigger>
          <TabsTrigger value="impact">Meeting Impact</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview">
          <div className="grid gap-6">
            {/* Next Improvement — primary improvement + practice plan */}
            {data.coachingInsights && !data.coachingInsights.error && data.coachingInsights.primaryImprovement && (
              <Card className="border-2 border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
                <CardContent className="py-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                        <Target className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Next Improvement</p>
                        <p className="mt-1 font-medium">{data.coachingInsights.primaryImprovement}</p>
                        {!data.coachingInsights.practicePlan?.length && data.coachingInsights.practiceExercise && (
                          <p className="mt-2 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">Practice: </span>
                            {data.coachingInsights.practiceExercise}
                          </p>
                        )}
                      </div>
                    </div>
                    <Link
                      to={`/elevate?focus=${
                        inferFocusArea(data.coachingInsights.primaryImprovement)
                      }&context=${encodeURIComponent(
                        data.coachingInsights.practicePlan?.[0]?.description || data.coachingInsights.practiceExercise || data.coachingInsights.primaryImprovement
                      )}&newSession=true`}
                      className="shrink-0"
                    >
                      <Button>
                        <Mic className="mr-2 h-4 w-4" /> Start Practice
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>

                  {/* Exercise Preview */}
                  {(() => {
                    const focusId = inferFocusArea(data.coachingInsights.primaryImprovement)
                    const preview = EXERCISE_PREVIEWS[focusId]
                    const skillScores = data.skillScores?.scores as Record<string, number> | undefined
                    const currentScore = skillScores?.[focusId === 'filler_words' ? 'conciseness' : focusId]
                    const projectedScore = currentScore ? Math.min(10, Math.round((currentScore + 0.8) * 10) / 10) : null
                    if (!preview) return null
                    return (
                      <div className="mt-4 border-t pt-4">
                        <div className="rounded-lg border bg-muted/30 p-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Practice Exercise</p>
                              <p className="mt-0.5 text-sm font-semibold">{preview.name}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                                {preview.duration}
                              </span>
                              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">
                                {getFocusAreaLabel(focusId)}
                              </span>
                            </div>
                          </div>
                          <ol className="mt-3 grid gap-1.5">
                            {preview.steps.map((step, i) => (
                              <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                                  {i + 1}
                                </span>
                                {step}
                              </li>
                            ))}
                          </ol>
                          {currentScore != null && projectedScore != null && (
                            <p className="mt-3 text-xs text-muted-foreground">
                              Completing this exercise could improve your{' '}
                              <span className="font-medium text-foreground">{getFocusAreaLabel(focusId)}</span> score from{' '}
                              <span className="font-semibold text-foreground">{currentScore}</span> to{' '}
                              <span className="font-semibold text-primary">\u2248{projectedScore}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Unified Communication Score */}
            <Card className="border-2 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Communication Score</CardTitle>
                <CardDescription>Click any skill to see what contributes to the score</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-5 sm:flex-row sm:gap-8">
                  {/* Overall score hero */}
                  <div className="flex shrink-0 flex-col items-center justify-center">
                    <ScoreRing score={result.overallScore} label="Overall" size={100} />
                  </div>

                  {/* Skill rows with inline accordions */}
                  <div className="flex-1 min-w-0">
                    {data.skillScores?.scores ? (
                      <Accordion type="single" collapsible className="space-y-0">
                        {[
                          { key: 'clarity', label: 'Clarity' },
                          { key: 'confidence', label: 'Confidence' },
                          { key: 'conciseness', label: 'Conciseness' },
                          { key: 'structure', label: 'Structure' },
                          { key: 'engagement', label: 'Engagement' },
                          { key: 'pacing', label: 'Pacing' },
                          { key: 'delivery', label: 'Delivery' },
                          { key: 'emotionalControl', label: 'Emotional Control' },
                        ]
                          .filter(({ key }) => {
                            const v = (data.skillScores!.scores as any)[key]
                            return v !== null && v !== undefined
                          })
                          .map(({ key, label }) => {
                            const val = (data.skillScores!.scores as any)[key] as number
                            const comp = data.skillScores!.components?.[key]
                            const barColor = val >= 8 ? 'bg-green-500' : val >= 6 ? 'bg-blue-500' : val >= 4 ? 'bg-amber-500' : 'bg-red-500'
                            const textColor = val >= 8 ? 'text-green-600' : val >= 6 ? 'text-blue-600' : val >= 4 ? 'text-amber-600' : 'text-red-500'
                            return (
                              <AccordionItem key={key} value={key} className="border-b-0">
                                <AccordionTrigger className="py-2 hover:no-underline">
                                  <div className="flex flex-1 items-center gap-3 pr-2">
                                    <span className="w-28 text-left text-sm font-medium">{label}</span>
                                    <span className={`w-8 text-right text-sm font-bold ${textColor}`}>{val.toFixed(1)}</span>
                                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${val * 10}%` }} />
                                    </div>
                                  </div>
                                </AccordionTrigger>
                                {comp && (
                                  <AccordionContent className="pb-2 pt-0 pl-2">
                                    <div className="grid gap-1.5 rounded-md bg-muted/40 p-2.5">
                                      {Object.entries(comp).map(([name, value]) => (
                                        <div key={name} className="flex items-center justify-between text-xs">
                                          <span className="text-muted-foreground capitalize">
                                            {name.replace(/([A-Z])/g, ' $1').trim()}
                                          </span>
                                          <span className={val >= 6 ? 'text-foreground' : 'text-amber-600'}>{(value as number).toFixed(1)}/10</span>
                                        </div>
                                      ))}
                                    </div>
                                  </AccordionContent>
                                )}
                              </AccordionItem>
                            )
                          })}
                      </Accordion>
                    ) : (
                      <div className="flex flex-wrap items-center justify-around gap-4">
                        <ScoreRing score={result.clarityScore} label="Clarity" />
                        <ScoreRing score={result.confidenceScore} label="Confidence" />
                        <ScoreRing score={result.engagementScore} label="Engagement" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Radar chart inline */}
                {data.skillScores?.scores && (
                  <div className="mt-5 border-t pt-4">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Communication Radar</p>
                    <div className="flex justify-center">
                      <RadarChart
                        skills={Object.entries(data.skillScores.scores)
                          .filter(([, v]) => v !== null && v !== undefined)
                          .map(([k, v]) => ({
                            label: k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1'),
                            score: v as number,
                          }))}
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Top 3 Coaching Actions */}
            <TopCoachingActions result={result} coachingInsights={data.coachingInsights} />

            {/* Strengths, Improvements & Recommendations */}
            <div className="grid gap-4 md:grid-cols-3">
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
                        <p className="mt-0.5 text-xs text-muted-foreground italic">&ldquo;{s.example}&rdquo;</p>
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
                      <div key={i} className="rounded-md border border-dashed p-2.5 text-sm">
                        <p className="font-medium">{imp.point}</p>
                        {imp.suggestion && (
                          <p className="mt-0.5 text-xs text-muted-foreground">{imp.suggestion}</p>
                        )}
                        <Link
                          to={`/elevate?focus=${focus}&context=${ctx}&newSession=true`}
                          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          <Mic className="h-3 w-3" /> Practice this in Elevate <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    )
                  })}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Lightbulb className="h-4 w-4 text-blue-500" /> Recommendations
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ol className="grid gap-2.5 text-sm">
                    {(result.recommendations as string[])?.map((r, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="shrink-0 font-semibold text-muted-foreground">{i + 1}.</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            </div>

            {/* Elevate CTA (compact, since Next Improvement card is at the top) */}
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <div className="flex items-center gap-2 text-sm">
                <Mic className="h-4 w-4 text-primary" />
                <span>Practice your areas for improvement with a live AI coaching session</span>
              </div>
              <Link to={`/elevate?focus=${
                data.coachingInsights?.primaryImprovement
                  ? inferFocusArea(data.coachingInsights.primaryImprovement)
                  : 'clarity'
              }&context=${encodeURIComponent(
                data.coachingInsights?.practiceExercise || 'Practice areas from Replay analysis'
              )}&newSession=true`}>
                <Button size="sm">
                  Open Elevate <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
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
                <PacingInsight wpm={result.wordsPerMinute} />
                {(result.hedgingRate ?? 0) > 1.5 && data.skillScores?.signals?.hedging?.phrases?.length > 0 && (
                  <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm">
                    <p className="font-medium text-orange-900">Hedging phrases detected ({result.hedgingCount} total):</p>
                    <p className="mt-1 text-xs text-orange-700 italic">
                      {data.skillScores.signals.hedging.phrases.slice(0, 8).map((p: string) => `"${p}"`).join(', ')}
                      {data.skillScores.signals.hedging.phrases.length > 8 ? ', ...' : ''}
                    </p>
                    <p className="mt-1.5 text-xs text-orange-700">Replace with direct statements when you are sure of your point.</p>
                  </div>
                )}
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
                  <CommunicationTimeline
                    segments={result.annotatedTranscript as any[]}
                    activeIndex={activeSegmentIndex}
                    onSelect={(i) => {
                      setActiveSegmentIndex(i)
                      segmentRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }}
                  />
                  <p className="text-xs text-muted-foreground italic">
                    Showing the most notable segments from {session.participantName || 'the participant'}. The full conversation is analyzed for scores and insights above.
                  </p>
                  {(result.annotatedTranscript as any[]).map((seg: any, i: number) => {
                    const colorMap: Record<string, string> = {
                      strong_statement: 'bg-green-100 text-green-700',
                      filler_word: 'bg-yellow-100 text-yellow-700',
                      hedging: 'bg-orange-100 text-orange-700',
                      key_point: 'bg-blue-100 text-blue-700',
                      action_item: 'bg-purple-100 text-purple-700',
                      decision: 'bg-emerald-100 text-emerald-700',
                      clarification: 'bg-sky-100 text-sky-700',
                      recommendation: 'bg-indigo-100 text-indigo-700',
                      suggestion: 'bg-teal-100 text-teal-700',
                      conversation_control: 'bg-gray-100 text-gray-600',
                      update: 'bg-slate-100 text-slate-700',
                    }
                    return (
                      <div
                        key={i}
                        ref={(el) => { segmentRefs.current[i] = el }}
                        className={`rounded-md border p-3 transition-all ${activeSegmentIndex === i ? 'ring-2 ring-primary border-primary/50 bg-primary/5' : ''}`}
                      >
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-[10px] text-muted-foreground font-mono">#{i + 1}</span>
                          <span className="text-xs font-semibold text-foreground">
                            {seg.speaker}
                          </span>
                          {seg.annotations?.map((a: string) => (
                            <span
                              key={a}
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${colorMap[a] || 'bg-gray-100 text-gray-700'}`}
                            >
                              {a.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                        <p className="text-sm">{seg.text}</p>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="rounded-md border p-4">
                  <p className="whitespace-pre-wrap text-sm">{result.transcriptText}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Meeting Impact */}
        <TabsContent value="impact">
          <div className="grid gap-6">
            {/* Meeting Summary */}
            {data.coachingInsights?.meetingSummary && (
              <MeetingSummaryCard summary={data.coachingInsights.meetingSummary} />
            )}

            {/* Meeting Impact Score */}
            <MeetingImpactCard result={result} coachingInsights={data.coachingInsights} />

            {/* Decision Clarity */}
            {data.coachingInsights?.decisionClarity && (
              <DecisionClarityCard
                decisions={data.coachingInsights.decisionClarity.decisionsDetected ?? 0}
                actionItems={data.coachingInsights.decisionClarity.actionItemsDetected ?? 0}
                decisionsList={data.coachingInsights.decisionClarity.decisions}
                actionItemsList={data.coachingInsights.decisionClarity.actionItems}
                summary={data.coachingInsights.decisionClarity.summary}
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
