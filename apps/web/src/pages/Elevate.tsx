import { stripThinkingBlocks } from '@/lib/stripThinking'
import { useLiveSession } from '@/features/live-session/useLiveSession'
import { elevateAdapter } from '@/features/live-session/adapters/elevate'
import { prepareAdapter } from '@/features/live-session/adapters/prepare'
import type { LaunchConfig } from '@/features/live-session/types'
import { liveSessionApi } from '@/features/live-session/browser'
import { LiveSessionRoom } from '@/features/live-session/components/LiveSessionRoom'
import type { ChatMessage } from '@/features/live-session/types'
import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RealTimeMetrics } from '@/components/analytics/RealTimeMetrics'
import { SessionMetrics } from '@/components/analytics/SessionMetrics'
import { SessionMetricsSummary } from '@/components/analytics/SessionMetricsSummary'
import { AdvancedInsights, CONTENT_VERDICTS, DELIVERY_VERDICTS } from '@/components/analytics/AdvancedInsights'
import { SkillScoresCard } from '@/components/analytics/SkillScoresCard'
import { CoachingInsightsCard } from '@/components/analytics/CoachingInsightsCard'
import { SnapshotReveal } from '@/components/elevate/SnapshotReveal'
import { PaceTrendCard, type PacePoint } from '@/components/analytics/PaceTrend'
import { SessionReplay } from '@/pages/SessionReplay'
import { useRealTimeMetrics, useSessionMetrics, useSessionTurns } from '@/hooks/useSessionMetrics'
import { useConversationPersistence } from '@/hooks/useConversationPersistence'
import { SessionStatusBar } from '@/components/layout/AgentVisualizer'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { shouldReturnToElevateList } from '@/lib/elevateNavigation'
import { logEvent } from '@/lib/remoteLogger'
import { FOCUS_AREAS, PRACTICE_FOCUS_AREAS, getFocusAreaLabel, EXERCISE_PREVIEWS } from '@/lib/focus-areas'
import { pulseSkillLabel } from '@/lib/pulse-skills'
import { useAuth } from '@/hooks/useAuth'
import { AutoCompleteNotice, RetainCheckbox } from '@/components/session/SessionRetain'
import { applyRetainResult } from '@/lib/sessionRetain'
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext'
import { useUserExportFlags } from '@/hooks/useUserExportFlags'
import { useConfirm } from '@/hooks/useConfirm'
import { Trash2, CheckSquare, Square, Target, ArrowRight, Play, ChevronDown, ChevronUp, BarChart3, CheckCircle2, Download, Loader2, Bug, TrendingUp } from 'lucide-react'
import { generateSessionPdf, type SessionReport } from '@/lib/generate-session-pdf'
import { type SessionRecorderHandle } from '@/components/session/SessionRecorder'
import {
  UserTurnBubble,
  normalizeTurnMetricsFromApi,
  type TurnMetrics,
} from '@/components/session/UserTurnMetrics'
import type { SessionTurnRecord } from '@/hooks/useSessionMetrics'
import { AutomaticDeliveryStatus } from '@/components/analytics/AutomaticDeliveryStatus'
import { getPreparation } from '@/lib/prepare-api'
import { COACH_BUBBLE, USER_BUBBLE } from '@/lib/conversation'
import { isUsableProsody } from '@/lib/prosody'
import { buildExperimentalMeasurementsSection } from '@/lib/pdfDeliveryMeasurements'
import { hasAvailablePace, paceTrendTurns } from '@/lib/pace'
import { markCoachHomeResultSeen, recordCoachAction } from '@/lib/coach-api'
import { formatSessionOwner, matchesSessionOwner, type SessionOwner } from '@/lib/adminUserFilter'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'
interface PaceTurn {
  role?: string
  metrics?: {
    wpm?: number | null
    word_count?: number | null
    pace_source?: string | null
  }
}

interface ProgressPulseItem {
  skill: string
  currentScore: number
  delta?: number | null
}

