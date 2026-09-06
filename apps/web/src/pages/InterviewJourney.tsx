import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calendar,
  Loader2,
  Plus,
  Save,
  Trash2,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { StageTracker } from '@/components/prepare/StageTracker'
import {
  addPreparationStage,
  deletePreparationStage,
  getPreparation,
  reorderPreparationStages,
  updatePreparation,
  updatePreparationStage,
} from '@/lib/prepare-api'
import {
  PREPARE_TEXT_LIMITS,
  type Preparation,
  type PreparationStage,
  type PreparationStageStatus,
  type PreparationStatus,
} from '@/lib/prepare-types'

function dateTimeInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function displayDate(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null
}

const STAGE_STATUSES: PreparationStageStatus[] = [
  'UPCOMING',
  'SCHEDULED',
  'COMPLETED',
  'SKIPPED',
]

const JOURNEY_STATUSES: PreparationStatus[] = [
  'ACTIVE',
  'PAUSED',
  'OFFERED',
  'COMPLETED',
  'REJECTED',
  'WITHDRAWN',
]

export function InterviewJourney() {
  const { id } = useParams<{ id: string }>()
  const [journey, setJourney] = useState<Preparation | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingOverview, setEditingOverview] = useState(false)
  const [editingStage, setEditingStage] = useState<string | null>(null)
  const [newStageName, setNewStageName] = useState('')
  const [tab, setTab] = useState('overview')

  const load = useCallback(async (silent = false) => {
    if (!id) return
    if (!silent) setLoading(true)
    try {
      setJourney(await getPreparation(id))
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load journey')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function saveOverview(form: HTMLFormElement) {
    if (!journey) return
    const values = new FormData(form)
    setSaving(true)
    try {
      const interviewDate = String(values.get('interviewDate') || '')
      setJourney(
        await updatePreparation(journey.id, {
          companyName: String(values.get('companyName') || ''),
          roleTitle: String(values.get('roleTitle') || ''),
          interviewDate: interviewDate ? new Date(interviewDate).toISOString() : null,
          jobDescriptionText: String(values.get('jobDescriptionText') || '') || null,
          resumeLabel: String(values.get('resumeLabel') || '') || null,
          resumeText: String(values.get('resumeText') || '') || null,
        }),
      )
      setEditingOverview(false)
      toast.success('Journey updated')
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Could not save journey')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(stage: PreparationStage, status: PreparationStageStatus) {
    if (!journey) return
    try {
      await updatePreparationStage(journey.id, stage.id, {
        status,
        scheduledAt:
          status === 'SCHEDULED'
            ? stage.scheduledAt ?? journey.interview.interviewDate
            : stage.scheduledAt,
      })
      await load(true)
    } catch (stageError) {
      toast.error(stageError instanceof Error ? stageError.message : 'Could not update stage')
    }
  }

  async function changeJourneyStatus(status: PreparationStatus) {
    if (!journey) return
    try {
      setJourney(await updatePreparation(journey.id, { status }))
      toast.success('Journey status updated')
    } catch (statusError) {
      toast.error(
        statusError instanceof Error ? statusError.message : 'Could not update journey',
      )
    }
  }

  async function saveStage(stage: PreparationStage, form: HTMLFormElement) {
    if (!journey) return
    const values = new FormData(form)
    const scheduledAt = String(values.get('scheduledAt') || '')
    setSaving(true)
    try {
      await updatePreparationStage(journey.id, stage.id, {
        name: String(values.get('name') || ''),
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        interviewerName: String(values.get('interviewerName') || '') || null,
        interviewerRole: String(values.get('interviewerRole') || '') || null,
        interviewerProfileText:
          String(values.get('interviewerProfileText') || '') || null,
      })
      setEditingStage(null)
      await load(true)
      toast.success('Stage updated')
    } catch (stageError) {
      toast.error(stageError instanceof Error ? stageError.message : 'Could not save stage')
    } finally {
      setSaving(false)
    }
  }

  async function moveStage(index: number, direction: -1 | 1) {
    if (!journey) return
    const target = index + direction
    if (target < 0 || target >= journey.stages.length) return
    const reordered = [...journey.stages]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    try {
      setJourney(
        await reorderPreparationStages(
          journey.id,
          reordered.map((stage) => stage.id),
        ),
      )
    } catch (moveError) {
      toast.error(moveError instanceof Error ? moveError.message : 'Could not reorder stages')
    }
  }

  async function addStage() {
    if (!journey || !newStageName.trim()) return
    try {
      await addPreparationStage(journey.id, {
        type: 'CUSTOM',
        name: newStageName.trim(),
      })
      setNewStageName('')
      await load(true)
      toast.success('Stage added')
    } catch (addError) {
      toast.error(addError instanceof Error ? addError.message : 'Could not add stage')
    }
  }

  async function removeStage(stage: PreparationStage) {
    if (!journey) return
    try {
      await deletePreparationStage(journey.id, stage.id)
      await load(true)
      toast.success('Stage removed')
    } catch (removeError) {
      toast.error(removeError instanceof Error ? removeError.message : 'Could not remove stage')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading interview journey…
      </div>
    )
  }

  if (error || !journey) {
    return (
      <Card>
        <CardContent className="py-10 text-center">
          <p className="text-sm text-destructive">{error || 'Journey not found'}</p>
          <Link to="/prepare/interviews"><Button className="mt-4" variant="outline">Back to interviews</Button></Link>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to="/prepare/interviews"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Your interviews
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-primary">{journey.interview.companyName}</p>
          <h1 className="text-3xl font-bold tracking-tight">{journey.interview.roleTitle}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge>{journey.status.toLowerCase()}</Badge>
            {journey.nextStage && (
              <span className="text-sm text-muted-foreground">
                Next: <strong className="text-foreground">{journey.nextStage.name}</strong>
                {journey.nextStage.scheduledAt && ` · ${displayDate(journey.nextStage.scheduledAt)}`}
              </span>
            )}
          </div>
        </div>
        {tab === 'overview' && (
          <Button variant="outline" onClick={() => setEditingOverview((editing) => !editing)}>
            {editingOverview ? 'Cancel editing' : 'Edit journey'}
          </Button>
        )}
      </div>

      <StageTracker stages={journey.stages} />

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-muted-foreground">Journey status</span>
        {JOURNEY_STATUSES.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={journey.status === status ? 'default' : 'outline'}
            className="h-7 rounded-full text-xs"
            onClick={() => changeJourneyStatus(status)}
          >
            {status.toLowerCase()}
          </Button>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stages">Stages</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-5">
          {editingOverview ? (
            <Card>
              <CardHeader><CardTitle>Edit interview journey</CardTitle></CardHeader>
              <CardContent>
                <form
                  className="space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault()
                    saveOverview(event.currentTarget)
                  }}
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-company">Company</Label>
                      <Input id="edit-company" name="companyName" maxLength={PREPARE_TEXT_LIMITS.companyName} defaultValue={journey.interview.companyName} required />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-role">Role</Label>
                      <Input id="edit-role" name="roleTitle" maxLength={PREPARE_TEXT_LIMITS.roleTitle} defaultValue={journey.interview.roleTitle} required />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-date">Next interview date</Label>
                    <Input id="edit-date" name="interviewDate" type="datetime-local" defaultValue={dateTimeInput(journey.interview.interviewDate)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-jd">Job description</Label>
                    <Textarea id="edit-jd" name="jobDescriptionText" rows={8} maxLength={PREPARE_TEXT_LIMITS.jobDescriptionText} defaultValue={journey.interview.jobDescriptionText || ''} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-resume-label">Profile label</Label>
                    <Input id="edit-resume-label" name="resumeLabel" maxLength={PREPARE_TEXT_LIMITS.resumeLabel} defaultValue={journey.interview.resumeLabel || ''} />
                    <Textarea name="resumeText" rows={7} maxLength={PREPARE_TEXT_LIMITS.resumeText} defaultValue={journey.interview.resumeText || ''} aria-label="Profile or resume text" />
                  </div>
                  <Button type="submit" disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save journey
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="text-lg">Interview</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p><span className="text-muted-foreground">Company:</span> {journey.interview.companyName}</p>
                  <p><span className="text-muted-foreground">Role:</span> {journey.interview.roleTitle}</p>
                  <p className="flex items-center gap-1">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    {displayDate(journey.interview.interviewDate) || 'No interview date set'}
                  </p>
                  {journey.lastCompletedStage && (
                    <p><span className="text-muted-foreground">Last completed:</span> {journey.lastCompletedStage.name}</p>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Role context</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Job description</p>
                    <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm">
                      {journey.interview.jobDescriptionText || 'No job description added.'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      {journey.interview.resumeLabel || 'Profile / resume'}
                    </p>
                    <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-sm">
                      {journey.interview.resumeText || 'No profile text added for this role.'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="stages" className="mt-5 space-y-4">
          {journey.stages.map((stage, index) => (
            <Card key={stage.id}>
              <CardContent className="py-4">
                {editingStage === stage.id ? (
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault()
                      saveStage(stage, event.currentTarget)
                    }}
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label>Stage name</Label>
                        <Input name="name" maxLength={PREPARE_TEXT_LIMITS.stageName} defaultValue={stage.name} required />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Scheduled for</Label>
                        <Input name="scheduledAt" type="datetime-local" defaultValue={dateTimeInput(stage.scheduledAt)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Interviewer name</Label>
                        <Input name="interviewerName" maxLength={PREPARE_TEXT_LIMITS.interviewerName} defaultValue={stage.interviewerName || ''} />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Interviewer professional role</Label>
                        <Input name="interviewerRole" maxLength={PREPARE_TEXT_LIMITS.interviewerRole} defaultValue={stage.interviewerRole || ''} />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Professional profile details</Label>
                      <Textarea name="interviewerProfileText" rows={4} maxLength={PREPARE_TEXT_LIMITS.interviewerProfileText} defaultValue={stage.interviewerProfileText || ''} />
                    </div>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" disabled={saving}>Save</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setEditingStage(null)}>Cancel</Button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{index + 1}</span>
                          <h3 className="font-semibold">{stage.name}</h3>
                          <Badge variant="outline">{stage.status.toLowerCase()}</Badge>
                        </div>
                        {stage.scheduledAt && <p className="mt-1 text-xs text-muted-foreground">{displayDate(stage.scheduledAt)}</p>}
                        {(stage.interviewerName || stage.interviewerRole) && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <UserRound className="h-3.5 w-3.5" />
                            {[stage.interviewerName, stage.interviewerRole].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => moveStage(index, -1)} aria-label={`Move ${stage.name} up`}><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" disabled={index === journey.stages.length - 1} onClick={() => moveStage(index, 1)} aria-label={`Move ${stage.name} down`}><ArrowDown className="h-4 w-4" /></Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingStage(stage.id)}>Edit</Button>
                        <Button size="icon" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => removeStage(stage)} aria-label={`Remove ${stage.name}`}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {STAGE_STATUSES.map((status) => (
                        <Button
                          key={status}
                          size="sm"
                          variant={stage.status === status ? 'default' : 'ghost'}
                          onClick={() => changeStatus(stage, status)}
                          className="h-7 text-xs"
                        >
                          {status.toLowerCase()}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}

          <Card className="border-dashed">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row">
              <Input
                value={newStageName}
                onChange={(event) => setNewStageName(event.target.value)}
                placeholder="Add a custom stage"
                maxLength={PREPARE_TEXT_LIMITS.stageName}
                aria-label="Custom stage name"
              />
              <Button onClick={addStage} disabled={!newStageName.trim()}>
                <Plus className="mr-2 h-4 w-4" /> Add stage
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
