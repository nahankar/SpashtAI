import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { findSpeechSpans, SPEECH_HIGHLIGHT_CLASS } from '@/lib/speechPatterns'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useRoomContext,
  useVoiceAssistant,
  BarVisualizer
} from '@livekit/components-react'
import '@livekit/components-styles'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RoomEvent, Track } from 'livekit-client'
import { RealTimeMetrics } from '@/components/analytics/RealTimeMetrics'
import { SessionMetrics } from '@/components/analytics/SessionMetrics'
import { AdvancedInsights } from '@/components/analytics/AdvancedInsights'
import { SkillScoresCard } from '@/components/analytics/SkillScoresCard'
import { useRealTimeMetrics, useSessionMetrics } from '@/hooks/useSessionMetrics'
import { useAudioRecording } from '@/hooks/useAudioRecording'
import { useConversationPersistence } from '@/hooks/useConversationPersistence'
import { AgentVisualizer, SessionStatusBar } from '@/components/layout/AgentVisualizer'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { FOCUS_AREAS, getFocusAreaLabel } from '@/lib/focus-areas'
import { useAuth } from '@/hooks/useAuth'
import { useUserExportFlags } from '@/hooks/useUserExportFlags'
import { useConfirm } from '@/hooks/useConfirm'
import { Trash2, CheckSquare, Square, Target, ArrowRight, Info } from 'lucide-react'
import { generateSessionPdf, type SessionReport } from '@/lib/generate-session-pdf'

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
  const [sessionId, setSessionId] = useState<string | null>(viewSessionId) // Initialize with URL param if present
  const [showMetrics, setShowMetrics] = useState(false)
  const [turnMetricsByIndex, setTurnMetricsByIndex] = useState<Record<number, TurnMetrics>>({})
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

  useEffect(() => {
    async function loadPastSessions() {
      try {
        setPastLoading(true)
        const res = await fetch(`${API_BASE_URL}/sessions`, { headers: getAuthHeaders() })
        if (res.ok) {
          const data = await res.json()
          setPastSessions(data.sessions || [])
        }
      } catch { /* non-critical */ }
      finally { setPastLoading(false) }
    }
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
  }, [])
  
  // Real-time metrics for active session
  const { currentMetrics, updateMetrics, resetMetrics } = useRealTimeMetrics()
  
  // Historical metrics for completed sessions
  const { metrics: historicalMetrics, downloadTranscript } = useSessionMetrics(sessionId)
  
  const [elevatePdfLoading, setElevatePdfLoading] = useState(false)
  const handleElevateExportPdf = async () => {
    if (!sessionId || !historicalMetrics) return
    setElevatePdfLoading(true)
    try {
      const m = historicalMetrics
      const pdfReport: SessionReport = {
        title: `Elevate Practice — ${sessionId.slice(0, 8)}`,
        subtitle: 'Practice Session Analytics',
        source: 'elevate',
        metadata: [
          { label: 'Session', value: sessionId.slice(0, 8) },
          { label: 'Total Turns', value: String(m.totalTurns) },
        ],
        skillScores: null,
        coachingInsights: null,
        metrics: [
          {
            section: 'Your Performance',
            items: [
              { label: 'Words Per Minute', value: String(m.userWpm), unit: 'WPM' },
              { label: 'Filler Rate', value: `${m.userFillerRate.toFixed(1)}`, unit: '%' },
              { label: 'Avg Sentence Length', value: String(m.userAvgSentenceLength), unit: 'words' },
              { label: 'Vocab Diversity', value: `${(m.userVocabDiversity * 100).toFixed(0)}`, unit: '%' },
              { label: 'Speaking Time', value: `${m.userSpeakingTime.toFixed(0)}`, unit: 's' },
              { label: 'Avg Response Time', value: `${m.userResponseTimeAvg.toFixed(1)}`, unit: 's' },
            ],
          },
          {
            section: 'Session Stats',
            items: [
              { label: 'Total Turns', value: String(m.totalTurns) },
              { label: 'LLM Tokens', value: String(m.totalLlmTokens) },
              { label: 'Avg TTFT', value: `${m.avgTtft.toFixed(0)}`, unit: 'ms' },
            ],
          },
        ],
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

  // Check if URL parameter session is completed (for "View Details & Metrics" button)
  useEffect(() => {
    if (!viewSessionId) return
    setIsCompletedSessionView(false)
    ;(async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/sessions/${viewSessionId}`, {
          headers: getAuthHeaders(),
        })
        if (!response.ok) return
        const data = await response.json()
        const session = data.session || data

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
  }, [identity, roomName, resetMetrics])

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

    setShowHistory(true)
    navigate(cameFromHistory ? '/history?tab=elevate' : '/elevate')
  }, [sessionId, clearMessages, resetMetrics, navigate, cameFromHistory, confirmDialog, updateUser])

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
      {!joined && viewSessionId && cameFromHistory && (
        <Link to="/history?tab=elevate" className="text-sm text-muted-foreground hover:text-foreground w-fit">
          &larr; Back to Sessions
        </Link>
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
          <CardTitle>Elevate Session</CardTitle>
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
            <div className="space-y-4">
              {/* Viewing completed session - show chat and metrics */}
              <ChatPanel
                messages={messages}
                turnMetricsByIndex={turnMetricsByIndex}
                turnMetricsByText={turnMetricsByText}
                transcriptHidden={exportFlags.hideTranscriptText}
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
                  />
                  
                  {/* Skill Scores & Coaching Insights */}
                  <div className="mt-6">
                    <SkillScoresCard
                      sessionId={sessionId}
                      isSessionEnded={true}
                    />
                  </div>

                  {/* Legacy Advanced Analytics */}
                  <div className="mt-6">
                    <AdvancedInsights 
                      sessionId={sessionId}
                      isSessionEnded={true}
                    />
                  </div>
                </>
              )}
            </div>
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
                  <div className="flex justify-center w-full mb-2">
                    <AgentVisualizer className="bg-muted/20 rounded-lg w-full" isPaused={isSessionPaused} compact />
                  </div>
                  <ConnectionStatus assistantState={assistantState} />
                  <LiveKitConversation 
                    sessionId={sessionId}
                    isSessionPaused={isSessionPaused}
                    onNewMessage={(message) => {
                      if (isSessionPaused) {
                        console.log('⏸️ Dropping message while session is paused')
                        return
                      }
                      const content = message.content?.trim() || ''
                      if (!content || content === '[]' || content.length < 2) {
                        return
                      }

                      if (message.partial) {
                        const streamId = message.id || `stream_${message.role}`
                        upsertStreamingMessage(
                          message.role as 'user' | 'assistant',
                          content,
                          streamId,
                        )
                        return
                      }

                      const isDuplicate = messages.some(
                        (msg) =>
                          msg.role === message.role &&
                          msg.content === content &&
                          (msg.id === message.id || !message.partial),
                      )
                      if (isDuplicate) return

                      addMessage(
                        message.role as 'user' | 'assistant',
                        content,
                        message.id,
                      )
                    }}
                    onStateChange={setAssistantState}
                    onRestart={() => {
                      clearMessages()
                      resetMetrics()
                      setTurnMetricsByIndex({})
                      setTurnMetricsByText({})
                    }}
                    onTurnMetrics={(text, metrics, turnIndex) => {
                      if (turnIndex != null && turnIndex > 0) {
                        setTurnMetricsByIndex((prev) => ({ ...prev, [turnIndex]: metrics }))
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
                  />
                  
                  {/* Skill Scores & Coaching Insights */}
                  <div className="mt-6">
                    <SkillScoresCard
                      sessionId={sessionId}
                      isSessionEnded={!joined}
                    />
                  </div>

                  {/* Legacy Advanced Analytics */}
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

  // Stream coach speech via LiveKit agent transcriptions
  useEffect(() => {
    if (isSessionPaused || agentTranscriptions.length === 0) return
    const latest = agentTranscriptions[agentTranscriptions.length - 1]
    const text = latest.text?.trim()
    if (!text) return
    const streamId = latest.id || 'agent-live'
    onNewMessage({
      role: 'assistant',
      content: text,
      id: streamId,
      partial: !latest.final,
      timestamp: new Date().toISOString(),
    })
  }, [agentTranscriptions, isSessionPaused, onNewMessage])

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
          onNewMessage({ role, content: parsed.text, id: parsed.id, timestamp: new Date().toISOString() })
          return
        }

        const next = `${existing}${parsed.text}`

        if (parsed.final) {
          seenFragmentsRef.current.delete(key)
          const role = parsed.type === 'assistant' ? 'assistant' : 'user'
          onNewMessage({
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
        onNewMessage({
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
    [onNewMessage]
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
            
            // User turns only — coach speech comes from agentTranscriptions
            if (conversationData.type === 'user') {
              const content = conversationData.text || conversationData.content || ''
              const timestamp = conversationData.timestamp 
                ? new Date(conversationData.timestamp).toISOString() 
                : new Date().toISOString()
              
              if (content) {
                onNewMessage({ 
                  role: 'user', 
                  content, 
                  id: conversationData.id,
                  timestamp,
                  partial: false,
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

  const setOpenState = useCallback(
    (next: boolean) => {
      setOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )

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
      onOpenChange?.(next)
      return next
    })
  }, [onOpenChange, updatePosition])

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

// Stitch consecutive same-role messages from the same conversational pause into
// a single bubble for display. Underlying `messages` array (and DB) is unchanged
// — this is purely a render-time grouping so a user that pauses mid-sentence
// doesn't get spammed with 10 separate bubbles for one logical turn.
const STITCH_GAP_MS = 90_000 // 90 seconds gap = considered same turn

interface ChatGroup {
  id: string
  role: string
  content: string
  timestamp: string // last message in the group (used for display)
  count: number
}

function groupConsecutive(messages: ChatMessage[]): ChatGroup[] {
  const groups: ChatGroup[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const last = groups[groups.length - 1]
    const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0
    const lastTs = last?.timestamp ? new Date(last.timestamp).getTime() : 0
    const sameRole = last && last.role === m.role
    const closeInTime = sameRole && ts - lastTs <= STITCH_GAP_MS

    if (sameRole && closeInTime) {
      // Append with a space; collapse if the previous fragment already ended
      // with sentence-final punctuation so "Hello." + "How are you?" reads
      // naturally as "Hello. How are you?".
      const sep = /[.!?…]\s*$/.test(last.content) ? ' ' : ' '
      last.content = `${last.content}${sep}${m.content}`.replace(/\s+/g, ' ').trim()
      last.timestamp = m.timestamp || last.timestamp
      last.count += 1
    } else {
      groups.push({
        id: m.id || `g-${i}`,
        role: m.role,
        content: m.content,
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
  turnMetricsByText = {},
  liveMetrics = null,
  showLiveMetrics = false,
  transcriptHidden = false,
}: {
  messages: ChatMessage[]
  turnMetricsByIndex?: Record<number, TurnMetrics>
  turnMetricsByText?: Record<string, TurnMetrics>
  liveMetrics?: import('@/hooks/useSessionMetrics').LiveMetricsSnapshot | null
  showLiveMetrics?: boolean
  transcriptHidden?: boolean
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupConsecutive(messages), [messages])
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
          <div className="shrink-0">
            <div className="text-sm font-semibold">Conversation</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              {userTurnCount} {userTurnCount === 1 ? 'your turn' : 'your turns'}
              {groups.length !== userTurnCount && (
                <span className="ml-1 opacity-70">· {groups.length} messages</span>
              )}
            </div>
          </div>
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
      <div className="p-4 space-y-3 max-h-[32rem] min-h-[12rem] overflow-y-auto overflow-x-hidden bg-gradient-to-b from-background to-muted/10">
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
              return groups.map((g, i) => {
              const turnMetrics =
                g.role === 'user'
                  ? (turnMetricsByIndex[++userTurnIdx] ??
                      lookupTurnMetrics(g.content, turnMetricsByText))
                  : undefined
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


