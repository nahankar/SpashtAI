import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Calendar,
  Clock,
  MessageSquare,
  TrendingUp,
  Trash2,
  ArrowRight,
  FileText,
  User,
  Loader2,
  AlertCircle,
  ArrowLeft,
  CheckSquare,
  Square,
  CheckCircle2,
  MinusCircle,
} from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface ReplaySummary {
  id: string
  sessionName?: string | null
  meetingType: string
  userRole: string
  participantName?: string | null
  status: string
  createdAt: string
  meetingDate?: string | null
  progressPulseStatus?: string | null
  result?: { overallScore: number; transcriptionSource: string } | null
  uploadedFiles: { fileType: string; originalName: string }[]
}

interface ElevateSession {
  id: string
  module: string
  sessionName?: string | null
  startedAt: string
  endedAt?: string
  progressPulseStatus?: string | null
  durationSec?: number
  words?: number
  fillerRate?: number
  user: { id: string; email: string }
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}m ${secs}s`
}

function replayScoreColor(score: number) {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-amber-600'
  return 'text-red-600'
}

const REPLAY_STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  completed: { variant: 'default', label: 'Completed' },
  pending: { variant: 'outline', label: 'Pending' },
  transcribing: { variant: 'secondary', label: 'Processing' },
  analyzing: { variant: 'secondary', label: 'Analyzing' },
  failed: { variant: 'destructive', label: 'Failed' },
}

export function History() {
  const [searchParams] = useSearchParams()
  const defaultTab = searchParams.get('tab') === 'elevate' ? 'elevate' : 'replay'
  const confirm = useConfirm()

  const [replaySessions, setReplaySessions] = useState<ReplaySummary[]>([])
  const [elevateSessions, setElevateSessions] = useState<ElevateSession[]>([])
  const [replayLoading, setReplayLoading] = useState(true)
  const [elevateLoading, setElevateLoading] = useState(true)
  const [selectedReplay, setSelectedReplay] = useState<Set<string>>(new Set())
  const [selectedElevate, setSelectedElevate] = useState<Set<string>>(new Set())

  // Replay filters
  const [rSearch, setRSearch] = useState('')
  const [rSortField, setRSortField] = useState<SortField>('date')
  const [rSortDir, setRSortDir] = useState<SortDir>('desc')
  const [rStatusFilter, setRStatusFilter] = useState('all')

  // Elevate filters
  const [eSearch, setESearch] = useState('')
  const [eSortField, setESortField] = useState<SortField>('date')
  const [eSortDir, setESortDir] = useState<SortDir>('desc')
  const [eStatusFilter, setEStatusFilter] = useState('all')

  const filteredReplay = useMemo(() => {
    let result = [...replaySessions]
    if (rSearch) {
      const q = rSearch.toLowerCase()
      result = result.filter(
        (s) =>
          (s.sessionName || '').toLowerCase().includes(q) ||
          s.meetingType.toLowerCase().includes(q) ||
          s.userRole.toLowerCase().includes(q) ||
          (s.participantName || '').toLowerCase().includes(q)
      )
    }
    if (rStatusFilter !== 'all') {
      result = result.filter((s) => s.status === rStatusFilter)
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (rSortField) {
        case 'date':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'name':
          cmp = (a.sessionName || a.meetingType).localeCompare(b.sessionName || b.meetingType)
          break
        case 'score':
          cmp = (a.result?.overallScore ?? -1) - (b.result?.overallScore ?? -1)
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
      }
      return rSortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [replaySessions, rSearch, rSortField, rSortDir, rStatusFilter])

  const filteredElevate = useMemo(() => {
    let result = [...elevateSessions]
    if (eSearch) {
      const q = eSearch.toLowerCase()
      result = result.filter(
        (s) =>
          (s.sessionName || '').toLowerCase().includes(q) ||
          s.module.toLowerCase().includes(q)
      )
    }
    if (eStatusFilter !== 'all') {
      result = result.filter((s) =>
        eStatusFilter === 'completed' ? s.endedAt != null : s.endedAt == null
      )
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (eSortField) {
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
      return eSortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [elevateSessions, eSearch, eSortField, eSortDir, eStatusFilter])

  const replaySortOptions: { value: SortField; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'name', label: 'Name' },
    { value: 'score', label: 'Score' },
    { value: 'status', label: 'Status' },
  ]
  const replayStatusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'completed', label: 'Completed' },
    { value: 'pending', label: 'Pending' },
    { value: 'analyzing', label: 'Analyzing' },
    { value: 'transcribing', label: 'Processing' },
    { value: 'failed', label: 'Failed' },
  ]
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
    fetchReplay()
    fetchElevate()
  }, [])

  async function fetchReplay() {
    try {
      setReplayLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setReplaySessions(data.sessions || [])
    } catch {
      // handled inline
    } finally {
      setReplayLoading(false)
    }
  }

  async function fetchElevate() {
    try {
      setElevateLoading(true)
      const res = await fetch(`${API_BASE_URL}/sessions`, { headers: getAuthHeaders() })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setElevateSessions(data.sessions || [])
    } catch {
      // handled inline
    } finally {
      setElevateLoading(false)
    }
  }

  async function deleteReplaySession(id: string) {
    const session = replaySessions.find((s) => s.id === id)
    const pulseWarning = session?.progressPulseStatus === 'tracked'
      ? ' This session is tracked in My Progress Pulse — its scores will also be removed.'
      : ''
    const ok = await confirm({ title: 'Delete Session', description: `Delete this replay session? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
      setReplaySessions((prev) => prev.filter((s) => s.id !== id))
      setSelectedReplay((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Session deleted')
    } catch {
      toast.error('Failed to delete session.')
    }
  }

  async function deleteSelectedReplay() {
    if (selectedReplay.size === 0) return
    const trackedCount = replaySessions.filter((s) => selectedReplay.has(s.id) && s.progressPulseStatus === 'tracked').length
    const pulseWarning = trackedCount > 0
      ? ` ${trackedCount} of these are tracked in My Progress Pulse — their scores will also be removed.`
      : ''
    const ok = await confirm({ title: 'Delete Sessions', description: `Delete ${selectedReplay.size} session(s)? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete All', variant: 'destructive' })
    if (!ok) return
    try {
      await Promise.all(
        Array.from(selectedReplay).map((id) =>
          fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
        )
      )
      await fetchReplay()
      setSelectedReplay(new Set())
      toast.success(`${selectedReplay.size} session(s) deleted`)
    } catch {
      toast.error('Some sessions could not be deleted.')
    }
  }

  async function deleteElevateSession(id: string) {
    const session = elevateSessions.find((s) => s.id === id)
    const pulseWarning = session?.progressPulseStatus === 'tracked'
      ? ' This session is tracked in My Progress Pulse — its scores will also be removed.'
      : ''
    const ok = await confirm({ title: 'Delete Session', description: `Delete this session? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await fetch(`${API_BASE_URL}/sessions/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
      setElevateSessions((prev) => prev.filter((s) => s.id !== id))
      setSelectedElevate((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Session deleted')
    } catch {
      toast.error('Failed to delete session.')
    }
  }

  async function deleteSelectedElevate() {
    if (selectedElevate.size === 0) return
    const trackedCount = elevateSessions.filter((s) => selectedElevate.has(s.id) && s.progressPulseStatus === 'tracked').length
    const pulseWarning = trackedCount > 0
      ? ` ${trackedCount} of these are tracked in My Progress Pulse — their scores will also be removed.`
      : ''
    const ok = await confirm({ title: 'Delete Sessions', description: `Delete ${selectedElevate.size} session(s)? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete All', variant: 'destructive' })
    if (!ok) return
    try {
      await Promise.all(
        Array.from(selectedElevate).map((id) =>
          fetch(`${API_BASE_URL}/sessions/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
        )
      )
      await fetchElevate()
      setSelectedElevate(new Set())
      toast.success(`${selectedElevate.size} session(s) deleted`)
    } catch {
      toast.error('Some sessions could not be deleted.')
    }
  }

  return (
    <div>
      <div className="mb-6">
        <Link to="/" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Home
        </Link>
        <h1 className="text-2xl font-bold">Past Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your Replay analyses and Elevate practice sessions.
        </p>
      </div>

      <Tabs defaultValue={defaultTab}>
        <TabsList className="mb-4 w-full justify-start">
          <TabsTrigger value="replay" className="gap-1.5">
            Replay
            {replaySessions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{replaySessions.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="elevate" className="gap-1.5">
            Elevate
            {elevateSessions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">{elevateSessions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* Replay Sessions */}
        <TabsContent value="replay">
          {selectedReplay.size > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={deleteSelectedReplay}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedReplay.size} Selected
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedReplay(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {replayLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
            </div>
          )}

          {!replayLoading && replaySessions.length > 0 && (
            <div className="mb-4">
              <SessionFilters
                search={rSearch}
                onSearchChange={setRSearch}
                sortField={rSortField}
                sortDir={rSortDir}
                onSortChange={(f, d) => { setRSortField(f); setRSortDir(d) }}
                sortOptions={replaySortOptions}
                statusFilter={rStatusFilter}
                onStatusFilterChange={setRStatusFilter}
                statusOptions={replayStatusOptions}
                totalCount={replaySessions.length}
                filteredCount={filteredReplay.length}
              />
            </div>
          )}

          {!replayLoading && replaySessions.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <FileText className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No replay sessions yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Upload a transcript to get AI analysis.
                </p>
                <Link to="/replay">
                  <Button className="mt-4">Go to Replay</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {!replayLoading && replaySessions.length > 0 && filteredReplay.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No sessions match your filters.
              </CardContent>
            </Card>
          )}

          {!replayLoading && filteredReplay.length > 0 && (
            <div className="grid gap-3">
              {filteredReplay.map((s) => {
                const badge = REPLAY_STATUS_BADGE[s.status] || REPLAY_STATUS_BADGE.pending
                const hasResult = s.status === 'completed' && s.result
                const isSelected = selectedReplay.has(s.id)
                return (
                  <Card key={s.id} className={`transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                    <CardContent className="flex items-center gap-4 py-4">
                      <button
                        onClick={() =>
                          setSelectedReplay((prev) => {
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
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted">
                        {hasResult ? (
                          <span className={`text-lg font-bold ${replayScoreColor(s.result!.overallScore)}`}>
                            {s.result!.overallScore.toFixed(0)}
                          </span>
                        ) : (
                          <FileText className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{s.sessionName || s.meetingType}</span>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {s.sessionName && <span>{s.meetingType}</span>}
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatRelativeDate(s.createdAt)}
                          </span>
                          {s.participantName && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {s.participantName}
                            </span>
                          )}
                          <span>{s.userRole}</span>
                          {s.progressPulseStatus === 'tracked' && (
                            <span className="flex items-center gap-0.5 text-green-600" title="Tracked in My Progress Pulse">
                              <CheckCircle2 className="h-3 w-3" />
                            </span>
                          )}
                          {s.progressPulseStatus === 'skipped' && (
                            <span className="flex items-center gap-0.5 text-muted-foreground/50" title="Not considered for My Progress Pulse">
                              <MinusCircle className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {hasResult && (
                          <Link to={`/replay/${s.id}?from=history`}>
                            <Button size="sm" variant="outline">
                              View Results <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                            </Button>
                          </Link>
                        )}
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteReplaySession(s.id)}
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
        </TabsContent>

        {/* Elevate Sessions */}
        <TabsContent value="elevate">
          {selectedElevate.size > 0 && (
            <div className="mb-4 flex items-center gap-2">
              <Button variant="destructive" size="sm" onClick={deleteSelectedElevate}>
                <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedElevate.size} Selected
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSelectedElevate(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {elevateLoading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
            </div>
          )}

          {!elevateLoading && elevateSessions.length > 0 && (
            <div className="mb-4">
              <SessionFilters
                search={eSearch}
                onSearchChange={setESearch}
                sortField={eSortField}
                sortDir={eSortDir}
                onSortChange={(f, d) => { setESortField(f); setESortDir(d) }}
                sortOptions={elevateSortOptions}
                statusFilter={eStatusFilter}
                onStatusFilterChange={setEStatusFilter}
                statusOptions={elevateStatusOptions}
                totalCount={elevateSessions.length}
                filteredCount={filteredElevate.length}
              />
            </div>
          )}

          {!elevateLoading && elevateSessions.length === 0 && (
            <Card>
              <CardContent className="py-16 text-center">
                <MessageSquare className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
                <h3 className="text-lg font-medium">No Elevate sessions yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start a live AI coaching session.
                </p>
                <Link to="/elevate">
                  <Button className="mt-4">Go to Elevate</Button>
                </Link>
              </CardContent>
            </Card>
          )}

          {!elevateLoading && elevateSessions.length > 0 && filteredElevate.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No sessions match your filters.
              </CardContent>
            </Card>
          )}

          {!elevateLoading && filteredElevate.length > 0 && (
            <div className="grid gap-3">
              {filteredElevate.map((session) => {
                const isSelected = selectedElevate.has(session.id)
                const isCompleted = session.endedAt != null
                return (
                  <Card
                    key={session.id}
                    className={`transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}
                  >
                    <CardContent className="flex items-center gap-4 py-4">
                      <button
                        onClick={() =>
                          setSelectedElevate((prev) => {
                            const n = new Set(prev)
                            n.has(session.id) ? n.delete(session.id) : n.add(session.id)
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">
                            {session.sessionName || `${session.module.charAt(0).toUpperCase() + session.module.slice(1)} Session`}
                          </span>
                          <Badge variant={isCompleted ? 'default' : 'secondary'}>
                            {isCompleted ? 'Completed' : 'In Progress'}
                          </Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {formatRelativeDate(session.startedAt)}
                          </span>
                          {isCompleted && session.durationSec != null && (
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(session.durationSec)}
                            </span>
                          )}
                          {session.words != null && (
                            <span className="flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {session.words} words
                            </span>
                          )}
                          {session.fillerRate != null && (
                            <span className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3" />
                              {session.fillerRate.toFixed(1)}% fillers
                            </span>
                          )}
                          {session.progressPulseStatus === 'tracked' && (
                            <span className="flex items-center gap-0.5 text-green-600" title="Tracked in My Progress Pulse">
                              <CheckCircle2 className="h-3 w-3" />
                            </span>
                          )}
                          {session.progressPulseStatus === 'skipped' && (
                            <span className="flex items-center gap-0.5 text-muted-foreground/50" title="Not considered for My Progress Pulse">
                              <MinusCircle className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Link to={`/elevate?session=${session.id}&from=history`}>
                          <Button size="sm" variant="outline">
                            {isCompleted ? 'View' : 'Resume'} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                          </Button>
                        </Link>
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => deleteElevateSession(session.id)}
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
        </TabsContent>
      </Tabs>
    </div>
  )
}
