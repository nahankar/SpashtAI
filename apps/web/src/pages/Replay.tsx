import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { ContextForm } from '@/components/replay/ContextForm'
import { UploadZone } from '@/components/replay/UploadZone'
import { ProcessingStatus } from '@/components/replay/ProcessingStatus'
import { useReplaySession } from '@/hooks/useReplaySession'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Plus,
  Calendar,
  User,
  Trash2,
  ArrowRight,
  FileText,
  Loader2,
  AlertCircle,
  CheckSquare,
  Square,
} from 'lucide-react'
import { getAuthHeaders } from '@/lib/api-client'
import { SessionFilters, type SortField, type SortDir } from '@/components/SessionFilters'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000'

interface ReplaySessionSummary {
  id: string
  sessionName?: string | null
  meetingType: string
  userRole: string
  participantName?: string | null
  status: string
  createdAt: string
  meetingDate?: string | null
  result?: {
    overallScore: number
    transcriptionSource: string
  } | null
  uploadedFiles: { fileType: string; originalName: string }[]
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

function scoreColor(score: number) {
  if (score >= 8) return 'text-green-600'
  if (score >= 6) return 'text-amber-600'
  return 'text-red-600'
}

const STATUS_BADGE: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  completed: { variant: 'default', label: 'Completed' },
  pending: { variant: 'outline', label: 'Pending' },
  transcribing: { variant: 'secondary', label: 'Processing' },
  analyzing: { variant: 'secondary', label: 'Analyzing' },
  failed: { variant: 'destructive', label: 'Failed' },
}

type Step = 'history' | 'context' | 'upload' | 'processing'

