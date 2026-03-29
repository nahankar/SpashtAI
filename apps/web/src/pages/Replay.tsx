import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useConfirm } from '@/hooks/useConfirm'
import { ContextForm } from '@/components/replay/ContextForm'
import { UploadZone } from '@/components/replay/UploadZone'
import { ProcessingStatus } from '@/components/replay/ProcessingStatus'
import { useReplaySession } from '@/hooks/useReplaySession'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
  CheckCircle2,
  MinusCircle,
  MoreVertical,
  Pencil,
  Download,
  RefreshCw,
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
  progressPulseStatus?: string | null
  result?: {
    overallScore: number
    transcriptionSource: string
  } | null
  uploadedFiles: { id: string; fileType: string; originalName: string }[]
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

type Step = 'history' | 'context' | 'upload' | 'meetingDate' | 'processing'

function EditSessionDialog({
  open,
  onOpenChange,
  session,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: ReplaySessionSummary | null
  onSaved: (updated: Partial<ReplaySessionSummary>) => void
}) {
  const [name, setName] = useState('')
  const [participant, setParticipant] = useState('')
  const [date, setDate] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open && session) {
      setName(session.sessionName || '')
      setParticipant(session.participantName || '')
      setDate(session.meetingDate ? new Date(session.meetingDate).toISOString().slice(0, 10) : '')
    }
  }, [open, session])

  const handleSave = async () => {
    if (!session) return
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      if (name !== (session.sessionName || '')) body.sessionName = name
      if (participant !== (session.participantName || '')) body.participantName = participant
      const origDate = session.meetingDate ? new Date(session.meetingDate).toISOString().slice(0, 10) : ''
      if (date !== origDate) body.meetingDate = date

      if (Object.keys(body).length === 0) {
        onOpenChange(false)
        return
      }

      const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${session.id}`, {
        method: 'PATCH',
        headers: getAuthHeaders(),
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update')
      const updated = await res.json()
      onSaved(updated)
      onOpenChange(false)
      toast.success('Session updated')
    } catch (e: any) {
      toast.error(e.message || 'Failed to update session')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Session</DialogTitle>
          <DialogDescription>Update session details. Changes take effect immediately.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Session Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Q1 Client Review" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-participant">Participant Name</Label>
            <Input id="edit-participant" value={participant} onChange={(e) => setParticipant(e.target.value)} placeholder="e.g. Neelesh, Speaker 1" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-date">Meeting Date</Label>
            <input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

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
  const [flowMeetingDate, setFlowMeetingDate] = useState('')
  const [editSession, setEditSession] = useState<ReplaySessionSummary | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  const {
    sessionId,
    setSessionId,
    status,
    error,
    loading,
    participantMismatch,
    createSession,
    uploadFiles,
    patchReplaySession,
    startProcessing,
    retryWithSpeaker,
  } = useReplaySession()

  const loadSessions = useCallback(async (background = false) => {
    try {
      if (!background) setSessionsLoading(true)
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions`, {
        headers: getAuthHeaders(),
      })
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setSessionsError(null)
    } catch (e: any) {
      if (!background) setSessionsError(e.message)
    } finally {
      if (!background) setSessionsLoading(false)
    }
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  // Auto-refresh list while any sessions are processing (silent, no spinner)
  useEffect(() => {
    const hasProcessing = sessions.some(
      (s) => s.status === 'transcribing' || s.status === 'analyzing'
    )
    if (!hasProcessing) return
    const interval = setInterval(() => loadSessions(true), 5000)
    return () => clearInterval(interval)
  }, [sessions, loadSessions])

  const handleDelete = async (id: string) => {
    const session = sessions.find((s) => s.id === id)
    const pulseWarning = session?.progressPulseStatus === 'tracked'
      ? ' This session is tracked in My Progress Pulse — its scores will also be removed.'
      : ''
    const ok = await confirm({ title: 'Delete Session', description: `Delete this replay session? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete', variant: 'destructive' })
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
    const trackedCount = sessions.filter((s) => selectedReplay.has(s.id) && s.progressPulseStatus === 'tracked').length
    const pulseWarning = trackedCount > 0
      ? ` ${trackedCount} of these are tracked in My Progress Pulse — their scores will also be removed.`
      : ''
    const ok = await confirm({ title: 'Delete Sessions', description: `Delete ${selectedReplay.size} session(s)? This cannot be undone.${pulseWarning}`, confirmLabel: 'Delete All', variant: 'destructive' })
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

  const [reprocessing, setReprocessing] = useState<Set<string>>(new Set())

  const handleReprocess = async (id: string) => {
    const session = sessions.find((s) => s.id === id)
    if (!session) return
    if (!session.meetingDate) {
      toast.error('Meeting date is required', {
        description: 'Set a meeting date via Edit Details before reprocessing.',
      })
      return
    }
    setReprocessing((prev) => new Set(prev).add(id))
    try {
      const res = await fetch(`${API_BASE_URL}/api/replay/sessions/${id}/process`, {
        method: 'POST',
        headers: getAuthHeaders(),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error || 'Failed to start reprocessing')
      }
      setSessions((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, status: 'transcribing', progressPulseStatus: null } : s
        )
      )
      toast.success('Reprocessing started', {
        description: session.sessionName || session.meetingType,
      })
    } catch (e: any) {
      toast.error(e.message || 'Failed to reprocess session')
    } finally {
      setReprocessing((prev) => { const n = new Set(prev); n.delete(id); return n })
    }
  }

  const handleReprocessSelected = async () => {
    const ids = Array.from(selectedReplay)
    const eligible = sessions.filter((s) => ids.includes(s.id) && (s.status === 'completed' || s.status === 'failed'))
    const missingDate = eligible.filter((s) => !s.meetingDate)
    if (missingDate.length > 0) {
      toast.error(`${missingDate.length} session(s) are missing a meeting date`, {
        description: 'Set meeting dates via Edit Details before reprocessing.',
      })
      return
    }
    if (eligible.length === 0) {
      toast.info('No completed or failed sessions selected to reprocess')
      return
    }
    const ok = await confirm({
      title: 'Reprocess Sessions',
      description: `Re-run AI analysis on ${eligible.length} session(s)? Previous results will be replaced with fresh analysis using the latest analytics engine.`,
      confirmLabel: `Reprocess ${eligible.length}`,
    })
    if (!ok) return
    for (const s of eligible) {
      await handleReprocess(s.id)
    }
    setSelectedReplay(new Set())
  }

  const handleReprocessAll = async () => {
    const eligible = sessions.filter((s) => s.status === 'completed' || s.status === 'failed')
    const missingDate = eligible.filter((s) => !s.meetingDate)
    if (eligible.length === 0) {
      toast.info('No completed or failed sessions to reprocess')
      return
    }
    const ok = await confirm({
      title: 'Reprocess All Sessions',
      description: `Re-run AI analysis on ${eligible.length} session(s)?${missingDate.length > 0 ? ` ${missingDate.length} session(s) without a meeting date will be skipped.` : ''} Previous results will be replaced with fresh analysis using the latest analytics engine.`,
      confirmLabel: `Reprocess ${eligible.length - missingDate.length}`,
    })
    if (!ok) return
    const toProcess = eligible.filter((s) => s.meetingDate)
    for (const s of toProcess) {
      await handleReprocess(s.id)
    }
  }

  const handleContinue = (s: ReplaySessionSummary) => {
    setSessionId(s.id)
    if (s.meetingDate) {
      setFlowMeetingDate(new Date(s.meetingDate).toISOString().slice(0, 10))
    } else {
      setFlowMeetingDate('')
    }
    setStep('meetingDate')
  }

  const handleEditSaved = (updated: Partial<ReplaySessionSummary>) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
    )
  }

  const handleDownloadTranscript = async (s: ReplaySessionSummary) => {
    const transcriptFile = s.uploadedFiles.find(
      (f) => f.fileType === 'transcript' || f.fileType === 'text'
    )
    if (!transcriptFile) {
      toast.error('No transcript file found for this session')
      return
    }
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/replay/sessions/${s.id}/download/${transcriptFile.id}`,
        { headers: getAuthHeaders() }
      )
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = transcriptFile.originalName
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download transcript')
    }
  }

  const handleContextSubmit = async (data: {
    sessionName?: string
    participantName: string
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
    try {
      const res = await uploadFiles(sessionId, files)
      if (res.meetingDate) {
        setFlowMeetingDate(res.meetingDate)
      } else {
        setFlowMeetingDate('')
      }
      setStep('meetingDate')
    } catch {
      /* uploadFiles sets error */
    }
  }

  const handleConfirmFlowMeetingDate = async () => {
    if (!sessionId || !flowMeetingDate.trim()) {
      toast.error('Meeting date is required', {
        description:
          'Progress Pulse needs the real meeting date to track your skill trends accurately.',
      })
      return
    }
    try {
      await patchReplaySession(sessionId, { meetingDate: flowMeetingDate.trim() })
      setStep('processing')
      await startProcessing(sessionId)
    } catch {
      /* patch/start sets error */
    }
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
        {(step === 'context' || step === 'meetingDate') && (
          <button
            onClick={() => setStep(step === 'meetingDate' ? 'upload' : 'history')}
            className="mb-4 text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; {step === 'meetingDate' ? 'Back to upload' : 'Back to sessions'}
          </button>
        )}

        {/* Step indicators */}
        <div className="mb-6 flex items-center gap-2 text-sm">
          {(['context', 'upload', 'processing'] as const).map((s, i) => {
            const labels = ['Context', 'Upload', 'Analysis']
            const isActive =
              (s === 'context' && step === 'context') ||
              (s === 'upload' && step === 'upload') ||
              (s === 'processing' && (step === 'processing' || step === 'meetingDate'))
            const isDone =
              (s === 'context' && step !== 'context') ||
              (s === 'upload' && (step === 'meetingDate' || step === 'processing'))
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

        {step === 'meetingDate' && (
          <Card>
            <CardHeader>
              <CardTitle>
                {flowMeetingDate ? 'Confirm meeting date' : 'When did this meeting happen?'}
              </CardTitle>
              <CardDescription>
                {flowMeetingDate
                  ? 'We extracted this date from your transcript. Please confirm it\u2019s correct, or change it if needed.'
                  : 'We couldn\u2019t find a calendar date in your transcript file name or header. Please enter the date this meeting took place.'}
                {' '}Progress Pulse uses the real meeting date to track your skill trends over time.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="flowMeetingDate">Meeting date</Label>
                <input
                  id="flowMeetingDate"
                  type="date"
                  value={flowMeetingDate}
                  onChange={(e) => setFlowMeetingDate(e.target.value)}
                  className="flex h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <Button
                className="w-full sm:w-auto"
                size="lg"
                onClick={handleConfirmFlowMeetingDate}
                disabled={loading || !flowMeetingDate}
              >
                {flowMeetingDate ? 'Confirm & continue' : 'Continue to analysis'}
              </Button>
            </CardContent>
          </Card>
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
      <EditSessionDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        session={editSession}
        onSaved={handleEditSaved}
      />

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Replay</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload transcripts and get AI-powered analysis of your conversations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sessions.some((s) => s.status === 'completed' || s.status === 'failed') && (
            <Button variant="outline" onClick={handleReprocessAll}>
              <RefreshCw className="mr-2 h-4 w-4" /> Reprocess All
            </Button>
          )}
          <Button onClick={() => setStep('context')}>
            <Plus className="mr-2 h-4 w-4" /> New Analysis
          </Button>
        </div>
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
          <Button variant="outline" size="sm" onClick={handleReprocessSelected}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reprocess {selectedReplay.size} Selected
          </Button>
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
                    ) : s.status === 'pending' ? (
                      <Button size="sm" variant="outline" onClick={() => handleContinue(s)}>
                        Continue <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditSession(s); setEditOpen(true) }}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit Details
                        </DropdownMenuItem>
                        {s.uploadedFiles.some((f) => f.fileType === 'transcript' || f.fileType === 'text') && (
                          <DropdownMenuItem onClick={() => handleDownloadTranscript(s)}>
                            <Download className="mr-2 h-4 w-4" /> Download Transcript
                          </DropdownMenuItem>
                        )}
                        {(s.status === 'completed' || s.status === 'failed') && (
                          <DropdownMenuItem
                            onClick={() => handleReprocess(s.id)}
                            disabled={reprocessing.has(s.id)}
                          >
                            <RefreshCw className={`mr-2 h-4 w-4 ${reprocessing.has(s.id) ? 'animate-spin' : ''}`} />
                            {reprocessing.has(s.id) ? 'Reprocessing...' : 'Reprocess'}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => handleDelete(s.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
