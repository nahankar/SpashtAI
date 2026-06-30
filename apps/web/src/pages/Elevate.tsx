import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { findSpeechSpans, SPEECH_HIGHLIGHT_CLASS } from '@/lib/speechPatterns'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useRoomContext,
  useVoiceAssistant,
  BarVisualizer
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RoomEvent, Track } from 'livekit-client'
import { RealTimeMetrics } from '@/components/analytics/RealTimeMetrics'
import { SessionMetrics } from '@/components/analytics/SessionMetrics'
import { SessionMetricsSummary } from '@/components/analytics/SessionMetricsSummary'
import { AdvancedInsights, CONTENT_VERDICTS, DELIVERY_VERDICTS } from '@/components/analytics/AdvancedInsights'
import { SkillScoresCard } from '@/components/analytics/SkillScoresCard'
import { CoachingInsightsCard } from '@/components/analytics/CoachingInsightsCard'
import { PaceTrendCard, type PacePoint } from '@/components/analytics/PaceTrend'
import { SessionReplay } from '@/pages/SessionReplay'
import { useRealTimeMetrics, useSessionMetrics, useSessionTurns } from '@/hooks/useSessionMetrics'
import { useAudioRecording } from '@/hooks/useAudioRecording'
import { useConversationPersistence } from '@/hooks/useConversationPersistence'
import { AgentVisualizer, SessionStatusBar } from '@/components/layout/AgentVisualizer'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { FOCUS_AREAS, getFocusAreaLabel, EXERCISE_PREVIEWS } from '@/lib/focus-areas'
import { pulseSkillLabel } from '@/lib/pulse-skills'
import { useAuth } from '@/hooks/useAuth'
import { useUserExportFlags } from '@/hooks/useUserExportFlags'
import { useConfirm } from '@/hooks/useConfirm'
import { Trash2, CheckSquare, Square, Target, ArrowRight, Info, Play, ChevronDown, ChevronUp, BarChart3, CheckCircle2 } from 'lucide-react'
import { generateSessionPdf, type SessionReport } from '@/lib/generate-session-pdf'
import { CoachAudioBootstrap } from '@/components/session/CoachAudioBootstrap'
import { SessionRecorder } from '@/components/session/SessionRecorder'
import { stripThinkingBlocks } from '@/lib/stripThinking'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

// Helper function to save session data to backend
async function saveSessionData(sessionId: string, metrics: any, transcript: any) {
  try {
    const metricsResponse = await fetch(`${API_BASE_URL}/sessions/${sessionId}/metrics`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(metrics)
    })
    
    if (!metricsResponse.ok) {
      throw new Error(`Failed to save metrics: ${metricsResponse.statusText}`)
    }

    const transcriptResponse = await fetch(`${API_BASE_URL}/sessions/${sessionId}/transcript`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(transcript)
    })
    
    if (!transcriptResponse.ok) {
      throw new Error(`Failed to save transcript: ${transcriptResponse.statusText}`)
    }

    console.log('✅ Session data saved successfully')
  } catch (error) {
    console.error('❌ Failed to save session data:', error)
  }
}