export function Replay() {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [step, setStep] = useState<Step>('history')
  const [sessions, setSessions] = useState<ReplaySessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionsError, setSessionsError] = useState<string | null>(null)

  const [selectedReplay, setSelectedReplay] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [statusFilter, setStatusFilter] = useState('all')

  const {
    sessionId,
    status,
    error,
    loading,
    participantMismatch,
    createSession,
    uploadFiles,
    startProcessing,
    retryWithSpeaker,
  } = useReplaySession()

  const loadSessions = useCallback(async () => {
    try {
      setSessionsLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setSessionsError(null)
    } catch (e: any) {
      setSessionsError(e.message)
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const handleDelete = async (id: string) => {
    const ok = await confirm({ title: 'Delete Session', description: 'Delete this replay session? This cannot be undone.', confirmLabel: 'Delete', variant: 'destructive' })
    if (!ok) return
    try {
      await fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      })
      setSessions((prev) => prev.filter((s) => s.id !== id))
      setSelectedReplay((prev) => { const n = new Set(prev); n.delete(id); return n })
      toast.success('Session deleted')
    } catch {
      toast.error('Failed to delete session.')
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedReplay.size === 0) return
    const ok = await confirm({ title: 'Delete Sessions', description: `Delete ${selectedReplay.size} session(s)? This cannot be undone.`, confirmLabel: 'Delete All', variant: 'destructive' })
    if (!ok) return
    try {
      await Promise.all(
        Array.from(selectedReplay).map((id) =>
          fetch(`${API_BASE_URL}/api/replay/sessions/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
          })
        )
      )
      setSessions((prev) => prev.filter((s) => !selectedReplay.has(s.id)))
      setSelectedReplay(new Set())
      toast.success('Sessions deleted')
    } catch {
      toast.error('Some sessions could not be deleted.')
    }
  }

  const handleContextSubmit = async (data: {
    sessionName?: string
    meetingType: string
    userRole: string
    focusAreas: string[]
    meetingGoal?: string
    meetingDate?: string
    participantName?: string
  }) => {
    await createSession(data)
    setStep('upload')
  }

  const handleUploadSubmit = async (files: {
    audio?: File
    transcript?: File
    text?: string
  }) => {
    if (!sessionId) return
    await uploadFiles(sessionId, files)
    setStep('processing')
    await startProcessing(sessionId)
  }

  const filteredSessions = useMemo(() => {
    let result = [...sessions]
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (s) =>
          (s.sessionName || '').toLowerCase().includes(q) ||
          s.meetingType.toLowerCase().includes(q) ||
          s.userRole.toLowerCase().includes(q) ||
          (s.participantName || '').toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'all') {
      result = result.filter((s) => s.status === statusFilter)
    }
    result.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
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
      return sortDir === 'asc' ? cmp : -cmp
    })
    return result
  }, [sessions, search, sortField, sortDir, statusFilter])

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

  // Show the create flow (context → upload → processing)
  if (step !== 'history') {
    return (
      <div>
        {/* Back to history */}
        {step === 'context' && (
          <button
            onClick={() => setStep('history')}
            className="mb-4 text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to sessions
          </button>
        )}

        {/* Step indicators */}
        <div className="mb-6 flex items-center gap-2 text-sm">
          {(['context', 'upload', 'processing'] as const).map((s, i) => {
            const labels = ['Context', 'Upload', 'Analysis']
            const isActive = s === step
            const isDone =
              (s === 'context' && step !== 'context') ||
              (s === 'upload' && step === 'processing')
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && <div className="h-px w-6 bg-border" />}
                <div
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                    isDone
                      ? 'bg-primary text-primary-foreground'
                      : isActive
                        ? 'border-2 border-primary text-primary'
                        : 'border border-border text-muted-foreground'
                  }`}
                >
                  {isDone ? '\u2713' : i + 1}
                </div>
                <span
                  className={
                    isActive ? 'font-medium text-foreground' : 'text-muted-foreground'
                  }
                >
                  {labels[i]}
                </span>
              </div>
            )
          })}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {step === 'context' && (
          <ContextForm onSubmit={handleContextSubmit} loading={loading} />
        )}

        {step === 'upload' && (
          <UploadZone onSubmit={handleUploadSubmit} loading={loading} />
        )}

        {step === 'processing' && (
          <ProcessingStatus
            status={status?.status || 'pending'}
            errorMessage={status?.errorMessage}
            participantMismatch={participantMismatch}
            loading={loading}
            onSelectSpeaker={
              sessionId
                ? (speaker: string) => retryWithSpeaker(sessionId, speaker)
                : undefined
            }
            onViewResults={
              status?.status === 'completed' && sessionId
                ? () => navigate(`/replay/${sessionId}`)
                : undefined
            }
          />
        )}
      </div>
    )
  }

  // ── Session history view ──

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Replay</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload transcripts and get AI-powered analysis of your conversations.
          </p>
        </div>
        <Button onClick={() => setStep('context')}>
          <Plus className="mr-2 h-4 w-4" /> New Analysis
        </Button>
      </div>

      {sessionsLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading sessions...
        </div>
      )}

      {sessionsError && (
        <Card>
          <CardContent className="flex items-center gap-2 py-6 text-destructive">
            <AlertCircle className="h-5 w-5" /> {sessionsError}
          </CardContent>
        </Card>
      )}

      {selectedReplay.size > 0 && (
        <div className="mb-4 flex items-center gap-2">
          <Button variant="destructive" size="sm" onClick={handleDeleteSelected}>
            <Trash2 className="mr-2 h-4 w-4" /> Delete {selectedReplay.size} Selected
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelectedReplay(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {!sessionsLoading && !sessionsError && sessions.length > 0 && (
        <SessionFilters
          search={search}
          onSearchChange={setSearch}
          sortField={sortField}
          sortDir={sortDir}
          onSortChange={(f, d) => { setSortField(f); setSortDir(d) }}
          sortOptions={replaySortOptions}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          statusOptions={replayStatusOptions}
          totalCount={sessions.length}
          filteredCount={filteredSessions.length}
        />
      )}

      {!sessionsLoading && !sessionsError && sessions.length === 0 && (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="mx-auto mb-3 h-12 w-12 text-muted-foreground" />
            <h3 className="text-lg font-medium">No replay sessions yet</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a transcript or recording to get started with AI analysis.
            </p>
            <Button className="mt-4" onClick={() => setStep('context')}>
              <Plus className="mr-2 h-4 w-4" /> Create Your First Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      {!sessionsLoading && !sessionsError && sessions.length > 0 && filteredSessions.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No sessions match your filters.
          </CardContent>
        </Card>
      )}

      {!sessionsLoading && !sessionsError && filteredSessions.length > 0 && (
        <div className="grid gap-3">
          {filteredSessions.map((s) => {
            const badge = STATUS_BADGE[s.status] || STATUS_BADGE.pending
            const hasResult = s.status === 'completed' && s.result
            const isSelected = selectedReplay.has(s.id)
            return (
              <Card key={s.id} className={`transition-all hover:shadow-md ${isSelected ? 'ring-2 ring-primary' : ''}`}>
                <CardContent className="flex items-center gap-4 py-4">
                  {/* Checkbox */}
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

                  {/* Score circle or status icon */}
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-muted">
                    {hasResult ? (
                      <span className={`text-lg font-bold ${scoreColor(s.result!.overallScore)}`}>
                        {s.result!.overallScore.toFixed(0)}
                      </span>
                    ) : (
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>

                  {/* Details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">
                        {s.sessionName || s.meetingType}
                      </span>
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
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5">
                    {hasResult ? (
                      <Link to={`/replay/${s.id}`}>
                        <Button size="sm" variant="outline">
                          View Results <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    ) : s.status === 'failed' ? (
                      <Link to={`/replay/${s.id}`}>
                        <Button size="sm" variant="outline">
                          Details <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    ) : null}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(s.id)}
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
