import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { RoomEvent } from 'livekit-client'
import { RealTimeMetrics } from '@/components/analytics/RealTimeMetrics'
import { SessionMetrics } from '@/components/analytics/SessionMetrics'
import { AdvancedInsights } from '@/components/analytics/AdvancedInsights'
import { useRealTimeMetrics, useSessionMetrics } from '@/hooks/useSessionMetrics'
import { useConversationPersistence } from '@/hooks/useConversationPersistence'
import { AgentVisualizer } from '@/components/layout/AgentVisualizer'
import { toast } from 'sonner'
import { getAuthHeaders } from '@/lib/api-client'
import { FOCUS_AREAS, getFocusAreaLabel } from '@/lib/focus-areas'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/hooks/useConfirm'

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
  const { user } = useAuth()
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
  const [compose, setCompose] = useState('')
  const [playbackMuted, setPlaybackMuted] = useState(false)
  const [assistantState, setAssistantState] = useState<'restarting' | 'ready' | 'recovering' | 'unknown'>('unknown')
  const [sessionId, setSessionId] = useState<string | null>(viewSessionId) // Initialize with URL param if present
  const [showMetrics, setShowMetrics] = useState(false)
  const [showResumePrompt, setShowResumePrompt] = useState(false)
  const [previousSessionId, setPreviousSessionId] = useState<string | null>(null)
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
    loadPastSessions()
  }, [])
  
  // Real-time metrics for active session
  const { currentMetrics, updateMetrics, resetMetrics } = useRealTimeMetrics()
  
  // Historical metrics for completed sessions
  const { metrics: historicalMetrics, downloadTranscript } = useSessionMetrics(sessionId)
  
  // Persistent conversation system
  const {
    messages,
    isLoading: conversationLoading,
    error: conversationError,
    loadConversation,
    addMessage,
    clearMessages,
    subscribeToUpdates
  } = useConversationPersistence()

  // Check if URL parameter session is completed (for "View Details & Metrics" button)
  useEffect(() => {
    async function checkSessionStatus() {
      if (viewSessionId) {
        try {
          const response = await fetch(`${API_BASE_URL}/sessions/${viewSessionId}`, {
            headers: getAuthHeaders(),
          })
          if (response.ok) {
            const data = await response.json()
            const session = data.session || data // Handle both {session: {...}} and {...} formats
            
            console.log('🔍 Session data:', { id: viewSessionId, endedAt: session.endedAt })
            
            if (session.endedAt) {
              // Session is completed, show metrics directly
              console.log('📊 Viewing completed session:', viewSessionId)
              setSessionId(viewSessionId) // Set session ID to load historical metrics
              await loadConversation(viewSessionId) // Load conversation history
              setShowResumePrompt(false)
              return
            } else {
              // Session is in progress, offer to resume
              console.log('📋 Session in progress, offering resume:', viewSessionId)
              setPreviousSessionId(viewSessionId)
              setShowResumePrompt(true)
              return
            }
          }
        } catch (error) {
          console.error('Error checking session status:', error)
        }
      }
    }
    
    checkSessionStatus()
  }, [viewSessionId])

  // Check for previous session on mount (for page refresh scenario)
  useEffect(() => {
    // Skip if we have a URL parameter (handled by checkSessionStatus above)
    if (viewSessionId) return
    
    const savedSessionId = localStorage.getItem('spashtai_active_session')
    const savedTimestamp = localStorage.getItem('spashtai_session_timestamp')
    
    if (savedSessionId) {
      console.log('📋 Found active session:', savedSessionId)
      setPreviousSessionId(savedSessionId)
      setShowResumePrompt(true)
    }
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
      setToken(null)
      setUrl(null)
      setRoomName('')
      setAssistantState('unknown')
    }, IDLE_TIMEOUT_MS)
  }, [joined, sessionId])

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
      // 1. Create session ID first
      const newSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      
      // 2. Generate unique room name per session to avoid conflicts on hard refresh
      const uniqueRoomName = roomName || `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
      
      // 3. Get LiveKit token with session ID
      const u = new URL(`${API_BASE_URL}/livekit/token`)
      u.searchParams.set('identity', identity)
      u.searchParams.set('room', uniqueRoomName)
      u.searchParams.set('sessionId', newSessionId) // Pass session ID to token endpoint
      const res = await fetch(u.toString())
      if (!res.ok) throw new Error('Failed to get token')
      const json = await res.json()
      
      // 3. Create session in database
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
      
      // 4. Set up LiveKit connection
      setToken(json.token)
      setUrl(json.url)
      setSessionId(newSessionId)
      setRoomName(uniqueRoomName) // Store the generated room name
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
    setToken(null)
    setUrl(null)
    setRoomName('')
    setAssistantState('unknown')
    // Keep sessionId, localStorage, and messages intact so resume works
  }, [])

  // Called only when user explicitly clicks "Leave".
  // Ends the session permanently.
  const handleLeave = useCallback(async () => {
    const currentSessionId = sessionId

    setToken(null)
    setUrl(null)
    setSessionId(null)
    setRoomName('')
    setAssistantState('unknown')
    clearMessages()
    resetMetrics()

    localStorage.removeItem('spashtai_active_session')
    localStorage.removeItem('spashtai_session_timestamp')

    let metricsData: any = null
    if (currentSessionId) {
      try {
        await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/end`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ endedAt: new Date().toISOString() })
        })

        await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/calculate-text-metrics`, {
          method: 'POST',
          headers: getAuthHeaders()
        })

        const metricsRes = await fetch(`${API_BASE_URL}/sessions/${currentSessionId}/metrics`, {
          headers: getAuthHeaders(),
        })
        if (metricsRes.ok) {
          metricsData = await metricsRes.json()
        }
      } catch (err) {
        console.warn('Failed to finalize session:', err)
      }

      // Ask user whether to track this session in Progress Pulse
      const trackIt = await confirmDialog({
        title: 'Track in My Progress Pulse?',
        description: 'Would you like to include this session\'s scores in your progress tracking?',
        confirmLabel: 'Yes, track this',
        cancelLabel: 'Skip — won\'t be added later',
      })

      if (trackIt && metricsData?.metrics) {
        try {
          const m = metricsData.metrics
          const entries: { skill: string; score: number }[] = []
          const userWpm = m.userWpm || 0
          const fillerRate = m.userFillerRate || 0
          const vocabDiv = m.userVocabDiversity || 0

          if (userWpm > 0) {
            entries.push({ skill: 'pacing', score: userWpm >= 120 && userWpm <= 180 ? 9 : userWpm >= 100 && userWpm <= 200 ? 7 : 5 })
          }
          if (fillerRate >= 0) {
            entries.push({ skill: 'filler_words', score: Math.max(0, Math.min(10, 10 - fillerRate * 2)) })
          }
          if (vocabDiv > 0) {
            entries.push({ skill: 'conciseness', score: vocabDiv >= 50 ? 9 : vocabDiv >= 30 ? 7 : 5 })
          }

          if (entries.length > 0) {
            await fetch(`${API_BASE_URL}/api/progress-pulse`, {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify({ entries, sessionId: currentSessionId, source: 'elevate' }),
            })
            toast.success('Session tracked in My Progress Pulse')
          }
        } catch {
          toast.error('Failed to track session')
        }
      } else {
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

    navigate(cameFromHistory ? '/history?tab=elevate' : '/elevate')
  }, [sessionId, clearMessages, resetMetrics, navigate, cameFromHistory, confirmDialog])

  const handleResumeSession = useCallback(async () => {
    if (!previousSessionId) return
    
    try {
      setShowResumePrompt(false)
      
      // Load the previous session's conversation history
      console.log('📖 Resuming session:', previousSessionId)
      setSessionId(previousSessionId)
      await loadConversation(previousSessionId)
      
      // Create NEW room for resumed session (can't rejoin old room, agent is gone)
      const newRoomName = `room_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
      
      // Get new token for new room
      const u = new URL(`${API_BASE_URL}/livekit/token`)
      u.searchParams.set('identity', identity)
      u.searchParams.set('room', newRoomName)
      u.searchParams.set('sessionId', previousSessionId) // Use SAME session ID
      
      const res = await fetch(u.toString())
      if (!res.ok) throw new Error('Failed to get token')
      const json = await res.json()
      
      setToken(json.token)
      setUrl(json.url)
      setRoomName(newRoomName)
      resetMetrics()
      
      console.log('✅ Session resumed with chat history, new voice connection established')
    } catch (error) {
      console.error('❌ Error resuming session:', error)
      setShowResumePrompt(false)
      setPreviousSessionId(null)
    }
  }, [previousSessionId, identity, loadConversation, resetMetrics])

  const handleStartNewSession = useCallback(() => {
    setShowResumePrompt(false)
    setPreviousSessionId(null)
    localStorage.removeItem('spashtai_active_session')
    localStorage.removeItem('spashtai_session_timestamp')
  }, [])

  const breadcrumbLabel = viewSessionId
    ? 'Session Analytics'
    : joined
      ? 'Live Session'
      : 'New Session'

  // ── Session history view ──
  if (showHistory && !joined && !viewSessionId && !showResumePrompt) {
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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Elevate</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Practice with a live AI coach and elevate your communication skills.
            </p>
          </div>
          <Button onClick={() => setShowHistory(false)}>
            + New Elevate Session
          </Button>
        </div>

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

        {!pastLoading && filteredPastSessions.length > 0 && (
          <div className="grid gap-3">
            {filteredPastSessions.map((s) => {
              const done = s.endedAt != null
              return (
                <Card key={s.id} className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 py-4">
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
                    <Link to={`/elevate?session=${s.id}`}>
                      <Button size="sm" variant="outline">
                        {done ? 'View Results' : 'Resume'}
                      </Button>
                    </Link>
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
          &larr; Back to My Sessions
        </Link>
      )}
      {!joined && !viewSessionId && !showHistory && (
        <button
          onClick={() => setShowHistory(true)}
          className="text-sm text-muted-foreground hover:text-foreground w-fit"
        >
          &larr; Back to sessions
        </button>
      )}

      {/* Resume Session Prompt */}
      {showResumePrompt && previousSessionId && (
        <Card className="border-blue-500 bg-blue-50">
          <CardHeader>
            <CardTitle className="text-blue-900">Resume Previous Session?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-blue-800 mb-4">
              You have a recent session that was interrupted. Would you like to resume with your chat history?
            </p>
            <div className="flex gap-2">
              <Button onClick={handleResumeSession} variant="default">
                Resume Session
              </Button>
              <Button onClick={handleStartNewSession} variant="outline">
                Start New Session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      
      <Card>
        <CardHeader>
          <CardTitle>Elevate Session</CardTitle>
        </CardHeader>
        <CardContent>
          {!joined && !viewSessionId ? (
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
          ) : !joined && viewSessionId ? (
            <div className="space-y-4">
              {/* Viewing completed session - show chat and metrics */}
              <ChatPanel messages={messages} />
              
              {/* Historical metrics display */}
              {sessionId && historicalMetrics && (
                <>
                  <SessionMetrics 
                    sessionId={sessionId}
                    metrics={historicalMetrics}
                    onDownloadTranscript={downloadTranscript}
                  />
                  
                  {/* Advanced Analytics - spaCy, Praat, Gentle insights */}
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
                <div className="rounded-md border border-yellow-400 bg-yellow-50 px-4 py-3 text-sm text-yellow-800 flex items-center justify-between">
                  <span>Session will auto-pause in 1 minute due to inactivity. Move your mouse or press a key to stay connected.</span>
                  <Button size="sm" variant="outline" onClick={resetIdleTimer}>Stay Connected</Button>
                </div>
              )}
              {!token && !url && sessionId && (
                <div className="rounded-md border border-blue-400 bg-blue-50 px-4 py-3 text-sm text-blue-800 flex items-center justify-between">
                  <span>Session paused due to inactivity. Your conversation is saved.</span>
                  <Button size="sm" onClick={() => {
                    setPreviousSessionId(sessionId)
                    setSessionId(null)
                    setShowResumePrompt(false)
                    // Trigger resume flow with current sessionId
                    const resumeSessionId = sessionId
                    ;(async () => {
                      try {
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
                        resetMetrics()
                      } catch (err) {
                        console.error('Failed to resume after idle:', err)
                      }
                    })()
                  }}>Resume Session</Button>
                </div>
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
                  <RoomAudioRenderer muted={playbackMuted} />
                  <AgentVisualizer className="bg-muted/20 rounded-lg mb-4" />
                  <ConnectionStatus assistantState={assistantState} />
                  <LiveKitConversation 
                    sessionId={sessionId}
                    onNewMessage={(message) => {
                      console.log('🎯 Adding message via LiveKit:', message)
                      
                      // Filter out empty or meaningless messages
                      const content = message.content?.trim() || ''
                      if (!content || content === '[]' || content.length < 2) {
                        console.log('⏭️ Skipping empty/invalid message:', content)
                        return
                      }
                      
                      // Check for duplicates in existing messages
                      const isDuplicate = messages.some((msg: any) => 
                        msg.role === message.role && 
                        msg.content === content &&
                        msg.id === message.id
                      )
                      if (isDuplicate) {
                        console.log('⏭️ Skipping duplicate message:', content.substring(0, 50))
                        return
                      }
                      
                      // Use the persistence hook's addMessage function instead of setMessages
                      console.log('📝 Adding valid message to conversation:', { role: message.role, content: content.substring(0, 50) })
                      addMessage(message.role, content)
                    }}
                    onStateChange={setAssistantState}
                    onRestart={() => {
                      clearMessages()
                      resetMetrics()
                    }}
                    onMetricsUpdate={updateMetrics}
                  />
                  <div className="flex flex-wrap items-center gap-2 py-2">
                    <Button variant="destructive" onClick={handleLeave}>Leave</Button>
                    <Button 
                      variant="outline" 
                      onClick={() => setShowMetrics(!showMetrics)}
                    >
                      {showMetrics ? 'Hide Metrics' : 'Show Metrics'}
                    </Button>
                    <InRoomControls
                    onLeave={handleLeave}
                    playbackMuted={playbackMuted}
                    onTogglePlaybackMuted={() => setPlaybackMuted((m) => !m)}
                    />
                  </div>
                  
                  {/* Real-time metrics overlay */}
                  <RealTimeMetrics 
                    metrics={currentMetrics} 
                    isVisible={showMetrics && joined}
                  />
                </LiveKitRoom>
              )}
              <ChatPanel messages={messages} />
              
              {/* Historical metrics display */}
              {!joined && sessionId && historicalMetrics && (
                <>
                  <SessionMetrics 
                    sessionId={sessionId}
                    metrics={historicalMetrics}
                    onDownloadTranscript={downloadTranscript}
                  />
                  
                  {/* Advanced Analytics - spaCy, Praat, Gentle insights */}
                  <div className="mt-6">
                    <AdvancedInsights 
                      sessionId={sessionId}
                      isSessionEnded={!joined}
                    />
                  </div>
                </>
              )}
              <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
                <Textarea
                  placeholder="Type to simulate transcript..."
                  value={compose}
                  onChange={(e) => setCompose(e.target.value)}
                />
                  <Button 
                    onClick={async () => {
                      if (!compose.trim()) return
                      const userText = compose.trim()
                      
                      // Add user message to chat using persistence hook
                      await addMessage('user', userText)
                      setCompose('')
                      
                      // Note: Real voice conversations will be handled by the AWS NovaSonic agent
                      // This text simulation is for testing UI only - no backend call needed
                      console.log('📝 Text simulation message:', userText, '(Real conversations use voice + AWS NovaSonic)')
                    }}
                  >Send</Button>
              </div>
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
  onNewMessage,
  onStateChange,
  onRestart,
  onMetricsUpdate
}: {
  sessionId: string | null
  onNewMessage: (message: ChatMessage) => void
  onStateChange: (state: 'restarting' | 'ready' | 'recovering' | 'unknown') => void
  onRestart: () => void
  onMetricsUpdate: (metrics: any) => void
}) {
  const connectionState = useConnectionState()
  const room = useRoomContext()
  const seenFragmentsRef = useRef<Map<string, string>>(new Map())
  const lastControlStateRef = useRef<string>('unknown')

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
          console.log('🧾 Emitting final message', { key, role, text: next })
          onNewMessage({ role, content: next, id: parsed.id, timestamp: new Date().toISOString() })
          return
        }

        seenFragmentsRef.current.set(key, next)
        console.log('🧩 Stored partial fragment', { key, length: next.length })
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
            
            // Handle direct conversation messages from agent (type: "user" or "assistant")
            if (conversationData.type === 'user' || conversationData.type === 'assistant') {
              const role = conversationData.type
              const content = conversationData.text || conversationData.content || ''
              const timestamp = conversationData.timestamp 
                ? new Date(conversationData.timestamp).toISOString() 
                : new Date().toISOString()
              
              if (content) {
                console.log(`� Adding ${role} message:`, content.substring(0, 50))
                onNewMessage({ 
                  role, 
                  content, 
                  id: conversationData.id,
                  timestamp 
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
  }, [room, connectionState, processPayload, onStateChange, onRestart, onMetricsUpdate, sessionId])

  // Remove duplicate - handled by first useEffect above
  // This second useEffect was causing messages to be missed!

  return null
}

function InRoomControls({ onLeave: _onLeave, playbackMuted, onTogglePlaybackMuted }: { onLeave: () => void; playbackMuted: boolean; onTogglePlaybackMuted: () => void }) {
  const room = useRoomContext()
  const [micEnabled, setMicEnabled] = useState(() => room.localParticipant.isMicrophoneEnabled)

  // Sync micEnabled state with actual LiveKit microphone state
  useEffect(() => {
    const handleTrackMuted = () => {
      setMicEnabled(room.localParticipant.isMicrophoneEnabled)
    }
    const handleTrackUnmuted = () => {
      setMicEnabled(room.localParticipant.isMicrophoneEnabled)
    }
    const handleTrackPublished = () => {
      setMicEnabled(room.localParticipant.isMicrophoneEnabled)
    }
    
    // Set initial state
    setMicEnabled(room.localParticipant.isMicrophoneEnabled)
    
    room.localParticipant.on('trackMuted', handleTrackMuted)
    room.localParticipant.on('trackUnmuted', handleTrackUnmuted)
    room.localParticipant.on('localTrackPublished', handleTrackPublished)
    
    return () => {
      room.localParticipant.off('trackMuted', handleTrackMuted)
      room.localParticipant.off('trackUnmuted', handleTrackUnmuted)
      room.localParticipant.off('localTrackPublished', handleTrackPublished)
    }
  }, [room])

  const start = useCallback(async () => {
    await room.localParticipant.setMicrophoneEnabled(true)
    setMicEnabled(true)
  }, [room])

  const pause = useCallback(async () => {
    await room.localParticipant.setMicrophoneEnabled(false)
    setMicEnabled(false)
  }, [room])

  const resume = start

  const stop = useCallback(async () => {
    await room.localParticipant.setMicrophoneEnabled(false)
    setMicEnabled(false)
  }, [room])

  const muteUnmute = useCallback(async () => {
    if (micEnabled) {
      await room.localParticipant.setMicrophoneEnabled(false)
      setMicEnabled(false)
    } else {
      await room.localParticipant.setMicrophoneEnabled(true)
      setMicEnabled(true)
    }
  }, [room, micEnabled])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={micEnabled ? stop : start}>{micEnabled ? 'Stop' : 'Start'}</Button>
      <Button variant="secondary" onClick={micEnabled ? pause : resume} disabled={!micEnabled}>{micEnabled ? 'Pause' : 'Resume'}</Button>
      <Button variant="outline" onClick={muteUnmute}>{micEnabled ? 'Mute' : 'Unmute'}</Button>
      <Button variant="outline" onClick={onTogglePlaybackMuted}>{playbackMuted ? 'Unmute Output' : 'Mute Output'}</Button>
    </div>
  )
}

interface ChatMessage {
  id?: string;
  role: string;
  content: string;
  timestamp: string;
}

function ChatPanel({ messages }: { messages: ChatMessage[] }) {
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      <div className="border-b bg-muted/50 px-4 py-3">
        <div className="text-sm font-semibold">Conversation</div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {messages.length} {messages.length === 1 ? 'message' : 'messages'}
        </div>
      </div>
      
      {/* Messages Container */}
      <div className="p-4 space-y-3 max-h-96 overflow-y-auto overflow-x-hidden bg-gradient-to-b from-background to-muted/10">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">No messages yet</div>
              <div className="text-xs text-muted-foreground/60 mt-1">Start speaking to begin the conversation</div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((m, i) => (
              <div 
                key={m.id || i} 
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}
              >
                <div className={`flex flex-col max-w-[80%] ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                  {/* Message Bubble */}
                  <div 
                    className={`rounded-2xl px-4 py-2.5 shadow-sm ${
                      m.role === 'user' 
                        ? 'bg-blue-500 text-white rounded-tr-sm' 
                        : 'bg-gray-100 text-gray-900 rounded-tl-sm border border-gray-200'
                    }`}
                  >
                    <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                  
                  {/* Timestamp */}
                  <div 
                    className={`text-[10px] mt-1 px-1 ${
                      m.role === 'user' 
                        ? 'text-muted-foreground' 
                        : 'text-muted-foreground'
                    }`}
                  >
                    {formatTime(m.timestamp)}
                  </div>
                </div>
              </div>
            ))}
            {/* Invisible div for auto-scroll anchor */}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
    </div>
  )
}