export function Elevate() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, updateUser } = useAuth()
  const exportFlags = useUserExportFlags()
  const confirmDialog = useConfirm()
  const viewSessionId = searchParams.get('session')
  const cameFromHistory = searchParams.get('from') === 'history'
  const inboundFocus = searchParams.get('focus') || ''
  const inboundContext = searchParams.get('context') ? decodeURIComponent(searchParams.get('context')!) : ''
  const inboundNewSession = searchParams.get('newSession') === 'true'
  
  const [identity] = useState(() => {
    const name = user?.firstName || user?.email?.split('@')[0] || 'user'
    return `${name}-${Math.floor(Math.random() * 9999)}`
  })
  const [elevateSessionName, setElevateSessionName] = useState(
    inboundContext ? `Practice: ${inboundContext.slice(0, 60)}` : ''
  )
  const [focusArea, setFocusArea] = useState(inboundFocus || '')
  const [roomName, setRoomName] = useState('') // Empty initially, generated per session
  const [token, setToken] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [assistantState, setAssistantState] = useState<'restarting' | 'ready' | 'recovering' | 'unknown'>('unknown')
  const [isSessionPaused, setIsSessionPaused] = useState(false)
  const [isCompletedSessionView, setIsCompletedSessionView] = useState(false)
  const [viewSessionName, setViewSessionName] = useState<string | null>(null)
  const [viewSessionPulse, setViewSessionPulse] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(viewSessionId) // Initialize with URL param if present
  const [showMetrics, setShowMetrics] = useState(false)
  const [turnMetricsByIndex, setTurnMetricsByIndex] = useState<Record<number, TurnMetrics>>({})
  const [turnTextByIndex, setTurnTextByIndex] = useState<Record<number, string>>({})
  const [turnMetricsByText, setTurnMetricsByText] = useState<Record<string, TurnMetrics>>({})
  const [showHistory, setShowHistory] = useState(!viewSessionId && !inboundNewSession)

  interface ElevateSessionItem {
    id: string
    module: string
    sessionName?: string | null
    focusArea?: string | null
    startedAt: string
    endedAt?: string
    durationSec?: number
    words?: number
    fillerRate?: number
    progressPulseStatus?: string | null
  }
  const [pastSessions, setPastSessions] = useState<ElevateSessionItem[]>([])
  const [pastLoading, setPastLoading] = useState(true)
  const [elevSearch, setElevSearch] = useState('')
  const [elevSortField, setElevSortField] = useState<SortField>('date')
  const [elevSortDir, setElevSortDir] = useState<SortDir>('desc')
  const [elevStatusFilter, setElevStatusFilter] = useState('all')
  const [selectedElevate, setSelectedElevate] = useState<Set<string>>(new Set())

  interface RecommendedPractice {
    skill: string
    score: number
    label: string
  }
  const [recommendation, setRecommendation] = useState<RecommendedPractice | null>(null)

  const filteredPastSessions = useMemo(() => {
    let result = [...pastSessions]
    if (elevSearch) {
      const q = elevSearch.toLowerCase()
      result = result.filter(
        (s) =>
          (s.sessionName || '').toLowerCase().includes(q) ||
          s.module.toLowerCase().includes(q)
      )
    }
    if (elevStatusFilter !== 'all') {
      result = result.filter((s) =>
        elevStatusFilter === 'completed' ? s.endedAt != null : s.endedAt == null
      )
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (elevSortField) {
        case 'date':
          cmp = new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
          break
        case 'name':
          cmp = (a.sessionName || 'Session').localeCompare(b.sessionName || 'Session')
          break
        case 'duration':
          cmp = (a.durationSec ?? 0) - (b.durationSec ?? 0)
          break
        case 'status':
          cmp = (a.endedAt ? 'completed' : 'in_progress').localeCompare(b.endedAt ? 'completed' : 'in_progress')
          break
      }
      return elevSortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [pastSessions, elevSearch, elevSortField, elevSortDir, elevStatusFilter])

  const elevateSortOptions: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
    { value: 'duration', label: 'Duration' },
    { value: 'status', label: 'Status' },
  ]

  const elevateStatusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'completed', label: 'Completed' },
    { value: 'in_progress', label: 'In Progress' },
  ]

  const handleDeleteElevateSession = useCallback(async (id: string) => {
    const ok = await confirmDialog({
      title: 'Delete Session',
      description: 'Delete this session and all its data? This cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await fetch(`${API_BASE_URL}/sessions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      setPastSessions((prev) => prev.filter((s) => s.id !== id))
      setSelectedElevate((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Session deleted')
    } catch {
      toast.error('Failed to delete session')
    }
  }, [confirmDialog])

  const handleDeleteSelectedElevate = useCallback(async () => {
    if (selectedElevate.size === 0) return
    const ok = await confirmDialog({
      title: 'Delete Sessions',
      description: `Delete ${selectedElevate.size} session(s)? This cannot be undone.`,
      confirmLabel: 'Delete All',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await Promise.all(
        Array.from(selectedElevate).map((id) =>
          fetch(`${API_BASE_URL}/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
        )
      )
      setPastSessions((prev) => prev.filter((s) => !selectedElevate.has(s.id)))
      setSelectedElevate(new Set())
      toast.success('Sessions deleted')
    } catch {
      toast.error('Failed to delete some sessions')
    }
  }, [selectedElevate, confirmDialog])

  const loadPastSessions = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setPastLoading(true)
      const res = await fetch(`${API_BASE_URL}/sessions`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setPastSessions(data.sessions || [])
      }
    } catch { /* non-critical */ }
    finally { if (!silent) setPastLoading(false) }
  }, [])

  useEffect(() => {
    async function loadRecommendation() {
      try {
        const res = await fetch(`${API_BASE_URL}/api/progress-pulse/summary`, { headers: getAuthHeaders() })
        if (!res.ok) return
        const data = await res.json()
        const items: { skill: string; currentScore: number; totalSessions: number }[] = data.summary || []
        if (items.length === 0) return
        const weakest = items.reduce((a, b) => (a.currentScore < b.currentScore ? a : b))
        if (weakest.currentScore >= 8.5) return
        const labels: Record<string, string> = {
          clarity: 'Clarity', conciseness: 'Conciseness', confidence: 'Confidence',
          structure: 'Structure', engagement: 'Engagement', pacing: 'Pacing',
          delivery: 'Delivery', emotional_control: 'Emotional Control',
          filler_words: 'Filler Words',
        }
        setRecommendation({
          skill: weakest.skill,
          score: weakest.currentScore,
          label: labels[weakest.skill] || weakest.skill,
        })
      } catch { /* non-critical */ }
    }
    loadPastSessions()
    loadRecommendation()
  }, [loadPastSessions])

  // Auto-refresh the past-sessions list: a just-finished session (or one still
  // being analyzed server-side) should appear without a manual reload. Since
  // finishing a live session only flips component state (no remount), we also
  // refetch on tab focus/visibility and on a light interval. Background
  // refreshes are silent (no spinner) to avoid list flicker.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') loadPastSessions({ silent: true })
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 15000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      window.clearInterval(interval)
    }
  }, [loadPastSessions])
  
  // Real-time metrics for active session
  const { currentMetrics, updateMetrics, resetMetrics } = useRealTimeMetrics()
  
  // Historical metrics for completed sessions
  const { metrics: historicalMetrics, downloadTranscript } = useSessionMetrics(sessionId)

  // Per-turn records fetched once and shared by the summary strip + pace trend.
  const { turns: completedTurns } = useSessionTurns(sessionId, !!sessionId)
  const completedPacePoints = useMemo<PacePoint[]>(() => {
    let n = 0
    return completedTurns
      .filter((t) => t.role === 'user' && t.metrics?.wpm != null && t.metrics.wpm > 0)
      .map((t) => {
        n += 1
        return { label: n, wpm: Math.round(Number(t.metrics.wpm)) }
      })
  }, [completedTurns])
  
  const [elevatePdfLoading, setElevatePdfLoading] = useState(false)
  // Results view: which tab is showing, plus a one-shot request to deep-link the
  // Playback tab to the moment behind a skill score ("Hear it").
  const [resultsTab, setResultsTab] = useState('playback')
  const [playbackFocus, setPlaybackFocus] = useState<{ skill: string; nonce: number } | null>(null)
  const hearSkillMoment = (skill: string) => {
    setPlaybackFocus({ skill, nonce: Date.now() })
    setResultsTab('playback')
  }
  const handleElevateExportPdf = async () => {
    if (!sessionId || !historicalMetrics) return
    setElevatePdfLoading(true)
    try {
      const m = historicalMetrics
      const headers = getAuthHeaders()

      // Pull the full v2 analysis so the PDF matches the on-screen report
      // (skill scores, coaching, content & delivery signals, transcript).
      const [scoresRes, coachingRes, signalsRes, turnsRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/communication-signals`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers }).catch(() => null),
      ])

      const skill = scoresRes && scoresRes.ok ? await scoresRes.json() : null
      const coaching = coachingRes && coachingRes.ok ? await coachingRes.json() : null
      const signals = signalsRes && signalsRes.ok ? await signalsRes.json() : null
      const turnsData = turnsRes && turnsRes.ok ? await turnsRes.json() : null

      const scores: Record<string, number | null> = skill?.scores ?? {}
      const scoreVals = Object.values(scores).filter((v): v is number => typeof v === 'number')
      const overallScore = scoreVals.length
        ? scoreVals.reduce((s, v) => s + v, 0) / scoreVals.length
        : null

      const sr = signals?.speechRate ?? {}
      const vocab = signals?.vocabDiversity ?? {}
      const sc = signals?.sentenceComplexity ?? {}
      const prosody = signals?.prosody ?? null

      // Reuse the exact on-screen verdicts so the PDF colors/tips match Session Analytics.
      const diversityPct = (vocab.ratio ?? 0) * 100
      const avgSentenceLen = sc.avgLength ?? 0
      const syntacticComplexity = (sc.subordinateRatio ?? 0) * 10
      const sophistication = vocab.sophistication ?? 0

      const metricSections: SessionReport['metrics'] = [
        {
          section: 'Speaking Performance',
          description: 'Your headline pace, fillers and fluency for this session',
          items: [
            {
              label: 'Words Per Minute',
              value: String(m.userWpm),
              unit: 'WPM',
              tone: DELIVERY_VERDICTS.speechRate(m.userWpm).tone,
              hint: DELIVERY_VERDICTS.speechRate(m.userWpm).tip,
            },
            {
              label: 'Filler Rate',
              value: m.userFillerRate.toFixed(1),
              unit: '%',
              tone: DELIVERY_VERDICTS.fillerRate(m.userFillerRate).tone,
              hint: DELIVERY_VERDICTS.fillerRate(m.userFillerRate).tip,
            },
            { label: 'Avg Sentence Length', value: m.userAvgSentenceLength.toFixed(1), unit: 'words' },
            { label: 'Vocab Diversity', value: `${(m.userVocabDiversity * 100).toFixed(0)}`, unit: '%' },
            { label: 'Speaking Time', value: m.userSpeakingTime.toFixed(0), unit: 's' },
            { label: 'Avg Response Time', value: m.userResponseTimeAvg.toFixed(1), unit: 's' },
          ],
        },
      ]

      if (signals) {
        metricSections.push({
          section: 'Content — Vocabulary & Structure',
          description: 'What you said and how your sentences are built',
          items: [
            { label: 'Total Words', value: String(vocab.totalWords ?? sr.totalWords ?? 0) },
            { label: 'Unique Words', value: String(vocab.uniqueWords ?? 0) },
            {
              label: 'Diversity',
              value: diversityPct.toFixed(0),
              unit: '%',
              tone: CONTENT_VERDICTS.diversity(diversityPct).tone,
              hint: CONTENT_VERDICTS.diversity(diversityPct).tip,
            },
            {
              label: 'Sophistication',
              value: sophistication.toFixed(1),
              unit: '/10',
              score: sophistication,
              tone: CONTENT_VERDICTS.sophistication(sophistication).tone,
              hint: CONTENT_VERDICTS.sophistication(sophistication).tip,
            },
            {
              label: 'Avg Sentence Len',
              value: avgSentenceLen.toFixed(1),
              unit: 'words',
              tone: CONTENT_VERDICTS.avgSentenceLength(avgSentenceLen).tone,
              hint: CONTENT_VERDICTS.avgSentenceLength(avgSentenceLen).tip,
            },
            {
              label: 'Syntactic Complexity',
              value: syntacticComplexity.toFixed(1),
              unit: '/10',
              score: syntacticComplexity,
              tone: CONTENT_VERDICTS.syntacticComplexity(syntacticComplexity).tone,
              hint: CONTENT_VERDICTS.syntacticComplexity(syntacticComplexity).tip,
            },
          ],
        })
      }

      if (prosody && (prosody.voiceQuality || prosody.pitchVariation || prosody.energyStability)) {
        const vq = prosody.voiceQuality ?? 0
        const pv = prosody.pitchVariation ?? 0
        const es = prosody.energyStability ?? 0
        metricSections.push({
          section: 'Delivery — Voice Quality',
          description: 'How you sounded — acoustic analysis of your recording',
          items: [
            {
              label: 'Voice Quality',
              value: vq.toFixed(1),
              unit: '/10',
              score: vq,
              tone: DELIVERY_VERDICTS.voiceQuality(vq).tone,
              hint: DELIVERY_VERDICTS.voiceQuality(vq).tip,
            },
            {
              label: 'Pitch Variation',
              value: pv.toFixed(1),
              unit: '/10',
              score: pv,
              tone: DELIVERY_VERDICTS.pitchVariation(pv).tone,
              hint: DELIVERY_VERDICTS.pitchVariation(pv).tip,
            },
            {
              label: 'Energy Stability',
              value: es.toFixed(1),
              unit: '/10',
              score: es,
              tone: DELIVERY_VERDICTS.energyStability(es).tone,
              hint: DELIVERY_VERDICTS.energyStability(es).tip,
            },
            { label: 'Pauses', value: String(prosody.pauseCount ?? 0) },
            { label: 'Avg Pause', value: `${(prosody.meanPauseDuration ?? 0).toFixed(2)}`, unit: 's' },
          ],
        })
      }

      // Pace variation chart points — one WPM per user turn, in order.
      let paceN = 0
      const pacePoints = Array.isArray(turnsData?.turns)
        ? turnsData.turns
            .filter((t: any) => t.role === 'user' && t.metrics?.wpm != null && t.metrics.wpm > 0)
            .map((t: any) => {
              paceN += 1
              return { label: paceN, wpm: Math.round(Number(t.metrics.wpm)) }
            })
        : []

      // Progress Pulse (cross-session trends), without the "Practice in Elevate" CTA.
      let progressPulse: SessionReport['progressPulse'] = null
      try {
        const pulseRes = await fetch(`${API_BASE_URL}/api/progress-pulse/summary`, { headers })
        if (pulseRes.ok) {
          const pulseData = await pulseRes.json()
          const items = Array.isArray(pulseData?.summary) ? pulseData.summary : []
          if (items.length) {
            progressPulse = items.map((it: any) => ({
              skill: it.skill,
              label: pulseSkillLabel(it.skill),
              currentScore: Number(it.currentScore) || 0,
              delta: it.delta ?? null,
            }))
          }
        }
      } catch {
        /* pulse is optional */
      }

      const recommendations = coaching
        ? [coaching.actionableAdvice, coaching.practiceExercise, coaching.overallNarrative].filter(
            (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0,
          )
        : []

      // ── Report summary: how the conversation went + Progress Pulse standing ──
      const summaryParts: string[] = []
      if (overallScore != null) {
        summaryParts.push(`This session scored ${overallScore.toFixed(1)}/10 overall.`)
      }
      if (coaching?.overallNarrative) {
        summaryParts.push(coaching.overallNarrative)
      } else if (coaching?.topStrength) {
        summaryParts.push(coaching.topStrength)
      }
      if (progressPulse && progressPulse.length) {
        const pulseAvg =
          progressPulse.reduce((s, p) => s + (p.currentScore || 0), 0) / progressPulse.length
        const improving = progressPulse
          .filter((p) => (p.delta ?? 0) > 0.3)
          .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
          .map((p) => p.label)
        const weakest = [...progressPulse].sort((a, b) => a.currentScore - b.currentScore)[0]
        let pulseLine = `Across your tracked sessions, your communication skills average ${pulseAvg.toFixed(1)}/10.`
        if (improving.length) {
          pulseLine += ` You're improving in ${improving.slice(0, 2).join(' and ')}.`
        }
        if (weakest && weakest.currentScore < 7) {
          pulseLine += ` ${weakest.label} needs the most attention right now.`
        }
        summaryParts.push(pulseLine)
      }
      const summary = summaryParts.length ? summaryParts.join(' ') : null

      // ── Recommended next steps: targeted practice with deep links to Elevate ──
      const SKILL_TO_FOCUS: Record<string, string> = {
        clarity: 'clarity',
        conciseness: 'conciseness',
        confidence: 'confidence',
        structure: 'structure',
        engagement: 'engagement',
        pacing: 'pacing',
        delivery: 'pacing',
        emotionalControl: 'confidence',
      }
      // Prefer the weakest tracked skills; fall back to this session's skill scores.
      const weakSource: { key: string; score: number }[] = progressPulse?.length
        ? progressPulse.map((p) => ({ key: p.skill, score: p.currentScore }))
        : Object.entries(scores)
            .filter(([, v]) => typeof v === 'number')
            .map(([k, v]) => ({ key: k, score: v as number }))
      const targetFocus: string[] = []
      for (const { key } of weakSource.sort((a, b) => a.score - b.score)) {
        const fid = SKILL_TO_FOCUS[key] ?? key
        if (FOCUS_AREAS.some((f) => f.id === fid) && !targetFocus.includes(fid)) targetFocus.push(fid)
        if (targetFocus.length >= 3) break
      }
      if (targetFocus.length === 0) targetFocus.push('clarity', 'pacing')
      const origin = window.location.origin
      const nextSteps = targetFocus.map((fid) => {
        const fa = FOCUS_AREAS.find((f) => f.id === fid)
        const ex = EXERCISE_PREVIEWS[fid]
        const title = ex?.name ? `${ex.name} (${fa?.label ?? fid})` : `Practice: ${fa?.label ?? fid}`
        const description = [fa?.description, ex?.duration ? `~${ex.duration}.` : '', ex?.steps?.[0]]
          .filter(Boolean)
          .join(' — ')
        return { title, description, url: `${origin}/elevate?focusArea=${encodeURIComponent(fid)}` }
      })

      // Title must match the session's name in the SpashtAI sessions list so the
      // user can search for the PDF by that name.
      const sess = turnsData?.session ?? null
      const moduleLabel = sess?.module
        ? sess.module.charAt(0).toUpperCase() + sess.module.slice(1)
        : 'Elevate'
      const displayName = (sess?.sessionName as string)?.trim() || `${moduleLabel} Session`

      const pdfReport: SessionReport = {
        title: displayName,
        subtitle: sess?.focusArea ? getFocusAreaLabel(sess.focusArea) : 'Practice Session Analytics',
        source: 'elevate',
        metadata: [
          { label: 'Session', value: displayName },
          { label: 'Total Turns', value: String(m.totalTurns) },
          { label: 'Generated', value: new Date().toLocaleString() },
        ],
        summary,
        overallScore,
        skillScores: skill?.scores ? { scores, components: skill.components } : null,
        coachingInsights:
          coaching && !coaching.error
            ? {
                topStrength: coaching.topStrength,
                primaryImprovement: coaching.primaryImprovement,
                actionableAdvice: coaching.actionableAdvice,
                practiceExercise: coaching.practiceExercise,
                overallNarrative: coaching.overallNarrative,
              }
            : null,
        metrics: metricSections,
        paceTrend: pacePoints.length >= 2 ? { points: pacePoints, idealMin: 120, idealMax: 160 } : null,
        progressPulse,
        nextSteps: nextSteps.length ? nextSteps : null,
        strengths: coaching?.topStrength ? [{ point: coaching.topStrength }] : undefined,
        improvements: coaching?.primaryImprovement ? [{ point: coaching.primaryImprovement }] : undefined,
        recommendations: recommendations.length ? recommendations : undefined,
      }
      await generateSessionPdf(pdfReport)
    } catch (e) {
      toast.error('Failed to generate PDF')
      console.error(e)
    } finally {
      setElevatePdfLoading(false)
    }
  }

  // Persistent conversation system
  const {
    messages,
    isLoading: conversationLoading,
    error: conversationError,
    loadConversation,
    addMessage,
    upsertStreamingMessage,
    clearMessages,
    subscribeToUpdates
  } = useConversationPersistence()

  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  // Each pause→resume connects to a NEW LiveKit room while keeping the same
  // sessionId, and the agent restarts turn numbering at 1 (user_turn_1,
  // assistant_greeting, …). Without per-connection namespacing those ids collide
  // with the pre-resume segment's bubbles and silently overwrite them. We prefix
  // every live id with the current room so each connection's turns are distinct.
  const currentSegmentRef = useRef('')
  useEffect(() => {
    currentSegmentRef.current = roomName
  }, [roomName])

  const handleNewMessage = useCallback(
    (message: { id?: string; role: string; content: string; partial?: boolean }) => {
      if (isSessionPaused) {
        console.log('⏸️ Dropping message while session is paused')
        return
      }
      let finalContent = message.content?.trim() || ''
      if (message.role === 'assistant') {
        finalContent = stripThinkingBlocks(finalContent)
      }
      if (!finalContent || finalContent === '[]' || finalContent.length < 2) {
        return
      }

      // Namespace every live id with the current connection segment so a
      // paused→resumed session (new room, agent restarts at turn 1) cannot
      // overwrite the previous segment's bubbles. Partials and the final of the
      // same turn arrive within one segment, so they still share one bubble.
      const seg = currentSegmentRef.current
      const nsId = (rawId?: string) =>
        rawId ? (seg ? `${seg}::${rawId}` : rawId) : undefined

      // Stitched user turns share one bubble per turn (id = user_turn_N):
      //  • partials stream the live text (UI only, not persisted)
      //  • the agent's committed final (partial=false) is authoritative — it
      //    updates that same bubble in place and persists it. Using the same
      //    streamId for both prevents the duplicate/divergent bubbles caused by
      //    a separate finalize path racing the committed publish.
      if (message.role === 'user' && message.id?.startsWith('user_turn_')) {
        const storeId = nsId(message.id)!
        if (message.partial) {
          upsertStreamingMessage('user', finalContent, storeId)
        } else {
          // Agent's conversation_logger persists this turn server-side; keep the
          // browser write UI-only to avoid duplicate transcript entries.
          addMessage('user', finalContent, storeId, false)
        }
        return
      }

      if (message.partial) {
        const streamId = nsId(message.id) || `stream_${seg}_${message.role}`
        upsertStreamingMessage(
          message.role as 'user' | 'assistant',
          finalContent,
          streamId,
        )
        return
      }

      const storeId = nsId(message.id)
      const isDuplicate = messagesRef.current.some(
        (msg) =>
          msg.role === message.role &&
          msg.content === finalContent &&
          (storeId ? msg.id === storeId : true),
      )
      if (isDuplicate) return

      // UI-only: the agent is the single writer for the persisted transcript.
      addMessage(message.role as 'user' | 'assistant', finalContent, storeId, false)
    },
    [isSessionPaused, upsertStreamingMessage, addMessage],
  )

  const handleConversationRestart = useCallback(() => {
    clearMessages()
    resetMetrics()
    setTurnMetricsByIndex({})
    setTurnTextByIndex({})
    setTurnMetricsByText({})
  }, [clearMessages, resetMetrics])

  // Check if URL parameter session is completed (for "View Details & Metrics" button)
  useEffect(() => {
    if (!viewSessionId) return
    setIsCompletedSessionView(false)
    ;(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${viewSessionId}`, {
          headers: getAuthHeaders(),
        })
        if (!response.ok) {
          // Stale/foreign session pointer (deleted, or not owned): clear it so
          // we don't keep trying to resume a session we can't access.
          if (response.status === 403 || response.status === 404) {
            if (localStorage.getItem('spashtai_active_session') === viewSessionId) {
              localStorage.removeItem('spashtai_active_session')
              localStorage.removeItem('spashtai_session_timestamp')
            }
          }
          return
        }
        const data = await response.json()
        const session = data.session || data
        setViewSessionName(session.sessionName || null)
        setViewSessionPulse(session.progressPulseStatus || null)

        if (session.endedAt) {
          console.log('📊 Viewing completed session:', viewSessionId)
          setIsCompletedSessionView(true)
          setSessionId(viewSessionId)
          await loadConversation(viewSessionId)
        } else {
          // In-progress session — resume directly by connecting to LiveKit
          console.log('📖 Resuming in-progress session:', viewSessionId)
          setIsCompletedSessionView(false)
          setSessionId(viewSessionId)
          await loadConversation(viewSessionId)

          const newRoomName = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
          const u = new URL(`${API_BASE_URL}/livekit/token`)
          u.searchParams.set('identity', identity)
          u.searchParams.set('room', newRoomName)
          u.searchParams.set('sessionId', viewSessionId)
          u.searchParams.set('userName', user?.firstName || user?.email?.split('@')[0] || '')
          if (session.focusArea) u.searchParams.set('focusArea', session.focusArea)
          if (session.focusContext) u.searchParams.set('focusContext', session.focusContext)
          if (session.sessionName) u.searchParams.set('sessionName', session.sessionName)

          const res = await fetch(u.toString())
          if (!res.ok) throw new Error('Failed to get token')
          const json = await res.json()

          setToken(json.token)
          setUrl(json.url)
          setRoomName(newRoomName)
          setIsSessionPaused(false)
          resetMetrics()
          localStorage.setItem('spashtai_active_session', viewSessionId)
          localStorage.setItem('spashtai_session_timestamp', Date.now().toString())
        }
      } catch (error) {
        console.error('Error checking/resuming session:', error)
      }
    })()
  }, [viewSessionId])

  // Initialize conversation when session ID is available
  useEffect(() => {
    if (sessionId) {
      console.log('🔄 Loading conversation for session:', sessionId)
      loadConversation(sessionId)
      
      // Save to localStorage for resume capability
      localStorage.setItem('spashtai_active_session', sessionId)
      localStorage.setItem('spashtai_session_timestamp', Date.now().toString())
    }
  }, [sessionId, loadConversation])

  const joined = useMemo(() => Boolean(token && url), [token, url])
  const fallbackDispatchAttemptedRef = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  const pauseLiveSession = useCallback(() => {
    setShowHistory(false)
    setIsSessionPaused(true)
    setToken(null)
    setUrl(null)
    setRoomName('')
    setAssistantState('unknown')
  }, [])

  const resumeLiveSession = useCallback(async (resumeSessionId: string) => {
    const newRoomName = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
    const u = new URL(`${API_BASE_URL}/livekit/token`)
    u.searchParams.set('identity', identity)
    u.searchParams.set('room', newRoomName)
    u.searchParams.set('sessionId', resumeSessionId)
    const res = await fetch(u.toString())
    if (!res.ok) throw new Error('Failed to get token')
    const json = await res.json()
    setSessionId(resumeSessionId)
    setToken(json.token)
    setUrl(json.url)
    setRoomName(newRoomName)
    setIsSessionPaused(false)
    resetMetrics()
  }, [identity, resetMetrics])

  // ── Screen Wake Lock: prevent macOS from sleeping during active voice session ──
  useEffect(() => {
    if (!joined) {
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
      return
    }

    let released = false
    const acquire = async () => {
      try {
        if (!('wakeLock' in navigator)) return
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        wakeLockRef.current.addEventListener('release', () => {
          if (!released) console.log('🔓 Wake lock released by browser')
        })
        console.log('🔒 Screen wake lock acquired — Mac will stay awake')
      } catch {
        console.log('⚠️ Wake lock unavailable (tab may be hidden)')
      }
    }

    acquire()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && joined) acquire()
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [joined])

  // ── Idle detection: auto-pause after 15 min of inactivity ──
  const IDLE_TIMEOUT_MS = 15 * 60 * 1000
  const IDLE_WARNING_MS = 14 * 60 * 1000 // warn 1 min before
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [idleWarning, setIdleWarning] = useState(false)

  const resetIdleTimer = useCallback(() => {
    setIdleWarning(false)
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
    if (!joined || !sessionId) return

    warningTimerRef.current = setTimeout(() => {
      setIdleWarning(true)
    }, IDLE_WARNING_MS)

    idleTimerRef.current = setTimeout(() => {
      console.log('💤 Idle timeout — auto-pausing session')
      setIdleWarning(false)
      // Save session data before disconnecting
      if (sessionId) {
        fetch(`${API_BASE_URL}/sessions/${sessionId}/calculate-text-metrics`, {
          method: 'POST', headers: getAuthHeaders()
        }).catch(() => {})
      }
      // Disconnect LiveKit but keep session resumable
      pauseLiveSession()
    }, IDLE_TIMEOUT_MS)
  }, [joined, sessionId, pauseLiveSession])

  useEffect(() => {
    if (!joined) return
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll']
    const handler = () => resetIdleTimer()
    events.forEach(e => window.addEventListener(e, handler, { passive: true }))
    resetIdleTimer()
    return () => {
      events.forEach(e => window.removeEventListener(e, handler))
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current)
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    }
  }, [joined, resetIdleTimer])

  // ── Save session on tab close / navigate away ──
  useEffect(() => {
    const handler = () => {
      if (sessionId) {
        fetch(`${API_BASE_URL}/sessions/${sessionId}/calculate-text-metrics`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({}),
          keepalive: true,
        }).catch(() => {})
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sessionId])

  // Fallback recovery: if assistant remains unknown for too long, request manual dispatch once.
  useEffect(() => {
    if (!joined || !roomName || assistantState !== 'unknown') return
    if (fallbackDispatchAttemptedRef.current === roomName) return

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/livekit/dispatch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ room: roomName })
        })

        if (response.ok) {
          fallbackDispatchAttemptedRef.current = roomName
          console.log('🛟 Fallback dispatch triggered for room:', roomName)
        }
      } catch (error) {
        console.warn('⚠️ Fallback dispatch failed:', error)
      }
    }, 15000)

    return () => clearTimeout(timer)
  }, [joined, roomName, assistantState])

  const handleJoin = useCallback(async () => {
    try {
      // 1. Create session ID and room name
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const uniqueRoomName = roomName || `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`

      // 2. Create session in database FIRST (agent needs this for coaching context lookup)
      const sessionResponse = await fetch(`${API_BASE_URL}/sessions`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          id: newSessionId,
          module: 'elevate',
          sessionName: elevateSessionName.trim() || null,
          focusArea: focusArea || null,
          focusContext: inboundContext || null,
          startedAt: new Date().toISOString()
        })
      })
      
      if (!sessionResponse.ok) {
        console.warn('Failed to create session in database, continuing anyway')
      }

      // 3. Get LiveKit token (creates room — agent will start after this)
      const u = new URL(`${API_BASE_URL}/livekit/token`)
      u.searchParams.set('identity', identity)
      u.searchParams.set('room', uniqueRoomName)
      u.searchParams.set('sessionId', newSessionId)
      u.searchParams.set('userName', user?.firstName || user?.email?.split('@')[0] || '')
      if (focusArea) u.searchParams.set('focusArea', focusArea)
      if (inboundContext) u.searchParams.set('focusContext', inboundContext)
      if (elevateSessionName.trim()) u.searchParams.set('sessionName', elevateSessionName.trim())
      const res = await fetch(u.toString())
      if (!res.ok) throw new Error('Failed to get token')
      const json = await res.json()
      
      // 4. Set up LiveKit connection
      setToken(json.token)
      setUrl(json.url)
      setSessionId(newSessionId)
      setRoomName(uniqueRoomName)
      setIsSessionPaused(false)
      resetMetrics()
    } catch (error) {
      console.error('Error joining session:', error)
      throw error
    }
  }, [identity, roomName, elevateSessionName, focusArea, inboundContext, resetMetrics, user])

  // Called when LiveKit disconnects unexpectedly (refresh, network drop, etc.)
  // Does NOT end the session — leaves it resumable.
  const handleDisconnected = useCallback(() => {
    console.log('🔌 LiveKit disconnected — session remains resumable')
    pauseLiveSession()
    // Keep sessionId, localStorage, and messages intact so resume works
  }, [pauseLiveSession])

  // Called only when user explicitly clicks "Leave".
  // Ends the session permanently.
  const handleLeave = useCallback(async () => {
    const currentSessionId = sessionId

    setToken(null)
    setUrl(null)
    setSessionId(null)
    setRoomName('')
    setIsSessionPaused(false)
    setAssistantState('unknown')
    clearMessages()
    resetMetrics()

    localStorage.removeItem('spashtai_active_session')
    localStorage.removeItem('spashtai_session_timestamp')

    if (currentSessionId) {
      try {
        const endRes = await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/end`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ endedAt: new Date().toISOString() })
        })
        if (endRes.ok) {
          const endData = await endRes.json().catch(() => ({}))
          if (typeof endData.totalPoints === 'number') {
            updateUser({ rewardPoints: endData.totalPoints })
          }
        }

        // Run legacy text metrics (keeps backward compatibility)
        await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/calculate-text-metrics`, {
          method: 'POST',
          headers: getAuthHeaders()
        })
      } catch (err) {
        console.warn('Failed to finalize session:', err)
      }

      // Ask user whether to track this session in Progress Pulse
      const trackIt = await confirmDialog({
        title: 'Track in Progress Pulse?',
        description: 'Would you like to include this session\'s skill scores in your progress tracking?',
        confirmLabel: 'Yes, track this',
        cancelLabel: 'Skip — won\'t be added later',
      })

      // Run the full analytics pipeline (signal extraction + skill scores + coaching insights)
      try {
        const analyzeRes = await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/analyze`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ autoTrackPulse: trackIt, source: 'elevate' }),
        })
        if (analyzeRes.ok) {
          const result = await analyzeRes.json()
          if (trackIt && result.pulseEntriesCreated > 0) {
            toast.success(`Session tracked — ${result.pulseEntriesCreated} skills updated in Progress Pulse`)
          } else if (trackIt) {
            toast.success('Session tracked in Progress Pulse')
          }
        } else {
          console.warn('Analytics pipeline returned', analyzeRes.status)
          if (trackIt) toast.success('Session tracked in Progress Pulse')
        }
      } catch {
        console.warn('Analytics pipeline unavailable, session still saved')
        if (trackIt) toast.success('Session saved')
      }

      if (!trackIt) {
        try {
          await fetch(`${API_BASE_URL}/api/progress-pulse/skip`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ sessionId: currentSessionId, source: 'elevate' }),
          })
        } catch {
          // non-critical
        }
      }
    }

    setPastSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId ? { ...s, endedAt: new Date().toISOString() } : s
      )
    )

    // A session started this visit won't exist in the list that was loaded on
    // mount, so the optimistic map above can't add it — refetch to surface it.
    loadPastSessions({ silent: true })

    if (currentSessionId) {
      setShowHistory(false)
      setResultsTab('playback')
      setPlaybackFocus(null)
      setIsCompletedSessionView(true)
      setSessionId(currentSessionId)
      navigate(`/elevate?session=${encodeURIComponent(currentSessionId)}`)
    } else {
      setShowHistory(true)
      navigate(cameFromHistory ? '/history?tab=elevate' : '/elevate')
    }
  }, [sessionId, clearMessages, resetMetrics, navigate, cameFromHistory, confirmDialog, updateUser, loadPastSessions])

  const handleDiscard = useCallback(async () => {
    const yes = await confirmDialog({
      title: 'Discard this session?',
      description: 'This will permanently delete the session and all its data. This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep session',
    })
    if (!yes) return

    const currentSessionId = sessionId
    setToken(null)
    setUrl(null)
    setSessionId(null)
    setRoomName('')
    setIsSessionPaused(false)
    setAssistantState('unknown')
    clearMessages()
    resetMetrics()
    localStorage.removeItem('spashtai_active_session')
    localStorage.removeItem('spashtai_session_timestamp')

    if (currentSessionId) {
      try {
        await fetch(`${API_BASE_URL}/sessions/${currentSessionId}`, {
          method: 'DELETE',
          headers: getAuthHeaders(),
        })
        setPastSessions((prev) => prev.filter((s) => s.id !== currentSessionId))
        setSelectedElevate((prev) => { const n = new Set(prev); n.delete(currentSessionId); return n })
        toast.success('Session discarded')
      } catch {
        toast.error('Failed to delete session')
      }
    }

    setShowHistory(true)
    navigate('/elevate')
  }, [sessionId, clearMessages, resetMetrics, navigate, confirmDialog])

  // Return from a viewed session's results back to the Elevate session list.
  const handleBackToElevate = useCallback(() => {
    setSessionId(null)
    setIsCompletedSessionView(false)
    setViewSessionName(null)
    setViewSessionPulse(null)
    setShowHistory(true)
    clearMessages()
    resetMetrics()
    navigate('/elevate')
  }, [clearMessages, resetMetrics, navigate])

  const breadcrumbLabel = viewSessionId
    ? 'Session Analytics'
    : joined
      ? 'Live Session'
      : 'New Session'

  // ── Session history view ──
  if (showHistory && !joined && !viewSessionId && !sessionId) {
    const formatRelDate = (d: string) => {
      const ms = Date.now() - new Date(d).getTime()
      const m = Math.floor(ms / 60000), h = Math.floor(ms / 3600000), dy = Math.floor(ms / 86400000)
      if (m < 1) return 'Just now'
      if (m < 60) return `${m}m ago`
      if (h < 24) return `${h}h ago`
      if (dy < 7) return `${dy}d ago`
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    const fmtDur = (s: number) => `${Math.floor(s / 60)}m ${s % 60}s`

    return (
      <div className="grid gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Elevate</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Practice with a live AI coach and elevate your communication skills.
            </p>
          </div>
          <Button className="w-full sm:w-auto shrink-0" onClick={() => setShowHistory(false)}>
            + New Elevate Session
          </Button>
        </div>

        {recommendation && !inboundNewSession && (
          <Card className="border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-transparent">
            <CardContent className="py-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Target className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Recommended Practice</p>
                    <p className="mt-0.5 text-sm">
                      Your <span className="font-semibold">{recommendation.label}</span> score is{' '}
                      <span className="font-semibold">{recommendation.score.toFixed(1)}</span>/10 — the area with the most room to grow.
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={() => {
                    setFocusArea(recommendation.skill)
                    setElevateSessionName(`Practice: ${recommendation.label}`)
                    setShowHistory(false)
                  }}
                >
                  Practice {recommendation.label}
                  <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {pastLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            Loading sessions...
          </div>
        )}

        {!pastLoading && pastSessions.length > 0 && (
          <SessionFilters
            search={elevSearch}
            onSearchChange={setElevSearch}
            sortField={elevSortField}
            sortDir={elevSortDir}
            onSortChange={(f, d) => { setElevSortField(f); setElevSortDir(d) }}
            sortOptions={elevateSortOptions}
            statusFilter={elevStatusFilter}
            onStatusFilterChange={setElevStatusFilter}
            statusOptions={elevateStatusOptions}
            totalCount={pastSessions.length}
            filteredCount={filteredPastSessions.length}
          />
        )}

        {!pastLoading && pastSessions.length === 0 && (
          <Card>
            <CardContent className="py-16 text-center">
              <h3 className="text-lg font-medium">No Elevate sessions yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Start a live AI coaching session to practice and improve.
              </p>
              <Button className="mt-4" onClick={() => setShowHistory(false)}>
                + Start Your First Session
              </Button>
            </CardContent>
          </Card>
        )}

        {!pastLoading && pastSessions.length > 0 && filteredPastSessions.length === 0 && (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No sessions match your filters.
            </CardContent>
          </Card>
        )}

        {selectedElevate.size > 0 && (
          <div className="mb-1 flex items-center gap-2">
            <Button variant="destructive" size="sm" onClick={handleDeleteSelectedElevate}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedElevate.size} Selected
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSelectedElevate(new Set())}>
              Clear
            </Button>
          </div>
        )}

        {!pastLoading && filteredPastSessions.length > 0 && (
          <div className="grid gap-3">
            {filteredPastSessions.map((s) => {
              const done = s.endedAt != null
              const isSelected = selectedElevate.has(s.id)
              return (
                <Card key={s.id} className={`transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center py-4">
                    <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                      <button
                        onClick={() =>
                          setSelectedElevate((prev) => {
                            const n = new Set(prev)
                            n.has(s.id) ? n.delete(s.id) : n.add(s.id)
                            return n
                          })
                        }
                        className="shrink-0"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">
                            {s.sessionName || `${s.module.charAt(0).toUpperCase() + s.module.slice(1)} Session`}
                          </span>
                          <Badge variant={done ? 'default' : 'secondary'}>
                            {done ? 'Completed' : 'In Progress'}
                          </Badge>
                          {s.focusArea && (
                            <Badge variant="outline" className="text-xs">
                              {getFocusAreaLabel(s.focusArea)}
                            </Badge>
                          )}
                          {s.progressPulseStatus === 'tracked' && (
                            <span className="flex items-center gap-0.5 text-green-600" title="Tracked in Progress Pulse">
                              <CheckCircle2 className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span>{formatRelDate(s.startedAt)}</span>
                          {done && s.durationSec != null && <span>{fmtDur(s.durationSec)}</span>}
                          {s.words != null && <span>{s.words} words</span>}
                          {s.fillerRate != null && <span>{s.fillerRate.toFixed(1)}% fillers</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                      <Link to={`/elevate?session=${s.id}`}>
                        <Button size="sm" variant="outline">
                          {done ? 'View Results' : 'Resume'}
                        </Button>
                      </Link>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteElevateSession(s.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      {/* Back navigation */}
      {!joined && viewSessionId && (
        cameFromHistory ? (
          <Link to="/history?tab=elevate" className="text-sm text-muted-foreground hover:text-foreground w-fit">
            &larr; Back to Sessions
          </Link>
        ) : (
          <button
            onClick={handleBackToElevate}
            className="text-sm text-muted-foreground hover:text-foreground w-fit"
          >
            &larr; Back to Elevate
          </button>
        )
      )}
      {!joined && !viewSessionId && !showHistory && !sessionId && (
        <button
          onClick={() => setShowHistory(true)}
          className="text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          &larr; Back to sessions
        </button>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle>
              {viewSessionId && viewSessionName ? viewSessionName : 'Elevate Session'}
            </CardTitle>
            {viewSessionId && isCompletedSessionView && viewSessionPulse === 'tracked' && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-green-300 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700"
                title="This session is tracked in Progress Pulse"
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Tracked in Pulse
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!joined && !viewSessionId && !sessionId ? (
            <div className="grid gap-3">
              <div>
                <label className="text-sm font-medium">Session Name *</label>
                <Input
                  value={elevateSessionName}
                  onChange={(e) => setElevateSessionName(e.target.value)}
                  placeholder="e.g. Interview Practice, Pitch Rehearsal"
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Give this session a memorable name so you can find it later.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Focus Area</label>
                <select
                  value={focusArea}
                  onChange={(e) => setFocusArea(e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">General practice (no specific focus)</option>
                  {FOCUS_AREAS.map((a) => (
                    <option key={a.id} value={a.id}>{a.label} — {a.description}</option>
                  ))}
                </select>
                {inboundContext && (
                  <p className="mt-1 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-primary">
                    From Replay: <span className="font-medium">{inboundContext}</span>
                  </p>
                )}
              </div>
              <div className="flex gap-3 pt-2">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  onClick={() => navigate(-1)}
                >
                  Cancel
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  onClick={handleJoin}
                  disabled={!elevateSessionName.trim()}
                >
                  Start Session
                </Button>
              </div>
            </div>
          ) : !joined && viewSessionId && isCompletedSessionView ? (
            <Tabs
              value={resultsTab}
              onValueChange={(v) => {
                // User-initiated tab change: drop any pending deep-link so it
                // doesn't replay when Playback re-mounts.
                setResultsTab(v)
                setPlaybackFocus(null)
              }}
              className="space-y-4"
            >
              <div className="flex">
                {/* The metrics summary lives INSIDE the Session Analytics trigger so it
                    inherits the tab's background (muted when unselected, white when
                    selected) — it reads as part of the tab, not a separate element. */}
                <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
                  <TabsTrigger value="playback" className="py-1.5">
                    <Play className="mr-2 h-4 w-4" /> Playback
                  </TabsTrigger>
                  <TabsTrigger value="analytics" className="gap-3 py-1.5">
                    <span className="flex items-center">
                      <BarChart3 className="mr-2 h-4 w-4" /> Session Analytics
                    </span>
                    {sessionId && (
                      <>
                        <span className="hidden h-4 w-px bg-border lg:block" />
                        <span className="hidden min-w-0 lg:inline-flex">
                          <SessionMetricsSummary
                            sessionId={sessionId}
                            metrics={historicalMetrics}
                            variant="inline"
                            turns={completedTurns}
                          />
                        </span>
                      </>
                    )}
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="analytics" className="space-y-4">
                {/* Conversation chat — collapsed by default to keep analytics front and center */}
                <ChatPanel
                  messages={messages}
                  turnMetricsByIndex={turnMetricsByIndex}
                  turnTextByIndex={turnTextByIndex}
                  turnMetricsByText={turnMetricsByText}
                  transcriptHidden={exportFlags.hideTranscriptText}
                  collapsible
                  defaultCollapsed
                />

                {/* Historical metrics display */}
                {sessionId && historicalMetrics && (
                  <>
                    <SessionMetrics
                      sessionId={sessionId}
                      metrics={historicalMetrics}
                      onDownloadTranscript={downloadTranscript}
                      onExportPdf={handleElevateExportPdf}
                      pdfLoading={elevatePdfLoading}
                      aside={<CoachingInsightsCard sessionId={sessionId} isSessionEnded fill />}
                    />

                    {/* Pace variation across turns */}
                    <div className="mt-6">
                      <PaceTrendCard
                        sessionId={sessionId}
                        isSessionEnded={true}
                        points={completedPacePoints}
                      />
                    </div>

                    {/* Communication Score (with inline skill breakdown) */}
                    <div className="mt-6">
                      <SkillScoresCard
                        sessionId={sessionId}
                        isSessionEnded={true}
                        onHearMoment={hearSkillMoment}
                      />
                    </div>

                    {/* Content & Delivery analysis */}
                    <div className="mt-6">
                      <AdvancedInsights sessionId={sessionId} isSessionEnded={true} />
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="playback">
                <SessionReplay
                  sessionId={sessionId ?? viewSessionId ?? undefined}
                  embedded
                  focusRequest={playbackFocus}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">
              {idleWarning && (
                <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Session will auto-pause in 1 minute due to inactivity. Move your mouse or press a key to stay connected.</span>
                  <Button size="sm" variant="outline" onClick={resetIdleTimer}>Stay Connected</Button>
                </div>
              )}
              {!token && !url && sessionId && !isSessionPaused && (
                <div className="rounded-md border border-blue-400 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {isSessionPaused
                      ? 'Session paused. User and assistant are both paused.'
                      : 'Session disconnected. Your conversation is saved.'}
                  </span>
                  <Button size="sm" onClick={() => {
                    if (!sessionId) return
                    resumeLiveSession(sessionId).catch((err) => {
                      console.error('Failed to resume session:', err)
                    })
                  }}>Resume Session</Button>
                </div>
              )}
              {!joined && isSessionPaused && (
                <>
                  <div className="flex justify-center w-full mb-2">
                    <SessionStatusBar
                      isPaused
                      label="Paused"
                      hint="Click Resume to continue"
                      className="bg-muted/20 rounded-lg w-full"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-green-600">Ready</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <Button onClick={handleLeave}>Leave</Button>
                    <Button
                      variant="outline"
                      onClick={() => setShowMetrics(!showMetrics)}
                    >
                      {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        if (!sessionId) return
                        resumeLiveSession(sessionId).catch((err) => {
                          console.error('Failed to resume session:', err)
                        })
                      }}
                    >
                      Resume
                    </Button>
                    <Button variant="outline" disabled title="Resume session to record audio">
                      Record My Audio
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDiscard}>
                      Discard Session
                    </Button>
                  </div>
                </>
              )}
              {url && token && (
                <LiveKitRoom
                  token={token}
                  serverUrl={url}
                  connectOptions={{ autoSubscribe: true }}
                  video={false}
                  audio={true}
                  onDisconnected={handleDisconnected}
                >
                  <RoomAudioRenderer />
                  <CoachAudioBootstrap />
                  <SessionRecorder sessionId={sessionId} disabled={exportFlags.hideAudioDownload} />
                  <StartAudio label="Click to enable coach audio" />
                  <div className="flex justify-center w-full mb-2">
                    <AgentVisualizer className="bg-muted/20 rounded-lg w-full" isPaused={isSessionPaused} compact />
                  </div>
                  <ConnectionStatus assistantState={assistantState} />
                  <LiveKitConversation
                    key={roomName}
                    sessionId={sessionId}
                    isSessionPaused={isSessionPaused}
                    onNewMessage={handleNewMessage}
                    onStateChange={setAssistantState}
                    onRestart={handleConversationRestart}
                    onTurnMetrics={(text, metrics, turnIndex) => {
                      if (turnIndex != null && turnIndex > 0) {
                        // Metrics only — the bubble text is driven by live interim
                        // partials + the committed final, not by turn_metrics
                        // (which carries shorter committed text and caused flicker).
                        // We keep the committed text per index so a stitched UI
                        // bubble (which can contain several agent sub-turns) can
                        // aggregate all the sub-turn metrics it spans.
                        setTurnMetricsByIndex((prev) => ({ ...prev, [turnIndex]: metrics }))
                        if (text) {
                          setTurnTextByIndex((prev) => ({ ...prev, [turnIndex]: text }))
                        }
                      } else if (text) {
                        const key = normalizeTurnText(text)
                        setTurnMetricsByText((prev) => ({ ...prev, [key]: metrics }))
                      }
                    }}
                    onMetricsUpdate={updateMetrics}
                  />
                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <Button onClick={handleLeave}>Leave</Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowMetrics(!showMetrics)}
                    >
                      {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
                    </Button>
                    <InRoomControls
                      sessionId={sessionId}
                      onPauseSession={pauseLiveSession}
                      hideAudioDownload={exportFlags.hideAudioDownload}
                    />
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDiscard}>
                      Discard Session
                    </Button>
                  </div>
                </LiveKitRoom>
              )}
              <ChatPanel
                messages={messages}
                turnMetricsByIndex={turnMetricsByIndex}
                turnTextByIndex={turnTextByIndex}
                turnMetricsByText={turnMetricsByText}
                liveMetrics={currentMetrics}
                showLiveMetrics={showMetrics}
                transcriptHidden={exportFlags.hideTranscriptText}
              />

              {/* Historical metrics display */}
              {!joined && sessionId && historicalMetrics && !isSessionPaused && (
                <>
                  <SessionMetrics 
                    sessionId={sessionId}
                    metrics={historicalMetrics}
                    onDownloadTranscript={downloadTranscript}
                    onExportPdf={handleElevateExportPdf}
                    pdfLoading={elevatePdfLoading}
                    aside={<CoachingInsightsCard sessionId={sessionId} isSessionEnded={!joined} fill />}
                  />

                  {/* Pace variation across turns */}
                  <div className="mt-6">
                    <PaceTrendCard sessionId={sessionId} isSessionEnded={!joined} />
                  </div>

                  {/* Communication Score (with inline skill breakdown) */}
                  <div className="mt-6">
                    <SkillScoresCard
                      sessionId={sessionId}
                      isSessionEnded={!joined}
                    />
                  </div>

                  {/* Content & Delivery analysis */}
                  <div className="mt-6">
                    <AdvancedInsights 
                      sessionId={sessionId}
                      isSessionEnded={!joined}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ConnectionStatus({ assistantState }: { assistantState: 'restarting' | 'ready' | 'recovering' | 'unknown' }) {
  const state = useConnectionState()
  const room = useRoomContext()
  const isConnected = state === 'connected'
  const isConnecting = state === 'connecting'

  const [agentPresent, setAgentPresent] = useState(false)

  useEffect(() => {
    if (!room) return

    const checkAgent = () => {
      for (const p of room.remoteParticipants.values()) {
        if (p.name?.toLowerCase().includes('assistant') || p.identity?.startsWith('agent')) {
          setAgentPresent(true)
          return
        }
      }
    }

    checkAgent()
    const onJoin = () => checkAgent()
    room.on(RoomEvent.ParticipantConnected, onJoin)
    return () => { room.off(RoomEvent.ParticipantConnected, onJoin) }
  }, [room])

  const effectiveState = assistantState === 'unknown' && agentPresent ? 'ready' : assistantState
  
  const getOverallStatus = () => {
    if (!isConnected && !isConnecting) return { text: 'Disconnected', color: 'text-red-600' }
    if (isConnecting) return { text: 'Connecting to room...', color: 'text-yellow-600' }
    if (isConnected && effectiveState === 'unknown') return { text: 'Waiting for assistant...', color: 'text-yellow-600' }
    if (isConnected && effectiveState === 'ready') return { text: 'Ready', color: 'text-green-600' }
    if (effectiveState === 'restarting') return { text: 'Assistant restarting...', color: 'text-yellow-600' }
    if (effectiveState === 'recovering') return { text: 'Recovering...', color: 'text-yellow-600' }
    return { text: 'Connected', color: 'text-green-600' }
  }
  
  const status = getOverallStatus()
  
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={status.color}>
        {status.text}
      </span>
      {(isConnecting || (isConnected && effectiveState === 'unknown')) && (
        <span className="inline-block w-4 h-4 border-2 border-yellow-600 border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}

// Official LiveKit conversation component using built-in patterns
function LiveKitConversation({
  sessionId,
  isSessionPaused,
  onNewMessage,
  onStateChange,
  onRestart,
  onMetricsUpdate,
  onTurnMetrics,
}: {
  sessionId: string | null
  isSessionPaused: boolean
  onNewMessage: (message: ChatMessage & { partial?: boolean }) => void
  onStateChange: (state: 'restarting' | 'ready' | 'recovering' | 'unknown') => void
  onRestart: () => void
  onMetricsUpdate: (metrics: any) => void
  onTurnMetrics?: (text: string, metrics: TurnMetrics, turnIndex?: number) => void
}) {
  const connectionState = useConnectionState()
  const room = useRoomContext()
  const { agentTranscriptions } = useVoiceAssistant()
  const seenFragmentsRef = useRef<Map<string, string>>(new Map())
  const lastControlStateRef = useRef<string>('unknown')
  const onNewMessageRef = useRef(onNewMessage)
  const lastAgentStreamRef = useRef<{ id: string; text: string; final: boolean } | null>(null)
  const activeAssistantMsgIdRef = useRef<string | null>(null)

  useEffect(() => {
    lastAgentStreamRef.current = null
    activeAssistantMsgIdRef.current = null
    seenFragmentsRef.current.clear()
  }, [sessionId])

  useEffect(() => {
    onNewMessageRef.current = onNewMessage
  }, [onNewMessage])

  // Live typing indicator while coach speaks (finals come from lk.conversation)
  useEffect(() => {
    if (isSessionPaused || agentTranscriptions.length === 0) return
    const latest = agentTranscriptions[agentTranscriptions.length - 1]
    if (latest.final) return
    const text = stripThinkingBlocks(latest.text?.trim() || '')
    if (!text) return

    const streamId = activeAssistantMsgIdRef.current || latest.id || `agent-live-${Date.now()}`
    activeAssistantMsgIdRef.current = streamId

    onNewMessageRef.current({
      role: 'assistant',
      content: text,
      id: streamId,
      partial: true,
      timestamp: new Date().toISOString(),
    })
  }, [agentTranscriptions, isSessionPaused])

  const processPayload = useCallback(
    (payload: string, source: 'dataChannel' | 'roomEvent') => {
      try {
        const parsed = JSON.parse(payload) as {
          type?: string
          text?: string
          final?: boolean
          replace?: boolean
          id?: string
          timestamp?: number
        }

        if (!parsed?.type || !parsed?.text) {
          console.log('⚠️ Ignoring non-conversation payload', { parsed, source })
          return
        }

        // Coach speech is streamed via useVoiceAssistant agentTranscriptions
        if (parsed.type === 'assistant') return

        const key = parsed.id || `${parsed.type}`
        const existing = seenFragmentsRef.current.get(key) || ''

        if (parsed.replace) {
          console.log('♻️ Replacement message received', { key, source })
          seenFragmentsRef.current.delete(key)
          const role = parsed.type === 'assistant' ? 'assistant' : 'user'
          onNewMessageRef.current({ role, content: parsed.text, id: parsed.id, timestamp: new Date().toISOString() })
          return
        }

        const next = `${existing}${parsed.text}`

        if (parsed.final) {
          seenFragmentsRef.current.delete(key)
          const role = parsed.type === 'assistant' ? 'assistant' : 'user'
          onNewMessageRef.current({
            role,
            content: next,
            id: parsed.id || key,
            partial: false,
            timestamp: new Date().toISOString(),
          })
          return
        }

        seenFragmentsRef.current.set(key, next)
        const role = parsed.type === 'assistant' ? 'assistant' : 'user'
        onNewMessageRef.current({
          role,
          content: next,
          id: parsed.id || key,
          partial: true,
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.log('❌ LiveKit message parse error:', error, { payload, source })
      }
    },
    [],
  )



  // Detect agent participant joining as a secondary "ready" signal
  useEffect(() => {
    if (!room) return
    const check = (p: any) => {
      const name = (p.name || '').toLowerCase()
      const identity = (p.identity || '').toLowerCase()
      if (name.includes('assistant') || identity.startsWith('agent')) {
        if (lastControlStateRef.current === 'unknown') {
          lastControlStateRef.current = 'ready'
          onStateChange('ready')
        }
      }
    }
    for (const p of room.remoteParticipants.values()) check(p)
    room.on(RoomEvent.ParticipantConnected, check)
    return () => { room.off(RoomEvent.ParticipantConnected, check) }
  }, [room, onStateChange])

  // Direct room event handling for data channels (more reliable than useDataChannel hooks)
  useEffect(() => {
    if (!room) return

    const handleData = (payload: Uint8Array, participant: any, _kind: any, topic?: string) => {
      if (!topic) return

      if (isSessionPaused) {
        return
      }
      
      const text = new TextDecoder().decode(payload)
      console.log(`📨 Data channel received on ${topic}:`, text)
      
      // Process different topics
      switch (topic) {
        case 'lk.transcription':
          console.log('📱 LiveKit transcription received:', {
            participantId: participant?.identity,
            topic,
            connected: connectionState
          })
          processPayload(text, 'dataChannel')
          break
          
        case 'lk.control':
          try {
            const parsed = JSON.parse(text) as { type?: string; text?: string }
            if (parsed?.type === 'session_state' && parsed.text) {
              const stateText = parsed.text.toLowerCase()
              let state: 'restarting' | 'ready' | 'recovering' | 'unknown' = 'unknown'
              if (stateText.includes('ready')) state = 'ready'
              else if (stateText.includes('recovering')) state = 'recovering'
              else if (stateText.includes('restart')) state = 'restarting'

              if (lastControlStateRef.current !== state) {
                lastControlStateRef.current = state
                onStateChange(state)
                if (state === 'restarting') {
                  onRestart()
                }
              }
            }
          } catch (error) {
            console.log('⚠️ Invalid control payload', error)
          }
          break
          
        case 'lk.conversation':
          try {
            const conversationData = JSON.parse(text)
            console.log('💬 Conversation data received:', conversationData)

            if (conversationData.type === 'turn_metrics' && conversationData.turnMetrics) {
              onTurnMetrics?.(
                conversationData.text || '',
                conversationData.turnMetrics as TurnMetrics,
                typeof conversationData.turnIndex === 'number' ? conversationData.turnIndex : undefined,
              )
              break
            }
            
            // Final coach turns — one id per utterance from the agent
            if (conversationData.type === 'assistant') {
              const content = stripThinkingBlocks(
                conversationData.text || conversationData.content || '',
              )
              const timestamp = conversationData.timestamp
                ? new Date(conversationData.timestamp).toISOString()
                : new Date().toISOString()

              if (content) {
                // Reuse the live-streamed bubble's id so the authoritative
                // final REPLACES the streaming partial in place rather than
                // creating a second identical bubble. The live coach text is
                // streamed under activeAssistantMsgIdRef (from the TTS
                // transcription); the agent's own item id differs, so using it
                // here would never reconcile with the partial. Fall back to the
                // item id only when no live stream was active for this turn.
                const finalId =
                  activeAssistantMsgIdRef.current ||
                  conversationData.id ||
                  `assistant-${Date.now()}`
                onNewMessageRef.current({
                  role: 'assistant',
                  content,
                  id: finalId,
                  timestamp,
                  partial: false,
                })
                activeAssistantMsgIdRef.current = null
                lastAgentStreamRef.current = null
              }
            } else if (conversationData.type === 'user') {
              const content = conversationData.text || conversationData.content || ''
              const timestamp = conversationData.timestamp 
                ? new Date(conversationData.timestamp).toISOString() 
                : new Date().toISOString()
              
              if (content) {
                onNewMessageRef.current({ 
                  role: 'user', 
                  content, 
                  id: conversationData.id,
                  timestamp,
                  partial: conversationData.final === false,
                })
              }
            }
            // Legacy format support
            else if (conversationData.type === 'conversation_message') {
              const messageText = `${conversationData.role}: ${conversationData.content}`
              processPayload(messageText, 'dataChannel')
            }
          } catch (error) {
            console.log('⚠️ Invalid conversation payload', error)
          }
          break
          
        case 'lk.metrics':
          try {
            const metricsUpdate = JSON.parse(text)
            console.log('📊 Received metrics update:', metricsUpdate)
            onMetricsUpdate(metricsUpdate)
          } catch (error) {
            console.log('⚠️ Invalid metrics payload', error)
          }
          break
          
        case 'lk.session':
          try {
            const sessionData = JSON.parse(text)
            if (sessionData.type === 'session_complete') {
              console.log('🏁 Session completed, saving metrics:', sessionData)
              if (sessionId) {
                saveSessionData(sessionId, sessionData.metrics, sessionData.transcript)
              }
            }
          } catch (error) {
            console.log('⚠️ Invalid session payload', error)
          }
          break
          
        case 'lk.settings':
          // Coach patience is auto-selected by the agent; ignore setting acks.
          break

        default:
          console.log('📨 Unknown data channel topic:', topic)
      }
    }

    room.on(RoomEvent.DataReceived, handleData)
    
    return () => {
      room.off(RoomEvent.DataReceived, handleData)
    }
  }, [room, connectionState, processPayload, onStateChange, onRestart, onMetricsUpdate, onTurnMetrics, sessionId, isSessionPaused])

  // Remove duplicate - handled by first useEffect above
  // This second useEffect was causing messages to be missed!

  return null
}

function InRoomControls({
  sessionId,
  onPauseSession,
  hideAudioDownload = false,
}: {
  sessionId: string | null
  onPauseSession: () => void
  hideAudioDownload?: boolean
}) {
  const room = useRoomContext()
  const { isRecording, startRecording, stopRecording } = useAudioRecording()

  const toggle = useCallback(async () => {
    try {
      await room.localParticipant.setMicrophoneEnabled(false)
    } catch (error) {
      console.warn('Failed to mute microphone before pause:', error)
      toast.error('Mic mute failed, but session is paused')
    }
    onPauseSession()
  }, [room, onPauseSession])

  const handleToggleRecording = useCallback(async () => {
    if (isRecording) {
      const blob = await stopRecording()
      if (!blob) {
        toast.error('No audio captured for download')
        return
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeSessionId = sessionId || 'session'
      const filename = `spashtai-user-audio-${safeSessionId}-${timestamp}.webm`
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      toast.success('Audio downloaded. You can now validate WPM in external tools.')
      return
    }

    const publications = Array.from(room.localParticipant.trackPublications.values())
    const micPublication = publications.find((publication) => publication.source === Track.Source.Microphone)
    const mediaStreamTrack = (micPublication?.track as any)?.mediaStreamTrack as MediaStreamTrack | undefined

    if (!mediaStreamTrack) {
      toast.error('Microphone track not ready yet. Please try again in a second.')
      return
    }

    startRecording(new MediaStream([mediaStreamTrack]))
    toast.success('Recording started')
  }, [isRecording, room, sessionId, startRecording, stopRecording])

  return (
    <>
      <Button variant="secondary" onClick={toggle}>
        Pause
      </Button>
      {!hideAudioDownload && (
        <Button variant={isRecording ? 'destructive' : 'outline'} onClick={handleToggleRecording}>
          {isRecording ? 'Stop & Download Audio' : 'Record My Audio'}
        </Button>
      )}
    </>
  )
}

interface TurnMetrics {
  word_count: number
  filler_count: number
  filler_rate: number
  hedging_count: number
  acknowledgment_count?: number
  vocab_diversity?: number
  wpm?: number | null
  speaking_seconds?: number | null
  qualitative_pace?: string | null
  coaching_tip?: string | null
}

interface ChatMessage {
  id?: string;
  role: string;
  content: string;
  timestamp: string;
}

function normalizeTurnText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

function lookupTurnMetrics(content: string, map: Record<string, TurnMetrics>): TurnMetrics | undefined {
  const key = normalizeTurnText(content)
  if (map[key]) return map[key]
  for (const [k, v] of Object.entries(map)) {
    if (key.includes(k) || k.includes(key)) return v
  }
  return undefined
}

function qualitativePaceFromWpm(wpm: number): string {
  if (wpm <= 0) return 'not-enough-data'
  if (wpm < 100) return 'slow'
  if (wpm < 120) return 'measured'
  if (wpm <= 160) return 'ideal'
  if (wpm <= 180) return 'fast'
  return 'rapid'
}

function vocabDiversityOf(text: string): number {
  const words = (text.toLowerCase().match(/[a-z']+/g) || [])
  if (words.length === 0) return 0
  return new Set(words).size / words.length
}

// A user "turn" the coach replies to is split by the endpointer into multiple
// agent sub-turns, but the UI stitches them into one bubble. Aggregate every
// sub-turn metric whose committed text falls inside the bubble so the popover
// reflects the WHOLE paragraph (additive counts; WPM from summed words/seconds;
// vocab recomputed from the full bubble text).
function aggregateTurnMetrics(parts: TurnMetrics[], bubbleContent: string): TurnMetrics {
  if (parts.length === 1) return parts[0]
  const sum = (pick: (m: TurnMetrics) => number) => parts.reduce((a, m) => a + (pick(m) || 0), 0)
  const word_count = sum((m) => m.word_count)
  const filler_count = sum((m) => m.filler_count)
  const hedging_count = sum((m) => m.hedging_count)
  const acknowledgment_count = sum((m) => m.acknowledgment_count ?? 0)
  const speaking_seconds = sum((m) => m.speaking_seconds ?? 0)
  const filler_rate = word_count > 0 ? (filler_count / word_count) * 100 : 0
  const wpm = speaking_seconds > 0 ? (word_count / speaking_seconds) * 60 : null
  return {
    word_count,
    filler_count,
    filler_rate,
    hedging_count,
    acknowledgment_count,
    vocab_diversity: vocabDiversityOf(bubbleContent),
    wpm,
    speaking_seconds: speaking_seconds > 0 ? speaking_seconds : null,
    qualitative_pace: wpm != null ? qualitativePaceFromWpm(wpm) : null,
    coaching_tip: parts[parts.length - 1]?.coaching_tip ?? null,
  }
}

// Collect all sub-turn metrics whose committed text is contained in a bubble.
// Uses an 8-word probe (or the whole text if shorter) to avoid mis-matching
// short fragments, and a `consumed` set so a sub-turn is attributed once.
function collectTurnMetricsForBubble(
  bubbleContent: string,
  ordered: { idx: number; text: string; metrics: TurnMetrics }[],
  consumed: Set<number>,
): TurnMetrics[] {
  const bubbleNorm = normalizeTurnText(bubbleContent)
  const parts: TurnMetrics[] = []
  for (const entry of ordered) {
    if (consumed.has(entry.idx)) continue
    const t = normalizeTurnText(entry.text)
    if (!t) continue
    const probe = t.split(' ').slice(0, 8).join(' ')
    if (probe && bubbleNorm.includes(probe)) {
      parts.push(entry.metrics)
      consumed.add(entry.idx)
    }
  }
  return parts
}

function paceLabel(pace?: string | null): string {
  if (!pace || pace === 'not-enough-data') return '—'
  return pace.charAt(0).toUpperCase() + pace.slice(1)
}

function HighlightedSpeechText({ text }: { text: string }) {
  const spans = useMemo(() => findSpeechSpans(text), [text])
  if (spans.length === 0) return <>{text}</>

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    const slice = text.slice(span.start, span.end)
    nodes.push(
      <mark key={`${span.start}-${span.kind}`} className={SPEECH_HIGHLIGHT_CLASS[span.kind]}>
        {slice}
      </mark>,
    )
    cursor = span.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return <>{nodes}</>
}

function UserTurnBubble({ content, metrics }: { content: string; metrics: TurnMetrics }) {
  const [highlight, setHighlight] = useState(false)

  return (
    <div className="flex items-start gap-2">
      <p className="flex-1 min-w-0 text-[13px] leading-relaxed whitespace-pre-wrap break-words">
        {highlight ? <HighlightedSpeechText text={content} /> : content}
      </p>
      <div className="flex-shrink-0 self-end">
        <TurnMetricsPopover metrics={metrics} onOpenChange={setHighlight} />
      </div>
    </div>
  )
}

function TurnMetricsPopover({
  metrics,
  onOpenChange,
}: {
  metrics: TurnMetrics
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const PANEL_W = 240
  const PANEL_H = 300

  const setOpenState = useCallback((next: boolean) => {
    setOpen(next)
  }, [])

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const margin = 8
    let top = rect.bottom + margin
    let left = Math.max(margin, rect.right - PANEL_W)
    if (top + PANEL_H > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - PANEL_H - margin)
    }
    if (left + PANEL_W > window.innerWidth - margin) {
      left = window.innerWidth - PANEL_W - margin
    }
    setPos({ top, left })
  }, [])

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const next = !wasOpen
      if (next) {
        requestAnimationFrame(updatePosition)
      }
      return next
    })
  }, [updatePosition])

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
    }
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenState(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpenState])

  const vocabPct =
    metrics.vocab_diversity != null ? Math.round(metrics.vocab_diversity * 100) : null

  const panel = open ? (
    <>
      <div className="fixed inset-0 z-40" aria-hidden onClick={() => setOpenState(false)} />
      <div
        role="tooltip"
        className="fixed z-50 w-60 max-h-[min(320px,calc(100vh-16px))] overflow-y-auto rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[11px] font-semibold mb-2">This turn</div>
        <dl className="space-y-1 text-[10px]">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">WPM</dt>
            <dd>{metrics.wpm != null ? metrics.wpm.toFixed(0) : '—'}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Fillers</dt>
            <dd>{metrics.filler_count} ({metrics.filler_rate.toFixed(1)}%)</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Hedging</dt>
            <dd>{metrics.hedging_count}</dd>
          </div>
          {(metrics.acknowledgment_count ?? 0) > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Acknowledgments</dt>
              <dd>{metrics.acknowledgment_count}</dd>
            </div>
          )}
          {vocabPct != null && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">Vocabulary</dt>
              <dd>{vocabPct}%</dd>
            </div>
          )}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Pace</dt>
            <dd>{paceLabel(metrics.qualitative_pace)}</dd>
          </div>
        </dl>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground border-t pt-2">
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.filler} text-[8px] px-1 py-0`}>filler</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.hedging} text-[8px] px-1 py-0`}>hedging</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className={`${SPEECH_HIGHLIGHT_CLASS.acknowledgment} text-[8px] px-1 py-0`}>okay/yeah</span>
          </span>
        </div>
        <p className="mt-2 text-[9px] leading-snug text-muted-foreground/80">
          Fillers = um/uh/discourse-like. Okay/yeah = acknowledgments (softer signal). Vocabulary = distinct words ÷ total.
        </p>
        {metrics.coaching_tip && (
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground border-t pt-2">
            {metrics.coaching_tip}
          </p>
        )}
      </div>
    </>
  ) : null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          toggle()
        }}
        className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-blue-100/90 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        aria-label="View turn metrics"
        aria-expanded={open}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  )
}

// One persisted/streaming message → one chat bubble. Partial updates share the same id
// via upsertStreamingMessage; stitched user turns use user_turn_{n} ids from the agent.
const USER_STITCH_GAP_MS = 90_000

function parseMessageTimestamp(ts: string | undefined): number {
  if (!ts) return 0
  const n = Date.parse(ts)
  return Number.isNaN(n) ? 0 : n
}

interface ChatGroup {
  id: string
  role: string
  content: string
  timestamp: string
  count: number
}

function groupConsecutive(messages: ChatMessage[]): ChatGroup[] {
  const groups: ChatGroup[] = []

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const content =
      m.role === 'assistant' ? stripThinkingBlocks(m.content) : m.content
    if (!content) continue

    const last = groups[groups.length - 1]
    const sameStream = last && last.role === m.role && m.id && last.id === m.id
    const userTimeStitch =
      last &&
      last.role === 'user' &&
      m.role === 'user' &&
      !m.id?.startsWith('user_turn_') &&
      parseMessageTimestamp(m.timestamp) - parseMessageTimestamp(last.timestamp) <=
        USER_STITCH_GAP_MS

    if (sameStream) {
      last.content = content
      last.timestamp = m.timestamp || last.timestamp
    } else if (userTimeStitch) {
      last.content = `${last.content} ${content}`.replace(/\s+/g, ' ').trim()
      last.timestamp = m.timestamp || last.timestamp
      last.count += 1
    } else {
      groups.push({
        id: m.id || `g-${i}`,
        role: m.role,
        content,
        timestamp: m.timestamp,
        count: 1,
      })
    }
  }
  return groups
}

function ChatPanel({
  messages,
  turnMetricsByIndex = {},
  turnTextByIndex = {},
  turnMetricsByText = {},
  liveMetrics = null,
  showLiveMetrics = false,
  transcriptHidden = false,
  collapsible = false,
  defaultCollapsed = false,
}: {
  messages: ChatMessage[]
  turnMetricsByIndex?: Record<number, TurnMetrics>
  turnTextByIndex?: Record<number, string>
  turnMetricsByText?: Record<string, TurnMetrics>
  liveMetrics?: import('@/hooks/useSessionMetrics').LiveMetricsSnapshot | null
  showLiveMetrics?: boolean
  transcriptHidden?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed)
  // Render strictly in chronological (creation) order. Bubbles keep their
  // earliest timestamp, so a stitched user-turn final that arrives alongside the
  // coach reply can't push the user's turn below the response that answers it.
  const groups = useMemo(() => {
    const ordered = messages
      .map((m, i) => ({ m, i }))
      .sort((a, b) => {
        const dt = parseMessageTimestamp(a.m.timestamp) - parseMessageTimestamp(b.m.timestamp)
        return dt !== 0 ? dt : a.i - b.i
      })
      .map((x) => x.m)
    return groupConsecutive(ordered)
  }, [messages])
  const userTurnCount = useMemo(() => groups.filter((g) => g.role === 'user').length, [groups])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Format timestamp for display
  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp)
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true 
      })
    } catch {
      return ''
    }
  }

  return (
    <div className="mt-2 rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="border-b bg-muted/50 px-4 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <button
            type="button"
            onClick={() => collapsible && setCollapsed((c) => !c)}
            disabled={!collapsible}
            className={`flex shrink-0 items-center gap-2 text-left ${collapsible ? 'cursor-pointer' : 'cursor-default'}`}
            aria-expanded={!collapsed}
          >
            {collapsible &&
              (collapsed ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ))}
            <span>
              <span className="block text-sm font-semibold">Conversation</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {userTurnCount} {userTurnCount === 1 ? 'your turn' : 'your turns'}
                {groups.length !== userTurnCount && (
                  <span className="ml-1 opacity-70">· {groups.length} messages</span>
                )}
                {collapsible && collapsed && <span className="ml-1 opacity-70">· click to expand</span>}
              </span>
            </span>
          </button>
          {showLiveMetrics && (
            <RealTimeMetrics
              metrics={liveMetrics}
              isVisible
              variant="inline"
              userTurnCount={userTurnCount}
            />
          )}
        </div>
      </div>
      
      {/* Messages Container */}
      <div
        className={`p-4 space-y-3 max-h-[32rem] min-h-[12rem] overflow-y-auto overflow-x-hidden bg-gradient-to-b from-background to-muted/10 ${
          collapsed ? 'hidden' : ''
        }`}
      >
        {transcriptHidden ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center px-4">
              <div className="text-sm text-muted-foreground">Transcript hidden</div>
              <div className="text-xs text-muted-foreground/60 mt-1">
                Conversation text is not available for your account. Metrics and coaching feedback remain visible.
              </div>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">No messages yet</div>
              <div className="text-xs text-muted-foreground/60 mt-1">Start speaking to begin the conversation</div>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              let userTurnIdx = 0
              // Sub-turn metrics in commit order, with their committed text, so a
              // stitched bubble can aggregate every sub-turn it spans.
              const orderedTurnMetrics = Object.keys(turnMetricsByIndex)
                .map(Number)
                .sort((a, b) => a - b)
                .map((idx) => ({ idx, text: turnTextByIndex[idx] || '', metrics: turnMetricsByIndex[idx] }))
              const consumedTurnMetrics = new Set<number>()
              return groups.map((g, i) => {
              let turnMetrics: TurnMetrics | undefined
              if (g.role === 'user') {
                userTurnIdx++
                const parts = collectTurnMetricsForBubble(g.content, orderedTurnMetrics, consumedTurnMetrics)
                turnMetrics = parts.length
                  ? aggregateTurnMetrics(parts, g.content)
                  : (turnMetricsByIndex[userTurnIdx] ?? lookupTurnMetrics(g.content, turnMetricsByText))
              }
              return (
              <div 
                key={g.id || i} 
                className={`flex ${g.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                <div className={`flex flex-col max-w-[80%] ${g.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div 
                    className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                      g.role === 'user' 
                        ? 'bg-blue-500 text-white rounded-tr-sm' 
                        : 'bg-gray-100 text-gray-900 rounded-tl-sm border border-gray-200'
                    }`}
                  >
                    {g.role === 'user' ? (
                      turnMetrics ? (
                        <UserTurnBubble content={g.content} metrics={turnMetrics} />
                      ) : (
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                          {g.content}
                        </p>
                      )
                    ) : (
                      <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                        {g.content}
                      </p>
                    )}
                  </div>
                  
                  <div className="text-[10px] mt-1 px-1 text-muted-foreground">
                    {formatTime(g.timestamp)}
                  </div>
                </div>
              </div>
            )})})()}
            {/* Invisible div for auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  )
}