export function Elevate() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, isAdmin, updateUser } = useAuth()
  const exportFlags = useUserExportFlags()
  const confirmDialog = useConfirm()
  const viewSessionId = searchParams.get('session')
  const inboundFocus = searchParams.get('focus') || ''
  const inboundContext = searchParams.get('context') ? decodeURIComponent(searchParams.get('context')!) : ''
  const inboundNewSession = searchParams.get('newSession') === 'true'
  const launchedFromCoach = searchParams.get('coach') === '1'
  const originCoachThreadId = searchParams.get('thread')
  const inboundPreparationId = searchParams.get('preparationId')
  const inboundStageId = searchParams.get('stageId')
  const inboundSnapshotRequest =
    searchParams.get('demo') === '1' ||
    searchParams.get('booth') === '1' ||
    inboundFocus === 'snapshot'
  const inboundFullReport = searchParams.get('full') === '1'
  const { isAccessible } = useFeatureFlags()
  const quickTryOn = isAccessible('quick_try')
  const inboundBoothDemo = quickTryOn && inboundSnapshotRequest
  const coachLaunchRecorded = useRef(false)
  
  const [elevateSessionName, setElevateSessionName] = useState(
    inboundContext && inboundFocus !== 'snapshot'
      ? `Practice: ${inboundContext.slice(0, 60)}`
      : ''
  )
  const [focusArea, setFocusArea] = useState(
    inboundFocus && inboundFocus !== 'snapshot' ? inboundFocus : ''
  )
  const recorderRef = useRef<SessionRecorderHandle>(null)
  const [isCompletedSessionView, setIsCompletedSessionView] = useState(false)
  const [loadingViewedSession, setLoadingViewedSession] = useState(Boolean(viewSessionId))
  const [pulseBusy, setPulseBusy] = useState(false)
  const [viewSessionName, setViewSessionName] = useState<string | null>(null)
  const [viewSessionPulse, setViewSessionPulse] = useState<string | null>(null)
  const [viewFocusArea, setViewFocusArea] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(viewSessionId) // Initialize with URL param if present
  const [showMetrics, setShowMetrics] = useState(true)
  const [turnMetricsByIndex, setTurnMetricsByIndex] = useState<Record<number, TurnMetrics>>({})
  const [turnTextByIndex, setTurnTextByIndex] = useState<Record<number, string>>({})
  const [turnMetricsByText, setTurnMetricsByText] = useState<Record<string, TurnMetrics>>({})
  const [showHistory, setShowHistory] = useState(!viewSessionId && !inboundNewSession)
  const [prepareLaunch, setPrepareLaunch] = useState<{
    preparationId: string
    stageId: string | null
    journeyTitle: string
    stageName: string | null
  } | null>(null)
  const [prepareLaunchLoading, setPrepareLaunchLoading] = useState(Boolean(inboundPreparationId))
  const [prepareLaunchError, setPrepareLaunchError] = useState<string | null>(null)

  const live = useLiveSession({
    resetMetrics: () => resetMetrics(), clearMessages: () => clearMessages(), hideHistory: () => setShowHistory(false),
    sessionChanged: id => setSessionId(id), toast: (kind, message) => toast[kind](message), log: logEvent,
    messages: () => messagesRef.current, addMessage: (...args) => addMessage(...args),
    upsertStreamingMessage: (...args) => upsertStreamingMessage(...args), rewardPoints: points => updateUser({ rewardPoints: points }),
    clearActiveSession: () => {
      localStorage.removeItem('spashtai_active_session')
      localStorage.removeItem('spashtai_session_timestamp')
    },
    left: (id, track) => onSessionLeft(id, track), discarded: id => onDiscarded(id), discardFinished: () => onDiscardFinished(),
  }, sessionId)
  const { roomName, token, url, isJoining, isLeaving, segmentId, isPausing, pauseAudioFailure, isResuming,
    assistantState, isSessionPaused, pauseReason, setAssistantState, idleWarning, resetIdleTimer } = live

  useEffect(() => {
    const targetId = viewSessionId || sessionId
    if (
      !launchedFromCoach ||
      !originCoachThreadId ||
      !targetId ||
      coachLaunchRecorded.current
    ) {
      return
    }
    coachLaunchRecorded.current = true
    void recordCoachAction(originCoachThreadId, {
      module: 'elevate',
      action: 'launch',
      targetId,
    }).catch(() => undefined)
  }, [launchedFromCoach, originCoachThreadId, sessionId, viewSessionId])

  useEffect(() => {
    if (!inboundPreparationId) {
      setPrepareLaunch(null)
      setPrepareLaunchLoading(false)
      setPrepareLaunchError(null)
      return
    }

    let cancelled = false
    setPrepareLaunchLoading(true)
    getPreparation(inboundPreparationId)
      .then((journey) => {
        if (cancelled) return
        const stage = inboundStageId
          ? journey.stages.find((candidate) => candidate.id === inboundStageId)
          : null
        if (inboundStageId && !stage) {
          throw new Error('The selected interview round is no longer available')
        }
        setPrepareLaunch({
          preparationId: journey.id,
          stageId: stage?.id ?? null,
          journeyTitle: journey.title,
          stageName: stage?.name ?? null,
        })
        setPrepareLaunchError(null)
        setFocusArea((current) => current || 'interview_practice')
        setElevateSessionName((current) =>
          current.trim()
            ? current
            : `Interview practice — ${journey.interview.roleTitle}`,
        )
      })
      .catch((error) => {
        if (cancelled) return
        setPrepareLaunch(null)
        setPrepareLaunchError(
          error instanceof Error ? error.message : 'Could not load interview journey',
        )
      })
      .finally(() => {
        if (!cancelled) setPrepareLaunchLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [inboundPreparationId, inboundStageId])

  useEffect(() => {
    if (viewSessionId || sessionId) return
    if (inboundSnapshotRequest && quickTryOn) {
      setFocusArea('snapshot')
      setElevateSessionName((current) => current || 'Communication Snapshot')
    } else if (inboundSnapshotRequest && !quickTryOn) {
      setFocusArea((current) => (current === 'snapshot' ? '' : current))
      setElevateSessionName((current) =>
        current === 'Communication Snapshot' ? '' : current,
      )
    }
  }, [inboundSnapshotRequest, quickTryOn, viewSessionId, sessionId])

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
    retainedAt?: string | null
    userId?: string
    user?: SessionOwner | null
  }
  const [pastSessions, setPastSessions] = useState<ElevateSessionItem[]>([])
  const [pendingDeletions, setPendingDeletions] = useState<Array<{
    id: string
    sessionName?: string | null
    deletionStatus?: string | null
  }>>([])
  const [pastLoading, setPastLoading] = useState(true)
  const [elevSearch, setElevSearch] = useState('')
  const [elevUserSearch, setElevUserSearch] = useState('')
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
          s.module.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q)
      )
    }
    if (elevStatusFilter !== 'all') {
      result = result.filter((s) =>
        elevStatusFilter === 'completed' ? s.endedAt != null : s.endedAt == null
      )
    }
    if (isAdmin && elevUserSearch) {
      result = result.filter((session) => matchesSessionOwner(session.user, elevUserSearch))
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
  }, [pastSessions, elevSearch, elevUserSearch, elevSortField, elevSortDir, elevStatusFilter, isAdmin])

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
      const response = await fetch(`${API_BASE_URL}/sessions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      if (!response.ok) throw new Error(`Discard failed with HTTP ${response.status}`)
      const deleted = pastSessions.find((session) => session.id === id)
      setPastSessions((prev) => prev.filter((s) => s.id !== id))
      setPendingDeletions((prev) => [
        {
          id,
          sessionName: deleted?.sessionName || 'Elevate session',
          deletionStatus: 'pending',
        },
        ...prev.filter((item) => item.id !== id),
      ])
      setSelectedElevate((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Discarding session securely')
    } catch {
      toast.error('Failed to delete session')
    }
  }, [confirmDialog, pastSessions])

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
      const responses = await Promise.all(
        Array.from(selectedElevate).map((id) =>
          fetch(`${API_BASE_URL}/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
        )
      )
      if (responses.some((response) => !response.ok)) {
        throw new Error('One or more discard requests failed')
      }
      const deleting = pastSessions.filter((session) => selectedElevate.has(session.id))
      setPastSessions((prev) => prev.filter((s) => !selectedElevate.has(s.id)))
      setPendingDeletions((prev) => [
        ...deleting.map((session) => ({
          id: session.id,
          sessionName: session.sessionName || 'Elevate session',
          deletionStatus: 'pending',
        })),
        ...prev.filter((item) => !selectedElevate.has(item.id)),
      ])
      setSelectedElevate(new Set())
      toast.success('Discarding sessions securely')
    } catch {
      toast.error('Failed to delete some sessions')
    }
  }, [selectedElevate, confirmDialog, pastSessions])

  const loadPastSessions = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    try {
      if (!silent) setPastLoading(true)
      const res = await fetch(`${API_BASE_URL}/sessions`, { headers: getAuthHeaders() })
      if (res.ok) {
        const data = await res.json()
        setPastSessions(data.sessions || [])
        setPendingDeletions(data.deletions || [])
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
  const completedPacePoints = useMemo<PacePoint[]>(
    () =>
      paceTrendTurns(
        completedTurns,
        hasAvailablePace(historicalMetrics?.processingStatus),
      ).map((t, index) => ({ label: index + 1, wpm: Math.round(Number(t.metrics?.wpm)) })),
    [completedTurns, historicalMetrics?.processingStatus],
  )
  
  const [elevatePdfLoading, setElevatePdfLoading] = useState(false)
  // Results view: which tab is showing, plus a one-shot request to deep-link the
  // Playback tab to the moment behind a skill score ("Hear it").
  const [resultsTab, setResultsTab] = useState('playback')
  const [playbackAutoPlayNonce, setPlaybackAutoPlayNonce] = useState<number | null>(null)
  const playbackNonceRef = useRef(0)
  const hearSkillMoment = () => {
    setResultsTab('playback')
    setPlaybackAutoPlayNonce(++playbackNonceRef.current)
  }
  const openPlayback = () => {
    setPlaybackAutoPlayNonce(null)
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
      const [scoresRes, coachingRes, signalsRes, turnsRes, advancedRes] = await Promise.all([
        fetch(`${API_BASE_URL}/sessions/${sessionId}/skill-scores`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/coaching-insights`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/communication-signals`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, { headers }).catch(() => null),
        fetch(`${API_BASE_URL}/sessions/${sessionId}/advanced-metrics`, { headers }).catch(() => null),
      ])

      const skill = scoresRes && scoresRes.ok ? await scoresRes.json() : null
      const coaching = coachingRes && coachingRes.ok ? await coachingRes.json() : null
      const signals = signalsRes && signalsRes.ok ? await signalsRes.json() : null
      const turnsData = turnsRes && turnsRes.ok ? await turnsRes.json() : null
      const advanced = advancedRes && advancedRes.ok ? await advancedRes.json().catch(() => null) : null

      const scores: Record<string, number | null> = skill?.scores ?? {}
      const overallScore =
        typeof skill?.overallScore === 'number' && Number.isFinite(skill.overallScore)
          ? skill.overallScore
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
      const paceAvailable = hasAvailablePace(m.processingStatus)

      const metricSections: SessionReport['metrics'] = [
        {
          section: 'Speaking Performance',
          description: 'Your headline pace, fillers and fluency for this session',
          items: [
            {
              label: 'Words Per Minute',
              value: paceAvailable ? String(Math.round(m.userWpm)) : 'Not available',
              unit: paceAvailable ? 'WPM' : undefined,
              tone: paceAvailable ? DELIVERY_VERDICTS.speechRate(m.userWpm).tone : undefined,
              hint: paceAvailable
                ? DELIVERY_VERDICTS.speechRate(m.userWpm).tip
                : 'Reliable speech-time evidence was not available, so pace was not scored.',
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
            {
              label: 'Speaking Time',
              value: paceAvailable ? m.userSpeakingTime.toFixed(0) : 'Not available',
              unit: paceAvailable ? 's' : undefined,
            },
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

      if (isUsableProsody(prosody)) {
        const measurements = buildExperimentalMeasurementsSection({
          prosody,
          alignedDelivery: advanced?.delivery_metrics ?? null,
        })
        if (measurements) metricSections.push(measurements)
      }

      // Pace variation chart points — one WPM per qualified user turn, in order.
      const paceTurns: PaceTurn[] = Array.isArray(turnsData?.turns) ? turnsData.turns : []
      const pacePoints = paceTrendTurns(paceTurns, paceAvailable).map((t, index) => ({
        label: index + 1,
        wpm: Math.round(Number(t.metrics?.wpm)),
      }))

      // Progress Pulse (cross-session trends), without the "Practice in Elevate" CTA.
      let progressPulse: SessionReport['progressPulse'] = null
      try {
        const pulseRes = await fetch(`${API_BASE_URL}/api/progress-pulse/summary`, { headers })
        if (pulseRes.ok) {
          const pulseData = await pulseRes.json()
          const items: ProgressPulseItem[] = Array.isArray(pulseData?.summary) ? pulseData.summary : []
          if (items.length) {
            progressPulse = items.map((it) => ({
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
                paceNote: coaching.paceNote,
              }
            : null,
        metrics: metricSections,
        paceTrend:
          paceAvailable && pacePoints.length >= 2
            ? {
                points: pacePoints,
                canonicalWpm: m.userWpm,
                idealMin: 120,
                idealMax: 160,
              }
            : null,
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
    loadConversation,
    addMessage,
    upsertStreamingMessage,
    clearMessages
  } = useConversationPersistence()

  const messagesRef = useRef(messages)
  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const handleNewMessage = useCallback((message: { id?: string; role: string; content: string; partial?: boolean }) => {
    live.controller.handleMessage(message)
  }, [live.controller])

  const handleConversationRestart = useCallback(() => {
    clearMessages()
    resetMetrics()
    setTurnMetricsByIndex({})
    setTurnTextByIndex({})
    setTurnMetricsByText({})
  }, [clearMessages, resetMetrics])

  // Check if URL parameter session is completed (for "View Details & Metrics" button)
  useEffect(() => {
    if (!viewSessionId) {
      setLoadingViewedSession(false)
      return
    }
    let cancelled = false
    const controller = new AbortController()
    setLoadingViewedSession(true)
    setIsCompletedSessionView(false)
    ;(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${viewSessionId}`, {
          headers: getAuthHeaders(),
          signal: controller.signal,
        })
        if (cancelled) return
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
        if (cancelled) return
        const session = data.session || data
        setViewSessionName(session.sessionName || null)
        setViewSessionPulse(session.progressPulseStatus || null)
        setViewFocusArea(session.focusArea || null)
        if (session.focusArea) setFocusArea(session.focusArea)
        if (session.sessionName) setElevateSessionName(session.sessionName)
        if (!inboundPreparationId && session.preparationPractice) {
          setPrepareLaunch({
            preparationId: session.preparationPractice.preparationId,
            stageId: session.preparationPractice.stageId,
            journeyTitle: session.preparationPractice.preparation.title,
            stageName: session.preparationPractice.stage?.name ?? null,
          })
          // Repair old/shared direct links so the app shell, breadcrumb, and
          // every subsequent navigation keep the activity in its journey.
          const params = new URLSearchParams(searchParams)
          params.set('session', viewSessionId)
          params.set('preparationId', session.preparationPractice.preparationId)
          if (session.preparationPractice.stageId) {
            params.set('stageId', session.preparationPractice.stageId)
          }
          navigate(`/elevate?${params.toString()}`, { replace: true })
        }

        if (session.endedAt || (session.userId && user?.id && session.userId !== user.id)) {
          // Admins viewing another user's session never join its live room.
          console.log('📊 Viewing completed session:', viewSessionId)
          void markCoachHomeResultSeen('elevate', viewSessionId).catch((error) =>
            console.warn('mark Coach Home Elevate result seen', error),
          )
          setIsCompletedSessionView(true)
          setSessionId(viewSessionId)
          await loadConversation(viewSessionId)
          if (cancelled) return
        } else {
          // In-progress session — resume directly by connecting to LiveKit
          console.log('📖 Resuming in-progress session:', viewSessionId)
          setIsCompletedSessionView(false)
          setSessionId(viewSessionId)
          await loadConversation(viewSessionId)

          await live.controller.resume(viewSessionId, controller.signal, true)
          if (cancelled) return
          localStorage.setItem('spashtai_active_session', viewSessionId)
          localStorage.setItem('spashtai_session_timestamp', Date.now().toString())
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        console.error('Error checking/resuming session:', error)
      } finally {
        if (!cancelled) setLoadingViewedSession(false)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [
    viewSessionId,
    live.controller,
    inboundBoothDemo,
    inboundPreparationId,
    navigate,
    loadConversation,
    resetMetrics,
    searchParams,
    user?.id,
  ])

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
  const previousViewSessionId = useRef(viewSessionId)
  const pendingListReturn = useRef(false)
  if (previousViewSessionId.current !== viewSessionId) {
    const returningToList = shouldReturnToElevateList({
      previousSessionId: previousViewSessionId.current,
      nextSessionId: viewSessionId,
      hasLiveConnection: joined,
      paused: isSessionPaused,
      joining: isJoining,
      leaving: isLeaving,
    })
    previousViewSessionId.current = viewSessionId
    if (returningToList) {
      pendingListReturn.current = true
      setSessionId(null)
      setIsCompletedSessionView(false)
      setViewSessionName(null)
      setViewSessionPulse(null)
      setViewFocusArea(null)
      setShowHistory(true)
    }
  }
  useEffect(() => {
    if (!pendingListReturn.current) return
    pendingListReturn.current = false
    clearMessages()
    resetMetrics()
  }, [viewSessionId, clearMessages, resetMetrics])

  const resumeLiveSession = useCallback(async (id: string) => { await live.controller.resume(id) }, [live.controller])
  const handlePause = useCallback(async () => { await live.controller.pause(recorderRef.current) }, [live.controller])
  const retryPauseUpload = useCallback(async () => { await live.controller.retryPauseUpload(recorderRef.current) }, [live.controller])
  const pauseWithoutReplayAudio = useCallback(async () => { await live.controller.pauseWithoutReplayAudio() }, [live.controller])
  const continueInNewSegmentAfterPauseFailure = useCallback(async () => { await live.controller.continueInNewSegment() }, [live.controller])

  const launchConfig = useCallback((): LaunchConfig => ({
    sessionName: elevateSessionName, focusArea, focusContext: inboundContext,
    boothDemo: inboundBoothDemo,
    preparationId: prepareLaunch?.preparationId, stageId: prepareLaunch?.stageId,
    preparationPending: Boolean(inboundPreparationId && !prepareLaunch), preparationError: prepareLaunchError,
  }), [elevateSessionName, focusArea, inboundContext, inboundBoothDemo, prepareLaunch, inboundPreparationId, prepareLaunchError])
  const handleJoin = useCallback(async () => {
    const config = launchConfig()
    await live.controller.start(config, prepareLaunch ? prepareAdapter(liveSessionApi, config) : elevateAdapter(liveSessionApi, config))
  }, [launchConfig, live.controller, prepareLaunch])

  // Called when LiveKit disconnects unexpectedly (refresh, network drop, etc.)
  // Does NOT end the session — leaves it resumable.
  const handleDisconnected = useCallback(async () => {
    await live.controller.onDisconnected(recorderRef.current, { sessionId, segmentId })
  }, [live.controller, sessionId, segmentId])

  // Called only when user explicitly clicks "Leave".
  // Ends the session permanently.
  const onSessionLeft = (currentSessionId: string | null, trackIt: boolean) => {
    setPastSessions((prev) =>
      prev.map((s) =>
        s.id === currentSessionId
          ? {
              ...s,
              endedAt: new Date().toISOString(),
              progressPulseStatus: trackIt ? 'tracked' : null,
            }
          : s,
      )
    )

    // A session started this visit won't exist in the list that was loaded on
    // mount, so the optimistic map above can't add it — refetch to surface it.
    loadPastSessions({ silent: true })

    if (currentSessionId && launchedFromCoach) {
      const params = new URLSearchParams({
        elevateResult: currentSessionId,
      })
      if (originCoachThreadId) params.set('thread', originCoachThreadId)
      if (originCoachThreadId) {
        void recordCoachAction(originCoachThreadId, {
          module: 'elevate',
          action: 'complete',
          targetId: currentSessionId,
        }).catch(() => undefined)
      }
      navigate(`/coach?${params.toString()}`)
    } else if (currentSessionId) {
      setShowHistory(false)
      setResultsTab('playback')
      setPlaybackAutoPlayNonce(null)
      setIsCompletedSessionView(true)
      setViewSessionPulse(trackIt ? 'tracked' : null)
      setSessionId(currentSessionId)
      const resultParams = new URLSearchParams({ session: currentSessionId })
      if (prepareLaunch) {
        resultParams.set('preparationId', prepareLaunch.preparationId)
        if (prepareLaunch.stageId) resultParams.set('stageId', prepareLaunch.stageId)
      }
      navigate(`/elevate?${resultParams.toString()}`)
    } else {
      setShowHistory(true)
      navigate('/elevate')
    }
  }
  const activityAdapter = () => {
    const config = launchConfig()
    return prepareLaunch ? prepareAdapter(liveSessionApi, config) : elevateAdapter(liveSessionApi, config)
  }
  const handleLeave = async () => { await live.controller.leave(recorderRef.current, activityAdapter()) }

  // A Prepare attempt is removable until it has been completed. The server
  // enforces the same boundary using endedAt, so stale client state is safe.
  const canDiscardPreparePractice = !prepareLaunch || !isCompletedSessionView

  const onDiscarded = (currentSessionId: string) => {
        setPastSessions((prev) => prev.filter((s) => s.id !== currentSessionId))
        setPendingDeletions((prev) => [
          {
            id: currentSessionId,
            sessionName: viewSessionName || elevateSessionName || 'Elevate session',
            deletionStatus: 'pending',
          },
          ...prev.filter((item) => item.id !== currentSessionId),
        ])
        setSelectedElevate((prev) => { const n = new Set(prev); n.delete(currentSessionId); return n })
        toast.success(prepareLaunch
          ? 'Interview practice discarded.'
          : 'Discarding session securely. Cleanup will retry automatically.')
  }
  const onDiscardFinished = () => {
    if (prepareLaunch) {
      navigate(`/prepare/interviews/${encodeURIComponent(prepareLaunch.preparationId)}`)
    } else {
      setShowHistory(true)
      navigate('/elevate')
    }
  }
  const handleDiscard = async () => {
    if (isLeaving) return
    const yes = await confirmDialog({
      title: prepareLaunch ? 'Discard this interview practice?' : 'Discard this session?',
      description: prepareLaunch
        ? 'This in-progress practice will be removed completely. Completed practices remain on the interview journey.'
        : 'This will permanently delete the session and all its data. This cannot be undone.',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep session',
    })
    if (!yes) return

    await live.controller.discard(recorderRef.current, activityAdapter(), sessionId)
  }

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
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button className="w-full sm:w-auto shrink-0" onClick={() => setShowHistory(false)}>
              + New Elevate Session
            </Button>
          </div>
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

        {!pastLoading && pendingDeletions.length > 0 && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-start gap-3 py-4">
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" />
              <div>
                <p className="text-sm font-medium">Discarding—retrying cleanup</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingDeletions.length === 1
                    ? `${pendingDeletions[0].sessionName || 'Your session'} is permanently unavailable while its recordings are removed.`
                    : `${pendingDeletions.length} sessions are permanently unavailable while their recordings are removed.`}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {!pastLoading && pastSessions.length > 0 && (
          <SessionFilters
            search={elevSearch}
            onSearchChange={setElevSearch}
            searchPlaceholder={isAdmin ? 'Search by session name or ID...' : undefined}
            userSearch={isAdmin ? elevUserSearch : undefined}
            onUserSearchChange={isAdmin ? setElevUserSearch : undefined}
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

        {!pastLoading && (
          <AutoCompleteNotice
            scope="elevate"
            count={pastSessions.filter((s) => !s.endedAt && (!s.user?.id || s.user.id === user?.id)).length}
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
              const ownSession = !s.user?.id || s.user.id === user?.id
              return (
                <Card key={s.id} className={`transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                  <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center py-4">
                    <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                      <button
                        onClick={() =>
                          setSelectedElevate((prev) => {
                            const n = new Set(prev)
                            if (n.has(s.id)) n.delete(s.id)
                            else n.add(s.id)
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
                            <span title="Tracked in Progress Pulse" className="inline-flex text-green-600">
                              <CheckCircle2 className="h-4 w-4" aria-label="Tracked in Progress Pulse" />
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          {isAdmin && <span>{formatSessionOwner(s.user)}</span>}
                          <span>{formatRelDate(s.startedAt)}</span>
                          {done && s.durationSec != null && <span>{fmtDur(s.durationSec)}</span>}
                          {s.words != null && <span>{s.words} words</span>}
                          {s.fillerRate != null && <span>{s.fillerRate.toFixed(1)}% fillers</span>}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                      {!done && ownSession && (
                        <RetainCheckbox
                          sessionId={s.id}
                          retained={Boolean(s.retainedAt)}
                          onChange={(result) => setPastSessions((prev) => applyRetainResult(prev, result))}
                        />
                      )}
                      {!done && isAdmin && !ownSession ? (
                        <Button size="sm" variant="outline" disabled title="Another user's live session can't be resumed">
                          In progress
                        </Button>
                      ) : (
                        <Link to={`/elevate?session=${s.id}`}>
                          <Button size="sm" variant="outline">
                            {done ? 'View Results' : 'Resume'}
                          </Button>
                        </Link>
                      )}
                      <Link
                        to={`/feedback/new?module=elevate&session=${encodeURIComponent(s.id)}`}
                        title="Report an issue with this session"
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-primary"
                        >
                          <Bug className="h-4 w-4" />
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

  const applyPulseStatus = (status: string | null) => {
    if (!viewSessionId) return
    setViewSessionPulse(status)
    setPastSessions((prev) =>
      prev.map((session) =>
        session.id === viewSessionId ? { ...session, progressPulseStatus: status } : session,
      ),
    )
  }

  const handleUntrackPulse = async () => {
    if (!viewSessionId || pulseBusy) return
    setPulseBusy(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/progress-pulse/skip`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sessionId: viewSessionId, source: 'elevate' }),
      })
      if (!response.ok) throw new Error('Unable to remove from Progress Pulse')
      applyPulseStatus('skipped')
      toast.info('Removed from Progress Pulse')
    } catch {
      toast.error('Failed to update Progress Pulse')
    } finally {
      setPulseBusy(false)
    }
  }

  const handleTrackPulse = async () => {
    if (!viewSessionId || pulseBusy) return
    setPulseBusy(true)
    try {
      const response = await fetch(`${API_BASE_URL}/api/progress-pulse/track`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ sessionId: viewSessionId }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Unable to track this session')
      }
      applyPulseStatus('tracked')
      toast.success('Session tracked in Progress Pulse')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to track session')
    } finally {
      setPulseBusy(false)
    }
  }

  return (
    <div className="grid gap-6">
      {/* Back navigation */}
      {!joined && prepareLaunch ? (
        <Link
          to={`/prepare/interviews/${encodeURIComponent(prepareLaunch.preparationId)}`}
          className="text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          &larr; Back to {prepareLaunch.journeyTitle}
        </Link>
      ) : !joined && prepareLaunchError && inboundPreparationId ? (
        <Link
          to="/prepare/interviews"
          className="text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          &larr; Back to interview journeys
        </Link>
      ) : !joined && viewSessionId && (
        <button
          onClick={handleBackToElevate}
          className="text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          &larr; Back to Elevate
        </button>
      )}
      {!joined && !inboundPreparationId && !viewSessionId && !showHistory && !sessionId && (
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
              {viewSessionId && viewSessionName
                ? viewSessionName
                : prepareLaunch
                  ? elevateSessionName.trim() || 'Interview practice'
                  : elevateSessionName.trim()
                    ? `Elevate — ${elevateSessionName.trim()}`
                    : focusArea
                      ? `Elevate — Practice: ${getFocusAreaLabel(focusArea)}`
                      : 'Elevate — Practice'}
            </CardTitle>
            {viewSessionId && isCompletedSessionView && viewFocusArea !== 'snapshot' && !prepareLaunch && (
              pulseBusy ? (
                <Button variant="outline" size="sm" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
                </Button>
              ) : viewSessionPulse === 'tracked' ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                  onClick={handleUntrackPulse}
                  title="Remove this session from Progress Pulse"
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Tracked in Pulse
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTrackPulse}
                  title="Track this session in Progress Pulse"
                >
                  <TrendingUp className="mr-2 h-4 w-4" /> Track in Pulse
                </Button>
              )
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLeaving ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving your session and preparing results…
            </div>
          ) : loadingViewedSession ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading session…
            </div>
          ) : !joined && !viewSessionId && !sessionId ? (
            <div className="grid gap-3">
              {prepareLaunchLoading && (
                <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading interview journey…
                </div>
              )}
              {prepareLaunchError && (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {prepareLaunchError}
                </div>
              )}
              {prepareLaunch && (
                <div className="rounded-md border bg-primary/5 px-3 py-2">
                  <p className="text-sm font-medium">
                    {elevateSessionName.trim() || 'Interview practice'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {prepareLaunch.stageName
                      ? `${prepareLaunch.stageName} round · `
                      : ''}
                    Your saved JD, profile, interviewer context, and actual questions are
                    loaded securely after the session starts.
                  </p>
                </div>
              )}
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
                {prepareLaunch ? (
                  <>
                    <label className="text-sm font-medium">Practice type</label>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Guided interview practice using this journey’s context. Your results stay on this journey.
                    </p>
                  </>
                ) : (
                  <>
                    <label className="text-sm font-medium">Focus Area</label>
                  <select
                    value={focusArea}
                    onChange={(e) => setFocusArea(e.target.value)}
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <option value="">General practice (no specific focus)</option>
                    {(quickTryOn ? FOCUS_AREAS : PRACTICE_FOCUS_AREAS).map((a) => (
                      <option key={a.id} value={a.id}>{a.label} — {a.description}</option>
                    ))}
                  </select>
                  </>
                )}
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
                  disabled={
                    isJoining ||
                    !elevateSessionName.trim() ||
                    prepareLaunchLoading ||
                    Boolean(prepareLaunchError)
                  }
                >
                  {isJoining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isJoining ? 'Starting…' : 'Start Session'}
                </Button>
              </div>
            </div>
          ) : !joined && viewSessionId && isCompletedSessionView && viewFocusArea === 'snapshot' && !inboundFullReport ? (
            <SnapshotReveal
              sessionId={viewSessionId}
              messages={messages}
              onSeeFull={() => {
                const params = new URLSearchParams(searchParams)
                params.set('session', viewSessionId)
                params.set('full', '1')
                params.delete('demo')
                params.delete('newSession')
                navigate(`/elevate?${params.toString()}`)
              }}
              onPlayClip={() => {
                setResultsTab('playback')
                const params = new URLSearchParams(searchParams)
                params.set('session', viewSessionId)
                params.set('full', '1')
                params.delete('demo')
                params.delete('newSession')
                navigate(`/elevate?${params.toString()}`)
              }}
            />
          ) : !joined && viewSessionId && isCompletedSessionView ? (
            <Tabs
              value={resultsTab}
              onValueChange={(v) => {
                // User-initiated tab change: drop any pending deep-link so it
                // doesn't replay when Playback re-mounts (unless switching TO playback).
                setResultsTab(v)
                if (v !== 'playback') {
                  setPlaybackAutoPlayNonce(null)
                }
              }}
              className="space-y-4"
            >
              {!prepareLaunch && <AutomaticDeliveryStatus sessionId={viewSessionId} />}
              {viewFocusArea === 'snapshot' && inboundFullReport && viewSessionId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 h-8 px-2 text-muted-foreground"
                  onClick={() => {
                    const params = new URLSearchParams(searchParams)
                    params.delete('full')
                    navigate(`/elevate?${params.toString()}`)
                  }}
                >
                  &larr; Back to snapshot
                </Button>
              )}
              <div className="flex w-full items-center gap-2">
                <TabsList className="inline-flex h-10 shrink-0 flex-nowrap items-center">
                  <TabsTrigger value="playback" className="h-9 py-1.5">
                    <Play className="mr-2 h-4 w-4" /> Playback
                  </TabsTrigger>
                  <TabsTrigger value="analytics" className="h-9 py-1.5">
                    <BarChart3 className="mr-2 h-4 w-4" /> {prepareLaunch ? 'Event feedback' : 'Session Analytics'}
                  </TabsTrigger>
                </TabsList>
                {resultsTab === 'analytics' && historicalMetrics && !prepareLaunch && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-9 shrink-0 px-2.5"
                    onClick={handleElevateExportPdf}
                    disabled={elevatePdfLoading}
                    title="Export PDF"
                  >
                    {elevatePdfLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    <span className="ml-1.5">PDF</span>
                  </Button>
                )}
              </div>

              <TabsContent value="analytics" className="space-y-4">
                {!prepareLaunch && sessionId && historicalMetrics && (
                  <SessionMetricsSummary
                    sessionId={sessionId}
                    metrics={historicalMetrics}
                    variant="card"
                    turns={completedTurns}
                  />
                )}
                {/* Conversation chat — collapsed by default to keep analytics front and center */}
                <ChatPanel
                  messages={messages}
                  turnMetricsByIndex={turnMetricsByIndex}
                  turnTextByIndex={turnTextByIndex}
                  turnMetricsByText={turnMetricsByText}
                  sessionTurns={completedTurns}
                  transcriptHidden={exportFlags.hideTranscriptText}
                  collapsible
                  defaultCollapsed
                />
                {prepareLaunch && sessionId && (
                  <CoachingInsightsCard sessionId={sessionId} isSessionEnded fill />
                )}

                {/* Historical metrics display */}
                {!prepareLaunch && sessionId && historicalMetrics && (
                  <>
                    <SessionMetrics
                      sessionId={sessionId}
                      metrics={historicalMetrics}
                      onDownloadTranscript={downloadTranscript}
                      onExportPdf={handleElevateExportPdf}
                      pdfLoading={elevatePdfLoading}
                      showExportPdf={false}
                      aside={<CoachingInsightsCard sessionId={sessionId} isSessionEnded fill />}
                    />

                    {/* Pace variation across turns */}
                    <div className="mt-6">
                      <PaceTrendCard
                        sessionId={sessionId}
                        isSessionEnded={true}
                        points={completedPacePoints}
                        paceAvailable={hasAvailablePace(historicalMetrics.processingStatus)}
                        canonicalWpm={historicalMetrics.userWpm}
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
                      <AdvancedInsights
                        sessionId={sessionId}
                        isSessionEnded={true}
                        onOpenPlayback={openPlayback}
                      />
                    </div>
                  </>
                )}
              </TabsContent>

              <TabsContent value="playback">
                <SessionReplay
                  sessionId={sessionId ?? viewSessionId ?? undefined}
                  embedded
                  autoPlayNonce={playbackAutoPlayNonce}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-4">
              {idleWarning && (
                <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>No mouse or keyboard activity for a while. The session stays connected — Mute for background noise, Pause if you are stepping away, or Leave when done.</span>
                  <Button size="sm" variant="outline" onClick={resetIdleTimer}>Dismiss</Button>
                </div>
              )}
              {!token && !url && sessionId && !isSessionPaused && (
                <div className="rounded-md border border-blue-400 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>Session disconnected. Your conversation is saved.</span>
                  <Button
                    size="sm"
                    disabled={isResuming}
                    onClick={() => {
                    if (!sessionId) return
                    resumeLiveSession(sessionId).catch((err) => {
                      console.error('Failed to resume session:', err)
                    })
                  }}>{isResuming ? 'Reconnecting…' : 'Resume Session'}</Button>
                </div>
              )}
              {!joined && isSessionPaused && (
                <>
                  <div className="flex justify-center w-full mb-2">
                    <SessionStatusBar
                      isPaused
                      label={pauseReason === 'intentional' ? 'Paused' : 'Disconnected'}
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
                      disabled={isResuming}
                      onClick={() => {
                        if (!sessionId) return
                        resumeLiveSession(sessionId).catch((err) => {
                          console.error('Failed to resume session:', err)
                        })
                      }}
                    >
                      {isResuming ? 'Reconnecting…' : 'Resume'}
                    </Button>
                    {exportFlags.enableAudioExport && (
                      <Button variant="outline" disabled title="Resume session to record audio">
                        Record My Audio
                      </Button>
                    )}
                    {canDiscardPreparePractice && (
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={handleDiscard} disabled={isLeaving}>
                        {prepareLaunch ? 'Discard interview practice' : 'Discard Session'}
                      </Button>
                    )}
                  </div>
                </>
              )}
              {url && token && (
                <LiveSessionRoom
                  token={token}
                  url={url}
                  sessionId={sessionId}
                  segmentId={segmentId}
                  roomName={roomName}
                  recorderRef={recorderRef}
                  isPausing={isPausing}
                  pauseAudioFailure={pauseAudioFailure}
                  isSessionPaused={isSessionPaused}
                  isLeaving={isLeaving}
                  assistantState={assistantState}
                  handleDisconnected={handleDisconnected}
                  handleNewMessage={handleNewMessage}
                  setAssistantState={setAssistantState}
                  handleConversationRestart={handleConversationRestart}
                  updateMetrics={updateMetrics}
                  handleLeave={handleLeave}
                  showMetrics={showMetrics}
                  setShowMetrics={setShowMetrics}
                  handlePause={handlePause}
                  exportFlags={exportFlags}
                  canDiscardPreparePractice={canDiscardPreparePractice}
                  isPrepare={!!prepareLaunch}
                  handleDiscard={handleDiscard}
                  retryPauseUpload={retryPauseUpload}
                  pauseWithoutReplayAudio={pauseWithoutReplayAudio}
                  continueInNewSegmentAfterPauseFailure={continueInNewSegmentAfterPauseFailure}
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
                />
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
              {!prepareLaunch && !joined && sessionId && historicalMetrics && !isSessionPaused && (
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
                    <PaceTrendCard
                      sessionId={sessionId}
                      isSessionEnded={!joined}
                      paceAvailable={hasAvailablePace(historicalMetrics.processingStatus)}
                      canonicalWpm={historicalMetrics.userWpm}
                    />
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

// Official LiveKit conversation component using built-in patterns
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
  sessionTurns = [],
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
  /** Persisted /turns records — powers the ⓘ popover on completed sessions. */
  sessionTurns?: SessionTurnRecord[]
  liveMetrics?: import('@/hooks/useSessionMetrics').LiveMetricsSnapshot | null
  showLiveMetrics?: boolean
  transcriptHidden?: boolean
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed)
  const metricsByText = useMemo(() => {
    const map = { ...turnMetricsByText }
    for (const t of sessionTurns) {
      if (t.role !== 'user' || !t.text) continue
      const metrics = normalizeTurnMetricsFromApi(t.metrics, t.text)
      if (metrics) map[normalizeTurnText(t.text)] = metrics
    }
    return map
  }, [turnMetricsByText, sessionTurns])
  const orderedSessionTurnMetrics = useMemo(
    () =>
      sessionTurns
        .filter((t) => t.role === 'user')
        .sort((a, b) => a.turnIndex - b.turnIndex)
        .map((t) => ({
          idx: t.turnIndex,
          text: t.text || '',
          metrics: normalizeTurnMetricsFromApi(t.metrics, t.text),
        }))
        .filter((e): e is { idx: number; text: string; metrics: TurnMetrics } => Boolean(e.metrics)),
    [sessionTurns],
  )
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
              const orderedTurnMetrics = [
                ...Object.keys(turnMetricsByIndex)
                  .map(Number)
                  .sort((a, b) => a - b)
                  .map((idx) => ({
                    idx,
                    text: turnTextByIndex[idx] || '',
                    metrics: turnMetricsByIndex[idx],
                  })),
                ...orderedSessionTurnMetrics,
              ].sort((a, b) => a.idx - b.idx)
              const consumedTurnMetrics = new Set<number>()
              return groups.map((g, i) => {
              let turnMetrics: TurnMetrics | undefined
              if (g.role === 'user') {
                userTurnIdx++
                const parts = collectTurnMetricsForBubble(g.content, orderedTurnMetrics, consumedTurnMetrics)
                turnMetrics = parts.length
                  ? aggregateTurnMetrics(parts, g.content)
                  : (turnMetricsByIndex[userTurnIdx] ?? lookupTurnMetrics(g.content, metricsByText))
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
                        ? `${USER_BUBBLE} rounded-tr-sm`
                        : `${COACH_BUBBLE} rounded-tl-sm`
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
