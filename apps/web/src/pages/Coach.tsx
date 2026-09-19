import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BarChart3,
  BriefcaseBusiness,
  Check,
  Clock3,
  History,
  Loader2,
  Mic,
  Pencil,
  Plus,
  Send,
  Target,
  Trash2,
  Upload,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useConfirm } from '@/hooks/useConfirm'
import { useFeatureFlags } from '@/contexts/FeatureFlagsContext'
import { listPreparations } from '@/lib/prepare-api'
import { JOURNEY_FINISHED_STATUSES } from '@/lib/prepare-types'
import { CoachPrepareCard } from '@/components/coach/CoachPrepareCard'
import { CoachPulseCard } from '@/components/coach/CoachPulseCard'
import { CoachElevateCard } from '@/components/coach/CoachElevateCard'
import { CoachReplayCard } from '@/components/coach/CoachReplayCard'
import { CoachHome } from '@/components/coach/CoachHome'
import { CoachPulseEvidenceCard } from '@/components/coach/CoachPulseEvidenceCard'
import {
  coachElevatePath,
  createCoachThread,
  deleteCoachThread,
  recordCoachAction,
  displayCoachTitle,
  getCoachThread,
  markCoachHomeResultSeen,
  listCoachThreads,
  patchCoachThread,
  saveCoachTurns,
  respondCoach,
  interpretCoachSession,
  briefToElevateParams,
  type CoachThreadSummary,
  type CoachTurnRecord,
  type CoachResponse,
  type CoachHistoryTurn,
  type CoachHomeRecommendation,
  type CoachBrief,
  type CoachModule,
  type CoachPulseEvidence,
} from '@/lib/coach-api'
import { detectCoachIntent, type CoachIntent } from '@/lib/coach-intent'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { USER_BUBBLE } from '@/lib/conversation'
import { explicitFocusAreas, getFocusAreaLabel } from '@/lib/focus-areas'

const INTENTS: Array<{
  id: CoachIntent
  label: string
  icon: typeof Mic
}> = [
  { id: 'progress', label: 'Track progress', icon: BarChart3 },
  { id: 'elevate', label: 'Practice Elevate', icon: Mic },
  { id: 'replay', label: 'Analyse Replay', icon: Upload },
  { id: 'prepare', label: 'Prepare interview', icon: BriefcaseBusiness },
]

const INTENT_WORKSPACE_LABEL: Record<CoachIntent, string> = {
  progress: 'Progress Pulse',
  elevate: 'Elevate',
  replay: 'Replay',
  prepare: 'Prepare',
}

// Page chrome shares the global app frame used by Replay/Prepare/Sessions, while
// the conversation sits in a narrower lane. Both keep padding inside the
// max-width so the header, cards, and composer land on identical edges.
const APP_FRAME = 'mx-auto w-full max-w-6xl px-4 sm:px-6'
const THREAD_LANE = 'mx-auto w-full max-w-[820px] px-4 sm:px-6'

const INTENT_CONFIRM_QUESTION: Record<CoachIntent, string> = {
  progress: 'Review this in Progress Pulse?',
  elevate: 'Practise this live in Elevate?',
  replay: 'Analyse this recording in Replay?',
  prepare: 'Track this in Prepare?',
}

const INTENT_CONFIRM_ACTION: Record<CoachIntent, string> = {
  progress: 'Show my Pulse',
  elevate: 'Start practice',
  replay: 'Analyse recording',
  prepare: 'Open Prepare',
}

type ThreadTurn =
  | { id: string; role: 'user'; text: string; createdAt: string }
  | {
      id: string
      role: 'coach'
      kind: 'confirm'
      answeredIntent?: CoachIntent
      createdAt: string
    }
  | {
      id: string
      role: 'coach'
      kind: 'route-confirm'
      intent: CoachIntent
      answeredIntent?: CoachIntent
      createdAt: string
    }
  | { id: string; role: 'coach'; kind: 'intent'; intent: CoachIntent; createdAt: string }
  | { id: string; role: 'coach'; kind: 'elevate-result'; sessionId: string; createdAt: string }
  | { id: string; role: 'coach'; kind: 'replay-result'; sessionId: string; createdAt: string }
  | {
      id: string
      role: 'coach'
      kind: 'goal-propose'
      suggestedTitle: string
      confirmed?: boolean
      routeAfterConfirm?: boolean
      createdAt: string
    }
  // Model-generated turns. `text` is always Coach's spoken guidance; the extra
  // fields drive the single action or single question attached to it.
  | { id: string; role: 'coach'; kind: 'reply'; text: string; createdAt: string }
  | {
      id: string
      role: 'coach'
      kind: 'clarify'
      text: string
      question: string
      options: string[]
      answered?: boolean
      createdAt: string
    }
  | {
      id: string
      role: 'coach'
      kind: 'recommend'
      text: string
      module: CoachModule
      label: string
      reason: string
      brief: CoachBrief
      evidence?: CoachPulseEvidence | null
      superseded?: boolean
      createdAt: string
    }
  | {
      id: string
      role: 'coach'
      kind: 'pulse-evidence'
      evidence: CoachPulseEvidence
      createdAt: string
    }
  | {
      id: string
      role: 'coach'
      kind: 'result-insight'
      text: string
      sessionId: string
      createdAt: string
    }

const NEXT_ACTION_RE =
  /^(what(?:'?s| is)? next|what next|next step|what should i do(?: next)?)$/i

function isNextActionRequest(text: string) {
  return NEXT_ACTION_RE.test(text.replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim())
}

function newTurnId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function isCoachIntent(value: unknown): value is CoachIntent {
  return value === 'progress' || value === 'elevate' || value === 'replay' || value === 'prepare'
}

function fromRecord(record: CoachTurnRecord): ThreadTurn | null {
  if (record.role === 'user') {
    return {
      id: record.id,
      role: 'user',
      text: record.text || '',
      createdAt: record.createdAt,
    }
  }
  const payload = record.payload || {}
  if (record.kind === 'confirm') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'confirm',
      answeredIntent: isCoachIntent(payload.answeredIntent) ? payload.answeredIntent : undefined,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'route-confirm' && isCoachIntent(payload.intent)) {
    return {
      id: record.id,
      role: 'coach',
      kind: 'route-confirm',
      intent: payload.intent,
      answeredIntent: isCoachIntent(payload.answeredIntent) ? payload.answeredIntent : undefined,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'intent' && isCoachIntent(payload.intent)) {
    return {
      id: record.id,
      role: 'coach',
      kind: 'intent',
      intent: payload.intent,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'elevate-result' && typeof payload.sessionId === 'string') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'elevate-result',
      sessionId: payload.sessionId,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'replay-result' && typeof payload.sessionId === 'string') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'replay-result',
      sessionId: payload.sessionId,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'goal-propose' && typeof payload.suggestedTitle === 'string') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'goal-propose',
      suggestedTitle: payload.suggestedTitle,
      confirmed: payload.confirmed === true,
      routeAfterConfirm: payload.routeAfterConfirm === true,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'reply' && record.text) {
    return { id: record.id, role: 'coach', kind: 'reply', text: record.text, createdAt: record.createdAt }
  }
  if (record.kind === 'clarify' && record.text && typeof payload.question === 'string') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'clarify',
      text: record.text,
      question: payload.question,
      options: Array.isArray(payload.options)
        ? payload.options.filter((item): item is string => typeof item === 'string')
        : [],
      answered: payload.answered === true,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'recommend' && record.text && isCoachModule(payload.module)) {
    return {
      id: record.id,
      role: 'coach',
      kind: 'recommend',
      text: record.text,
      module: payload.module,
      label: typeof payload.label === 'string' ? payload.label : 'Continue',
      reason: typeof payload.reason === 'string' ? payload.reason : '',
      brief: toBrief(payload.brief),
      evidence: toPulseEvidence(payload.evidence),
      superseded: payload.superseded === true,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'pulse-evidence') {
    const evidence = toPulseEvidence(payload.evidence ?? payload)
    if (!evidence) return null
    return {
      id: record.id,
      role: 'coach',
      kind: 'pulse-evidence',
      evidence,
      createdAt: record.createdAt,
    }
  }
  if (record.kind === 'result-insight' && record.text && typeof payload.sessionId === 'string') {
    return {
      id: record.id,
      role: 'coach',
      kind: 'result-insight',
      text: record.text,
      sessionId: payload.sessionId,
      createdAt: record.createdAt,
    }
  }
  return null
}

/**
 * Where a recommendation sends the user. Elevate carries the full brief so the
 * session opens already configured; the others only need the thread so the user
 * can be returned here afterwards.
 */
function recommendationPath(
  module: CoachModule,
  brief: CoachBrief,
  threadId: string | undefined,
): string {
  if (module === 'elevate') {
    return coachElevatePath(briefToElevateParams(brief), threadId)
  }
  const search = new URLSearchParams({ coach: '1' })
  if (threadId) search.set('thread', threadId)
  if (module === 'prepare' && brief.preparationId) {
    if (brief.stageId) search.set('stageId', brief.stageId)
    return `/prepare/interviews/${brief.preparationId}?${search.toString()}`
  }
  if (module === 'replay') {
    search.set('new', 'true')
    if (brief.focusArea) search.set('focus', brief.focusArea)
    if (brief.scenario) search.set('context', brief.scenario)
  }
  const base = module === 'replay' ? '/replay' : module === 'prepare' ? '/prepare' : '/progress'
  return `${base}?${search.toString()}`
}

function isCoachModule(value: unknown): value is CoachModule {
  return value === 'elevate' || value === 'replay' || value === 'prepare' || value === 'progress'
}

function asPulseTrend(
  value: unknown,
): CoachPulseEvidence['skills'][number]['trend'] | null {
  return value === 'up' || value === 'down' || value === 'steady' || value === 'latest'
    ? value
    : null
}

function toPulseEvidence(value: unknown): CoachPulseEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.mode !== 'scores' && raw.mode !== 'relevant') return null
  if (typeof raw.windowDays !== 'number' || typeof raw.measurementCount !== 'number') return null
  if (!Array.isArray(raw.skills)) return null
  const skills = raw.skills.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const skill = item as Record<string, unknown>
    if (typeof skill.skill !== 'string' || typeof skill.score !== 'number') return []
    const trend = asPulseTrend(skill.trend)
    if (!trend) return []
    return [
      {
        skill: skill.skill,
        score: skill.score,
        delta: typeof skill.delta === 'number' ? skill.delta : null,
        measurements: typeof skill.measurements === 'number' ? skill.measurements : 0,
        trend,
      },
    ]
  })
  if (skills.length === 0) return null
  const highlightRaw =
    raw.highlight && typeof raw.highlight === 'object' && !Array.isArray(raw.highlight)
      ? (raw.highlight as Record<string, unknown>)
      : null
  if (
    !highlightRaw ||
    (highlightRaw.kind !== 'strongest' && highlightRaw.kind !== 'highest') ||
    typeof highlightRaw.skill !== 'string'
  ) {
    return null
  }
  const opportunityRaw =
    raw.opportunity && typeof raw.opportunity === 'object' && !Array.isArray(raw.opportunity)
      ? (raw.opportunity as Record<string, unknown>)
      : null
  return {
    mode: raw.mode,
    windowDays: raw.windowDays,
    measurementCount: raw.measurementCount,
    skills,
    highlight: { kind: highlightRaw.kind, skill: highlightRaw.skill },
    opportunity:
      opportunityRaw && typeof opportunityRaw.skill === 'string'
        ? { skill: opportunityRaw.skill }
        : null,
  }
}

function toBrief(value: unknown): CoachBrief {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const str = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : null)
  return {
    focusArea: str('focusArea'),
    scenario: str('scenario'),
    durationSec: typeof raw.durationSec === 'number' ? raw.durationSec : null,
    preparationId: str('preparationId'),
    stageId: str('stageId'),
  }
}

function toRecord(turn: ThreadTurn): CoachTurnRecord {
  if (turn.role === 'user') {
    return {
      id: turn.id,
      role: 'user',
      kind: null,
      text: turn.text,
      payload: null,
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'confirm') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'confirm',
      text: null,
      payload: { answeredIntent: turn.answeredIntent },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'route-confirm') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'route-confirm',
      text: null,
      payload: { intent: turn.intent, answeredIntent: turn.answeredIntent },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'intent') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'intent',
      text: null,
      payload: { intent: turn.intent },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'elevate-result') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'elevate-result',
      text: null,
      payload: { sessionId: turn.sessionId },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'replay-result') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'replay-result',
      text: null,
      payload: { sessionId: turn.sessionId },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'reply') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'reply',
      text: turn.text,
      payload: null,
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'clarify') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'clarify',
      text: turn.text,
      payload: {
        question: turn.question,
        options: turn.options,
        answered: turn.answered === true,
      },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'recommend') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'recommend',
      text: turn.text,
      payload: {
        module: turn.module,
        label: turn.label,
        reason: turn.reason,
        brief: turn.brief as unknown as Record<string, unknown>,
        evidence: turn.evidence ?? null,
        superseded: turn.superseded === true,
      },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'pulse-evidence') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'pulse-evidence',
      text: null,
      payload: { evidence: turn.evidence as unknown as Record<string, unknown> },
      createdAt: turn.createdAt,
    }
  }
  if (turn.kind === 'result-insight') {
    return {
      id: turn.id,
      role: 'coach',
      kind: 'result-insight',
      text: turn.text,
      payload: { sessionId: turn.sessionId },
      createdAt: turn.createdAt,
    }
  }
  return {
    id: turn.id,
    role: 'coach',
    kind: 'goal-propose',
    text: null,
    payload: {
      suggestedTitle: turn.suggestedTitle,
      confirmed: turn.confirmed === true,
      routeAfterConfirm: turn.routeAfterConfirm === true,
    },
    createdAt: turn.createdAt,
  }
}

function mergeSavedTurns(local: ThreadTurn[], saved: CoachTurnRecord[]): ThreadTurn[] {
  const remote = saved
    .map(fromRecord)
    .filter((turn): turn is ThreadTurn => Boolean(turn))
  const remoteIds = new Set(remote.map((turn) => turn.id))
  return [...remote, ...local.filter((turn) => !remoteIds.has(turn.id))]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-40)
}

export function Coach() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const requestedThreadId = searchParams.get('thread')
  const elevateResultParam = searchParams.get('elevateResult')
  const replayResultParam = searchParams.get('replayResult')
  const isHome =
    !requestedThreadId && !elevateResultParam && !replayResultParam
  const { user } = useAuth()
  const confirm = useConfirm()
  const { isAccessible } = useFeatureFlags()
  const [threads, setThreads] = useState<CoachThreadSummary[]>([])
  const [thread, setThread] = useState<CoachThreadSummary | null>(null)
  const [turns, setTurns] = useState<ThreadTurn[]>([])
  const [draft, setDraft] = useState('')
  const [thinking, setThinking] = useState(false)
  const [resultError, setResultError] = useState<string | null>(null)
  const [resultRetryNonce, setResultRetryNonce] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loadingThread, setLoadingThread] = useState(true)
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({})
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [expandedConfirmId, setExpandedConfirmId] = useState<string | null>(null)
  const [historyEditingId, setHistoryEditingId] = useState<string | null>(null)
  const [historyTitleDraft, setHistoryTitleDraft] = useState('')
  const [journeyHint, setJourneyHint] = useState<string | null>(null)
  const [nextIntent, setNextIntent] = useState<CoachIntent>('progress')
  const persistSeq = useRef(0)
  const persistQueuesRef = useRef(new Map<string, Promise<CoachTurnRecord[]>>())
  const threadEndRef = useRef<HTMLDivElement>(null)
  const resultTasksRef = useRef(new Map<string, Promise<ThreadTurn[]>>())
  const resultAttemptsRef = useRef(new Map<string, number>())
  // Set while Home authors a new thread so the URL-driven reload cannot replace
  // the in-memory first exchange with an empty server snapshot.
  const locallyAuthoredThreadIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (isHome || !isAccessible('prepare')) {
      setJourneyHint(null)
      setNextIntent('progress')
      return
    }
    let cancelled = false
    listPreparations()
      .then((journeys) => {
        if (cancelled) return
        const linked = thread?.preparationId
          ? journeys.find((journey) => journey.id === thread.preparationId)
          : null
        const selected =
          linked ??
          journeys
            .filter((journey) => !JOURNEY_FINISHED_STATUSES.includes(journey.status))
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0]
        if (!selected) {
          setJourneyHint(null)
          setNextIntent('progress')
          return
        }
        const next = selected.nextStage ? ` Next round is ${selected.nextStage.name}.` : ''
        setJourneyHint(`You have a ${selected.interview.companyName} journey.${next}`)
        setNextIntent(isAccessible('prepare') ? 'prepare' : 'progress')
      })
      .catch(() => {
        if (!cancelled) {
          setJourneyHint(null)
          setNextIntent('progress')
        }
      })
    return () => {
      cancelled = true
    }
  }, [isAccessible, isHome, thread?.preparationId])

  useEffect(() => {
    let cancelled = false
    if (
      requestedThreadId &&
      locallyAuthoredThreadIdRef.current &&
      requestedThreadId !== locallyAuthoredThreadIdRef.current
    ) {
      locallyAuthoredThreadIdRef.current = null
    }
    async function load() {
      if (requestedThreadId && locallyAuthoredThreadIdRef.current === requestedThreadId) {
        setLoadingThread(false)
        try {
          const { threads: listed } = await listCoachThreads()
          if (!cancelled) setThreads(listed)
        } catch {
          // The transcript is already on screen; a list refresh can wait.
        }
        return
      }
      setLoadingThread(true)
      try {
        const { threads: listed } = await listCoachThreads()
        if (cancelled) return
        setThreads(listed)
        const requested = requestedThreadId
        const returningWithResult = Boolean(elevateResultParam) || Boolean(replayResultParam)
        if (!requested && !returningWithResult) {
          setThread(null)
          setTurns([])
          return
        }
        if (!requested && returningWithResult) {
          setThread(null)
          setTurns([])
          const nextParams = new URLSearchParams(searchParams)
          nextParams.delete('elevateResult')
          nextParams.delete('replayResult')
          setSearchParams(nextParams, { replace: true })
          return
        }
        let selected = requested
          ? listed.find((item) => item.id === requested)
          : undefined
        if (requested && !selected) {
          setThread(null)
          setTurns([])
          const nextParams = new URLSearchParams(searchParams)
          nextParams.delete('thread')
          setSearchParams(nextParams, { replace: true })
          return
        }
        if (!selected) {
          const created = await createCoachThread()
          selected = created.thread
          setThreads([created.thread, ...listed])
          setThread(created.thread)
          setTurns([])
        } else {
          const detail = await getCoachThread(selected.id)
          if (cancelled) return
          const loadedTurns = detail.turns
            .map(fromRecord)
            .filter((turn): turn is ThreadTurn => Boolean(turn))
          setThread(detail.thread)
          setTurns(loadedTurns.slice(-40))
        }
        if (!requested) {
          const nextParams = new URLSearchParams(searchParams)
          nextParams.set('thread', selected.id)
          setSearchParams(nextParams, { replace: true })
        }
      } catch {
        if (!cancelled) {
          setThread(null)
          setTurns([])
        }
      } finally {
        if (!cancelled) setLoadingThread(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
    // Search keys determine whether Coach is Home or an explicit conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    requestedThreadId,
    elevateResultParam,
    replayResultParam,
  ])

  useEffect(() => {
    const elevateResult = elevateResultParam
    const replayResult = replayResultParam
    const completedSessionId = elevateResult || replayResult
    if (!completedSessionId || !thread || loadingThread) return
    const currentThread = thread
    const sessionId = completedSessionId
    const resultModule = replayResult ? 'replay' : 'elevate'
    const resultKind = replayResult ? 'replay-result' : 'elevate-result'
    const resultParam = replayResult ? 'replayResult' : 'elevateResult'
    let active = true
    const taskKey = `${currentThread.id}:${resultModule}:${sessionId}`

    async function buildResultTurns() {
      const resultTurn: ThreadTurn =
        resultKind === 'replay-result'
          ? {
              id: newTurnId(),
              role: 'coach',
              kind: 'replay-result',
              sessionId,
              createdAt: nowIso(),
            }
          : {
              id: newTurnId(),
              role: 'coach',
              kind: 'elevate-result',
              sessionId,
              createdAt: nowIso(),
            }
      const resultExists = turns.some(
        (turn) =>
          turn.role === 'coach' &&
          turn.kind === resultKind &&
          turn.sessionId === sessionId,
      )
      const insightExists = turns.some(
        (turn) =>
          turn.role === 'coach' &&
          turn.kind === 'result-insight' &&
          turn.sessionId === sessionId,
      )
      const nextTurns: ThreadTurn[] = resultExists
        ? turns
        : [...turns, resultTurn].slice(-40)

      // The return loop: the result card shows the numbers, Coach says what they
      // mean for the goal. Skipped silently if the model has nothing to add.
      if (insightExists) return nextTurns
      try {
        const insight = await interpretCoachSession(currentThread.id, {
          sessionId,
          module: resultModule,
        })
        if (!insight) return nextTurns
        if (insight.goalTitle && !currentThread.title) {
          try {
            const updated = await patchCoachThread(currentThread.id, {
              title: insight.goalTitle,
            })
            setThread(updated.thread)
            setThreads((current) =>
              current.map((item) => (item.id === updated.thread.id ? updated.thread : item)),
            )
          } catch (error) {
            console.error('save result-derived goal title', error)
          }
        }
        const insightTurns: ThreadTurn[] = insight.clarify
          ? [
              {
                id: newTurnId(),
                role: 'coach',
                kind: 'clarify',
                text: insight.reply,
                question: insight.clarify.question,
                options: insight.clarify.options,
                createdAt: nowIso(),
              },
            ]
          : [
              {
                id: newTurnId(),
                role: 'coach',
                kind: 'result-insight',
                text: insight.reply,
                sessionId,
                createdAt: nowIso(),
              },
            ]
        if (
          insight.recommend &&
          availableIntents.some((intent) => intent.id === insight.recommend?.module)
        ) {
          const rec = insight.recommend
          insightTurns.push({
            id: newTurnId(),
            role: 'coach',
            kind: 'recommend',
            text: rec.reason,
            module: rec.module,
            label: rec.label,
            reason: '',
            brief: rec.brief,
            createdAt: nowIso(),
          })
        }
        return [...nextTurns, ...insightTurns].slice(-40)
      } catch (error) {
        console.error('coach interpret', error)
        return nextTurns
      }
    }

    let task = resultTasksRef.current.get(taskKey)
    if (!task) {
      resultAttemptsRef.current.set(taskKey, (resultAttemptsRef.current.get(taskKey) ?? 0) + 1)
      task = buildResultTurns().then(async (nextTurns) => {
        const saved = await queueTurnSave(currentThread.id, nextTurns)
        return mergeSavedTurns(nextTurns, saved)
      })
      resultTasksRef.current.set(taskKey, task)
    }
    setResultError(null)
    setThinking(true)
    void task
      .then((nextTurns) => {
        if (!active) return
        resultTasksRef.current.delete(taskKey)
        resultAttemptsRef.current.delete(taskKey)
        setTurns((current) => mergeSavedTurns(current, nextTurns.map(toRecord)))
        void markCoachHomeResultSeen(resultModule, sessionId).catch((error) =>
          console.warn('mark attached Coach result seen', error),
        )
        const nextParams = new URLSearchParams(searchParams)
        nextParams.delete(resultParam)
        setSearchParams(nextParams, { replace: true })
      })
      .catch((error) => {
        resultTasksRef.current.delete(taskKey)
        console.error('save coach result turns', error)
        if (!active) return
        if ((resultAttemptsRef.current.get(taskKey) ?? 0) < 2) {
          setResultRetryNonce((value) => value + 1)
        } else {
          setResultError('Coach could not attach this result. Retry to keep it with this goal.')
        }
      })
      .finally(() => {
        if (active) setThinking(false)
      })

    return () => {
      active = false
    }
    // `turns` is intentionally a snapshot. The shared promise makes this safe
    // under React StrictMode and prevents state updates from restarting the task.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevateResultParam, loadingThread, replayResultParam, resultRetryNonce, thread?.id])

  async function queueTurnSave(threadId: string, next: ThreadTurn[]) {
    const previous = persistQueuesRef.current.get(threadId)
    const request = (previous ?? Promise.resolve([]))
      .catch(() => [])
      .then(async () => (await saveCoachTurns(threadId, next.map(toRecord))).turns)
    persistQueuesRef.current.set(threadId, request)
    try {
      return await request
    } finally {
      if (persistQueuesRef.current.get(threadId) === request) {
        persistQueuesRef.current.delete(threadId)
      }
    }
  }

  async function persistTurns(threadId: string, next: ThreadTurn[]) {
    const seq = ++persistSeq.current
    setTurns(next)
    const saved = await queueTurnSave(threadId, next)
    if (seq === persistSeq.current) {
      setTurns((current) => mergeSavedTurns(current, saved))
      setThreads((current) =>
        current
          .map((item) =>
            item.id === threadId ? { ...item, updatedAt: nowIso() } : item,
          )
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      )
    }
  }

  const availableIntents = useMemo(
    () =>
      INTENTS.filter((intent) => {
        if (intent.id === 'elevate') return isAccessible('elevate')
        if (intent.id === 'replay') return isAccessible('replay')
        if (intent.id === 'prepare') return isAccessible('prepare')
        return true
      }),
    [isAccessible],
  )

  const lastActionTurn = [...turns]
    .reverse()
    .find(
      (
        turn,
      ): turn is Extract<
        ThreadTurn,
        { kind: 'intent' | 'elevate-result' | 'replay-result' }
      > =>
        turn.role === 'coach' &&
        (turn.kind === 'intent' ||
          turn.kind === 'elevate-result' ||
          turn.kind === 'replay-result'),
    )
  const firstName =
    user?.firstName && user.firstName.toLowerCase() !== 'admin'
      ? user.firstName
      : user?.email.split('@')[0] ?? 'there'
  const namedGoal = Boolean(thread?.title?.trim())
  const activeGoals = threads.filter((item) => item.status === 'active')
  const recentGoals = threads.filter((item) => item.status !== 'active')

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' })
  }, [turns])

  function confirmIntent(turnId: string, intent: CoachIntent) {
    if (!thread) return
    const target = turns.find((turn) => turn.id === turnId)
    if (!target || target.role !== 'coach') return
    if (target.kind !== 'confirm' && target.kind !== 'route-confirm') return
    if (target.answeredIntent) return
    const next: ThreadTurn[] = [
      ...turns.map<ThreadTurn>((turn) =>
        turn.id === turnId &&
        turn.role === 'coach' &&
        (turn.kind === 'confirm' || turn.kind === 'route-confirm')
          ? { ...turn, answeredIntent: intent }
          : turn,
      ),
      { id: newTurnId(), role: 'coach', kind: 'intent', intent, createdAt: nowIso() },
    ]
    void persistTurns(thread.id, next.slice(-40))
  }

  /** Rule-based routing. Used when the model is unavailable or returns nothing usable. */
  function fallbackTurns(
    request: string,
    currentThread: CoachThreadSummary | null = thread,
    currentTurns: ThreadTurn[] = turns,
  ): ThreadTurn[] {
    const explicitFocuses = explicitFocusAreas(request)
    const isWhy = /^(?:why|how (?:does|will|would|is|are|can))\b/i.test(request)
    const isUncertain =
      /^(?:i\s+(?:do not|don't|dont)\s+know|not\s+sure|no\s+idea|unsure)[.!?]*$/i.test(
        request,
      )
    const isExploratory =
      /\b(?:what|which|any)\b.{0,24}\b(?:options?|areas?|choices?)\b/i.test(request)

    if (isWhy) {
      const previous = [...currentTurns]
        .reverse()
        .find(
          (turn): turn is Extract<ThreadTurn, { kind: 'recommend' }> =>
            turn.role === 'coach' && turn.kind === 'recommend' && !turn.superseded,
        )
      const requested = explicitFocuses.find((focus) => focus !== previous?.brief.focusArea)
      const text =
        previous && requested
          ? `${getFocusAreaLabel(previous.brief.focusArea ?? '').replace(' & Speed', '')} was not the most direct match for ${getFocusAreaLabel(requested).toLowerCase()}. ${getFocusAreaLabel(requested)} should be practised directly.`
          : previous
            ? `That suggestion was intended to practise ${getFocusAreaLabel(previous.brief.focusArea ?? '').toLowerCase()}. If that is not the outcome you want, tell me the skill that matters more and I’ll change the focus.`
            : 'Tell me which suggestion you want explained and I’ll give you the reasoning.'
      return [{ id: newTurnId(), role: 'coach', kind: 'reply', text, createdAt: nowIso() }]
    }

    if (isExploratory) {
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'reply',
          text:
            'You can work on clarity, confidence, filler words, pacing, conciseness, structure, or engagement. Tell me which outcome matters most and I’ll recommend the right practice.',
          createdAt: nowIso(),
        },
      ]
    }

    if (explicitFocuses.length > 1) {
      const options = explicitFocuses.map(getFocusAreaLabel)
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'clarify',
          text: `${options.join(' and ')} are separate practice focuses.`,
          question: 'Which would you like to focus on first?',
          options,
          createdAt: nowIso(),
        },
      ]
    }

    if (isUncertain && currentTurns.length === 0) {
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'recommend',
          text:
            'No problem. Start with a Communication Snapshot: answer three short questions and I’ll identify the most useful area to practise.',
          module: 'elevate',
          label: 'Start Communication Snapshot',
          reason: '3 questions · about 3 minutes',
          brief: {
            focusArea: 'snapshot',
            scenario: 'Establish a broad communication baseline.',
            durationSec: 180,
            preparationId: null,
            stageId: null,
          },
          createdAt: nowIso(),
        },
      ]
    }

    if (explicitFocuses.length === 1) {
      const focus = explicitFocuses[0]
      const label = getFocusAreaLabel(focus).replace(' & Speed', '').toLowerCase()
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'recommend',
          text: `${getFocusAreaLabel(focus)} is the focus you named. Elevate will practise it directly.`,
          module: 'elevate',
          label: `Practise ${label} in Elevate`,
          reason: `This practice directly targets ${label}.`,
          brief: {
            focusArea: focus,
            scenario: request,
            durationSec: null,
            preparationId: null,
            stageId: null,
          },
          createdAt: nowIso(),
        },
      ]
    }

    const detected = isNextActionRequest(request) ? nextIntent : detectCoachIntent(request)
    const module = availableIntents.some((item) => item.id === detected) ? detected : null
    if (!module) {
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'clarify',
          text: 'I’ll choose the most useful next step once I understand the outcome.',
          question: 'What are you preparing for, and when do you need it?',
          options: [],
          createdAt: nowIso(),
        },
      ]
    }

    const isBaseline =
      module === 'elevate' && /\b(assess|assessment|baseline|overall|communication)\b/i.test(request)
    const content: Record<CoachModule, { text: string; label: string }> = {
      elevate: isBaseline
        ? {
            text:
              'A Communication Snapshot is the best next step. Three short questions will cover clarity, pace, confidence, and filler words together, then I can choose the strongest practice focus.',
            label: 'Start Communication Snapshot',
          }
        : {
            text:
              'Live practice is the most useful next step. I’ll carry this context into Elevate so you can work on the task, not configure a workflow.',
            label: 'Practise in Elevate',
          },
      replay: {
        text:
          'The recording gives us real evidence, so I recommend analysing it before choosing what to practise next.',
        label: 'Analyse recording',
      },
      prepare: {
        text:
          'Your interview journey is the right continuity point. I recommend opening it and working from the next round.',
        label: 'Open journey',
      },
      progress: {
        text:
          'Your tracked outcomes will show whether to continue the current focus or change it. I recommend reviewing that evidence first.',
        label: 'Review progress',
      },
    }
    const selected = content[module]
    return [
      {
        id: newTurnId(),
        role: 'coach',
        kind: 'recommend',
        text: selected.text,
        module,
        label: selected.label,
        // Snapshot is the one bounded format, so it is the only place we quote a length.
        reason: isBaseline ? '3 questions · about 3 minutes' : '',
        brief: {
          focusArea: isBaseline ? 'snapshot' : null,
          scenario: module === 'elevate' ? request : null,
          durationSec: isBaseline ? 180 : null,
          preparationId: module === 'prepare' ? currentThread?.preparationId ?? null : null,
          stageId: null,
        },
        createdAt: nowIso(),
      },
    ]
  }

  function coachTurnsFrom(response: CoachResponse): ThreadTurn[] {
    if (response.clarify) {
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'clarify',
          text: response.reply,
          question: response.clarify.question,
          options: response.clarify.options,
          createdAt: nowIso(),
        },
      ]
    }
    if (response.recommend && availableIntents.some((i) => i.id === response.recommend!.module)) {
      const rec = response.recommend
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'recommend',
          text: response.reply,
          module: rec.module,
          label: rec.label,
          reason: rec.reason,
          brief: rec.brief,
          evidence: response.evidence,
          createdAt: nowIso(),
        },
      ]
    }
    if (response.evidence) {
      return [
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'reply',
          text: response.reply,
          createdAt: nowIso(),
        },
        {
          id: newTurnId(),
          role: 'coach',
          kind: 'pulse-evidence',
          evidence: response.evidence,
          createdAt: nowIso(),
        },
      ]
    }
    return [
      { id: newTurnId(), role: 'coach', kind: 'reply', text: response.reply, createdAt: nowIso() },
    ]
  }

  /** Flat transcript of the thread so Coach can resolve follow-ups against it. */
  function historyFor(current: ThreadTurn[]): CoachHistoryTurn[] {
    return current.flatMap<CoachHistoryTurn>((turn) => {
      if (turn.role === 'user') return [{ role: 'user', text: turn.text }]
      if (turn.kind === 'recommend') {
        return [
          {
            role: 'coach',
            text: `${turn.text} Recommendation shown: ${turn.label}. Reason shown: ${turn.reason || 'none'}.`,
          },
        ]
      }
      if (
        turn.kind === 'reply' ||
        turn.kind === 'clarify' ||
        turn.kind === 'result-insight'
      ) {
        return [{ role: 'coach', text: turn.text }]
      }
      return []
    })
  }

  async function recordRecommendation(module: CoachModule) {
    if (!thread) return
    // Session workspaces record the launch once they own a real target id.
    if (module === 'elevate' || module === 'replay') return
    try {
      await recordCoachAction(thread.id, { module, action: 'launch' })
    } catch (error) {
      // Losing the breadcrumb must not block the launch the user just clicked.
      console.error('record coach action', error)
    }
  }

  /** Swaps a recommendation for a different workspace, shown in-thread as a card. */
  function chooseAlternative(intent: CoachIntent) {
    if (!thread) return
    const next: ThreadTurn[] = [
      ...turns.map<ThreadTurn>((turn) =>
        turn.role === 'coach' && turn.kind === 'recommend' && turn.id === expandedConfirmId
          ? { ...turn, superseded: true }
          : turn,
      ),
      { id: newTurnId(), role: 'coach', kind: 'intent', intent, createdAt: nowIso() },
    ]
    setExpandedConfirmId(null)
    void persistTurns(thread.id, next.slice(-40))
  }

  async function commitRequestForThread(
    currentThread: CoachThreadSummary,
    currentTurns: ThreadTurn[],
    explicitMessage: string,
  ) {
    const request = explicitMessage.trim()
    if (!request || thinking) return

    const userTurn: ThreadTurn = {
      id: newTurnId(),
      role: 'user',
      text: request,
      createdAt: nowIso(),
    }
    const answeringClarification = currentTurns.some(
      (turn) => turn.role === 'coach' && turn.kind === 'clarify' && !turn.answered,
    )
    // Show the user's message immediately; Coach's reply lands when the model returns.
    const withUser = [...currentTurns, userTurn].map<ThreadTurn>((turn) =>
      turn.role === 'coach' && turn.kind === 'clarify' && !turn.answered
        ? { ...turn, answered: true }
        : turn,
    )
    setTurns(withUser)
    setDraft('')
    setThinking(true)

    let coachTurns: ThreadTurn[]
    try {
      const response = await respondCoach(currentThread.id, {
        message: request,
        history: historyFor(currentTurns),
        answeringClarification,
      })
      const recommendedPreparationId = response?.recommend?.brief.preparationId
      if (
        recommendedPreparationId &&
        recommendedPreparationId !== currentThread.preparationId
      ) {
        setThread((current) =>
          current?.id === currentThread.id
            ? { ...current, preparationId: recommendedPreparationId }
            : current,
        )
        setThreads((current) =>
          current.map((item) =>
            item.id === currentThread.id
              ? { ...item, preparationId: recommendedPreparationId }
              : item,
          ),
        )
      }
      if (
        response?.goalTitle &&
        response.goalTitle.trim() !== currentThread.title?.trim()
      ) {
        try {
          const updated = await patchCoachThread(currentThread.id, {
            title: response.goalTitle,
            focusArea:
              response.recommend?.brief.focusArea === 'snapshot'
                ? null
                : response.recommend?.brief.focusArea ?? currentThread.focusArea,
          })
          setThread(updated.thread)
          setThreads((current) =>
            current.map((item) => (item.id === updated.thread.id ? updated.thread : item)),
          )
        } catch (error) {
          // A title is continuity metadata; failing to save it must not replace
          // a useful coaching response with the rule-based fallback.
          console.error('save coach goal title', error)
        }
      }
      coachTurns = response
        ? coachTurnsFrom(response)
        : fallbackTurns(request, currentThread, currentTurns)
    } catch (error) {
      console.error('coach respond', error)
      coachTurns = fallbackTurns(request, currentThread, currentTurns)
    } finally {
      setThinking(false)
    }

    await persistTurns(currentThread.id, [...withUser, ...coachTurns].slice(-40))
  }

  async function commitRequest(explicitMessage?: string) {
    if (!thread) return
    const request = (explicitMessage ?? draft).trim()
    if (!request) return
    await commitRequestForThread(thread, turns, request)
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    void commitRequest()
  }

  async function confirmGoal(turnId: string, title: string) {
    if (!thread) return
    const proposal = turns.find(
      (turn): turn is Extract<ThreadTurn, { kind: 'goal-propose' }> =>
        turn.id === turnId && turn.role === 'coach' && turn.kind === 'goal-propose',
    )
    if (!proposal) return
    const confirmedTitle = title.trim().slice(0, 60)
    if (!confirmedTitle) return
    const updated = await patchCoachThread(thread.id, { title: confirmedTitle })
    setThread(updated.thread)
    setThreads((current) =>
      current.map((item) => (item.id === updated.thread.id ? updated.thread : item)),
    )
    const next = turns.map<ThreadTurn>((turn) =>
      turn.id === turnId && turn.role === 'coach' && turn.kind === 'goal-propose'
        ? { ...turn, suggestedTitle: confirmedTitle, confirmed: true }
        : turn,
    )
    const lastUser = [...turns].reverse().find((turn) => turn.role === 'user')
    const routedIntent =
      lastUser && lastUser.role === 'user' ? detectCoachIntent(lastUser.text) : null
    if (
      proposal.routeAfterConfirm &&
      routedIntent &&
      availableIntents.some((item) => item.id === routedIntent) &&
      !next.some(
        (turn) =>
          turn.role === 'coach' &&
          turn.kind === 'route-confirm' &&
          turn.intent === routedIntent &&
          !turn.answeredIntent,
      ) &&
      !next.some(
        (turn) =>
          turn.role === 'coach' &&
          turn.kind === 'intent' &&
          turn.intent === routedIntent,
      )
    ) {
      next.push({
        id: newTurnId(),
        role: 'coach',
        kind: 'route-confirm',
        intent: routedIntent,
        createdAt: nowIso(),
      })
    }
    setEditingTitleId(null)
    void persistTurns(thread.id, next.slice(-40))
  }

  async function startNewThread() {
    // Reuse an untouched draft instead of accumulating empty server threads
    // when New thread is clicked repeatedly.
    if (thread && !thread.title && turns.length === 0) {
      setDraft('')
      setHistoryOpen(false)
      return
    }
    const created = await createCoachThread()
    setThreads((current) => [created.thread, ...current])
    setThread(created.thread)
    setTurns([])
    setHistoryOpen(false)
    const nextParams = new URLSearchParams()
    nextParams.set('thread', created.thread.id)
    setSearchParams(nextParams)
  }

  function openThread(id: string) {
    setHistoryOpen(false)
    const nextParams = new URLSearchParams()
    nextParams.set('thread', id)
    setSearchParams(nextParams)
  }

  async function startHomeConversation(message: string) {
    const created = await createCoachThread()
    setThreads((current) => [created.thread, ...current])
    setThread(created.thread)
    locallyAuthoredThreadIdRef.current = created.thread.id
    // Persist the first exchange before leaving Home. Changing ?thread= first
    // would reload this thread while it is still empty and wipe the message.
    await commitRequestForThread(created.thread, [], message)
    const nextParams = new URLSearchParams()
    nextParams.set('thread', created.thread.id)
    setSearchParams(nextParams)
  }

  async function ensureHomeRecommendationThread(
    recommendation: Extract<
      CoachHomeRecommendation,
      { kind: 'prepare' | 'pulse' }
    >,
  ): Promise<string> {
    if (recommendation.threadId) return recommendation.threadId
    const created = await createCoachThread(
      recommendation.goalTitle,
      recommendation.kind === 'pulse' ? recommendation.skill : null,
    )
    let createdThread = created.thread
    if (recommendation.kind === 'prepare') {
      const linked = await patchCoachThread(created.thread.id, {
        preparationId: recommendation.preparationId,
      })
      createdThread = linked.thread
    }
    setThreads((current) => [createdThread, ...current])
    return createdThread.id
  }

  async function openHomePrimary(recommendation: CoachHomeRecommendation) {
    if (recommendation.kind === 'resume') {
      openThread(recommendation.threadId)
      return
    }
    if (recommendation.kind === 'live-resume') {
      if (!isAccessible('elevate')) throw new Error('Elevate is not currently available.')
      const search = new URLSearchParams({
        session: recommendation.targetId,
        coach: '1',
      })
      if (recommendation.threadId) search.set('thread', recommendation.threadId)
      navigate(`/elevate?${search.toString()}`)
      return
    }
    if (recommendation.kind === 'result') {
      if (!isAccessible(recommendation.module)) {
        throw new Error(
          `${recommendation.module === 'replay' ? 'Replay' : 'Elevate'} is not currently available.`,
        )
      }
      const search = new URLSearchParams({ coach: '1' })
      if (recommendation.threadId) search.set('thread', recommendation.threadId)
      navigate(
        recommendation.module === 'replay'
          ? `/replay/${encodeURIComponent(recommendation.targetId)}?${search.toString()}`
          : `/elevate?session=${encodeURIComponent(recommendation.targetId)}&${search.toString()}`,
      )
      return
    }
    if (recommendation.kind === 'onboarding') return
    if (recommendation.kind === 'pulse' && !recommendation.practiceAvailable) {
      navigate('/progress')
      return
    }
    if (!isAccessible('elevate')) throw new Error('Elevate is not currently available.')

    const threadId = await ensureHomeRecommendationThread(recommendation)
    // Elevate is not time-boxed, so no duration is briefed here. The focus area
    // already selects the designed exercise on the Elevate side.
    const brief: CoachBrief =
      recommendation.kind === 'prepare'
        ? {
            focusArea: null,
            scenario: recommendation.scenario,
            durationSec: null,
            preparationId: recommendation.preparationId,
            stageId: recommendation.stageId,
          }
        : {
            focusArea: recommendation.skill,
            scenario: `Focused practice for ${recommendation.skill.replace(/_/g, ' ')}.`,
            durationSec: null,
            preparationId: null,
            stageId: null,
          }
    navigate(coachElevatePath(briefToElevateParams(brief), threadId))
  }

  async function openHomeSecondary(recommendation: CoachHomeRecommendation) {
    if (recommendation.kind !== 'prepare' && recommendation.kind !== 'pulse') return
    if (recommendation.kind === 'prepare' && !isAccessible('prepare')) {
      throw new Error('Prepare is not currently available.')
    }
    const search = new URLSearchParams({ coach: '1' })
    if (recommendation.threadId) search.set('thread', recommendation.threadId)
    navigate(
      recommendation.kind === 'prepare'
        ? `/prepare/interviews/${recommendation.preparationId}?${search.toString()}`
        : `/progress?${search.toString()}`,
    )
  }

  async function archiveThread(id: string) {
    const updated = await patchCoachThread(id, { status: 'archived' })
    setThreads((current) =>
      current.map((item) => (item.id === updated.thread.id ? updated.thread : item)),
    )
    if (thread?.id === id) {
      setThread(null)
      setTurns([])
      setSearchParams(new URLSearchParams())
    }
  }

  function beginHistoryRename(item: CoachThreadSummary) {
    setHistoryEditingId(item.id)
    setHistoryTitleDraft(item.title?.trim() || '')
  }

  async function saveHistoryTitle(id: string) {
    const title = historyTitleDraft.trim().slice(0, 60)
    if (!title) return
    const { thread: updated } = await patchCoachThread(id, { title })
    setThreads((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    )
    if (thread?.id === id) setThread(updated)
    setHistoryEditingId(null)
    setHistoryTitleDraft('')
  }

  async function deleteHistoryThread(item: CoachThreadSummary) {
    const ok = await confirm({
      title: 'Delete coaching goal?',
      description: `Delete “${displayCoachTitle(item.title)}” and its Coach history? Linked sessions and module data will not be deleted.`,
      confirmLabel: 'Delete goal',
      variant: 'destructive',
    })
    if (!ok) return

    await deleteCoachThread(item.id)
    const remaining = threads.filter((candidate) => candidate.id !== item.id)
    setThreads(remaining)
    if (historyEditingId === item.id) {
      setHistoryEditingId(null)
      setHistoryTitleDraft('')
    }
    if (thread?.id !== item.id) return

    setThread(null)
    setTurns([])
    setSearchParams(new URLSearchParams())
  }

  return (
    <main className="flex h-[calc(100dvh-var(--app-nav-h,4rem))] flex-col">
      <header className="shrink-0 border-b bg-background/80 backdrop-blur">
        <div className={cn(APP_FRAME, 'flex flex-wrap items-end justify-between gap-3 py-4')}>
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Coach
            </p>
            <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight sm:text-xl">
              {isHome
                ? 'Start with Coach'
                : namedGoal
                  ? displayCoachTitle(thread?.title)
                  : `What shall we do today, ${firstName}?`}
            </h1>
            {!isHome && journeyHint && (
              <p className="mt-0.5 truncate text-sm text-muted-foreground">{journeyHint}</p>
            )}
          </div>
          {(!isHome || threads.length > 0) && (
            <div className="flex shrink-0 gap-1">
              {!isHome && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void startNewThread()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  New topic
                </Button>
              )}
              {threads.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setHistoryOpen(true)}
                >
                  <History className="h-3.5 w-3.5" />
                  Goals
                </Button>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
        {isHome ? (
          <CoachHome
            onPrimary={openHomePrimary}
            onSecondary={openHomeSecondary}
            onAsk={startHomeConversation}
          />
        ) : (
          <div className={cn(THREAD_LANE, 'space-y-5 py-6')}>
          {turns.length === 0 && (
            <p className="max-w-[80%] text-sm leading-relaxed">
              What would you like to get better at—or prepare for?
            </p>
          )}

          {loadingThread && (
            <p className="text-sm text-muted-foreground">Loading your coaching goals…</p>
          )}

          {turns.map((turn) => {
            if (turn.role === 'user') {
              return (
                <div
                  key={turn.id}
                  className={cn(
                    'ml-auto w-fit max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm',
                    USER_BUBBLE,
                  )}
                >
                  {turn.text}
                </div>
              )
            }
            if (turn.kind === 'goal-propose') {
              const draftTitle = titleDrafts[turn.id] ?? turn.suggestedTitle
              if (turn.confirmed) {
                return (
                  <p
                    key={turn.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Target className="h-3.5 w-3.5" />
                    Goal set: {turn.suggestedTitle}
                  </p>
                )
              }
              return (
                <div key={turn.id} className="space-y-2.5">
                  <p className="text-sm">
                    Create a coaching goal called “{turn.suggestedTitle}”?
                  </p>
                  {editingTitleId === turn.id && (
                    <Input
                      value={draftTitle}
                      onChange={(event) =>
                        setTitleDrafts((current) => ({
                          ...current,
                          [turn.id]: event.target.value,
                        }))
                      }
                      maxLength={60}
                      className="max-w-sm"
                      aria-label="Goal title"
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <Button type="button" size="sm" onClick={() => void confirmGoal(turn.id, draftTitle)}>
                      Create
                    </Button>
                    <button
                      type="button"
                      className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      onClick={() => setEditingTitleId(turn.id)}
                    >
                      Edit title
                    </button>
                  </div>
                </div>
              )
            }
            if (turn.kind === 'reply') {
              return (
                <p key={turn.id} className="max-w-[80%] text-sm leading-relaxed">
                  {turn.text}
                </p>
              )
            }
            if (turn.kind === 'result-insight') {
              return (
                <p key={turn.id} className="max-w-[80%] text-sm leading-relaxed">
                  {turn.text}
                </p>
              )
            }
            if (turn.kind === 'clarify') {
              return (
                <div key={turn.id} className="space-y-2.5">
                  <p className="max-w-[80%] text-sm leading-relaxed">{turn.text}</p>
                  <p className="max-w-[80%] text-sm font-medium">{turn.question}</p>
                  {!turn.answered && turn.options.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {turn.options.map((option) => (
                        <Button
                          key={option}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full"
                          disabled={thinking}
                          onClick={() => void commitRequest(option)}
                        >
                          {option}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            if (turn.kind === 'recommend') {
              if (turn.superseded) {
                return (
                  <p key={turn.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3.5 w-3.5" />
                    Changed from {INTENT_WORKSPACE_LABEL[turn.module]}
                  </p>
                )
              }
              return (
                <div key={turn.id} className="space-y-2.5">
                  <p className="max-w-[80%] text-sm leading-relaxed">{turn.text}</p>
                  {turn.evidence ? (
                    <CoachPulseEvidenceCard
                      evidence={turn.evidence}
                      threadId={thread?.id}
                      showPulseLink={turn.module !== 'progress'}
                      primary={{
                        label: turn.label,
                        to: recommendationPath(turn.module, turn.brief, thread?.id),
                        onClick: () => void recordRecommendation(turn.module),
                      }}
                    />
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button asChild size="sm">
                          <Link
                            to={recommendationPath(turn.module, turn.brief, thread?.id)}
                            onClick={() => void recordRecommendation(turn.module)}
                          >
                            {turn.label}
                          </Link>
                        </Button>
                        <button
                          type="button"
                          className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          onClick={() =>
                            setExpandedConfirmId(expandedConfirmId === turn.id ? null : turn.id)
                          }
                        >
                          Change workspace
                        </button>
                      </div>
                      {turn.reason && (
                        <p className="max-w-[80%] text-xs text-muted-foreground">{turn.reason}</p>
                      )}
                      {expandedConfirmId === turn.id && (
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {availableIntents
                            .filter((intent) => intent.id !== turn.module)
                            .map((intent) => (
                              <Button
                                key={intent.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => chooseAlternative(intent.id)}
                              >
                                {intent.label}
                              </Button>
                            ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            }
            if (turn.kind === 'pulse-evidence') {
              return (
                <CoachPulseEvidenceCard
                  key={turn.id}
                  evidence={turn.evidence}
                  threadId={thread?.id}
                />
              )
            }
            if (turn.kind === 'confirm' || turn.kind === 'route-confirm') {
              const suggestedIntent =
                turn.kind === 'route-confirm'
                  ? availableIntents.find((intent) => intent.id === turn.intent)
                  : null
              const answeredIntent = turn.answeredIntent
                ? INTENTS.find((intent) => intent.id === turn.answeredIntent)
                : null
              if (answeredIntent) {
                return (
                  <p
                    key={turn.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Check className="h-3.5 w-3.5" />
                    Chose {INTENT_WORKSPACE_LABEL[answeredIntent.id]}
                  </p>
                )
              }
              // A detected workspace gets one decisive action; the alternatives
              // stay behind "Change workspace" so Coach doesn't read as undecided.
              if (suggestedIntent) {
                const showingAlternatives = expandedConfirmId === turn.id
                return (
                  <div key={turn.id} className="space-y-2.5">
                    <p className="text-sm">
                      {INTENT_CONFIRM_QUESTION[suggestedIntent.id]}
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => confirmIntent(turn.id, suggestedIntent.id)}
                      >
                        {INTENT_CONFIRM_ACTION[suggestedIntent.id]}
                      </Button>
                      <button
                        type="button"
                        className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        onClick={() =>
                          setExpandedConfirmId(showingAlternatives ? null : turn.id)
                        }
                      >
                        Change workspace
                      </button>
                    </div>
                    {showingAlternatives && (
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        {availableIntents
                          .filter((intent) => intent.id !== suggestedIntent.id)
                          .map((intent) => (
                            <Button
                              key={intent.id}
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => confirmIntent(turn.id, intent.id)}
                            >
                              {intent.label}
                            </Button>
                          ))}
                      </div>
                    )}
                  </div>
                )
              }
              return (
                <div key={turn.id} className="space-y-2.5">
                  <p className="text-sm">Which workspace should help with this?</p>
                  <div className="flex flex-wrap gap-2">
                    {availableIntents.map((intent) => (
                      <Button
                        key={intent.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => confirmIntent(turn.id, intent.id)}
                      >
                        {intent.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )
            }
            if (turn.kind === 'elevate-result') {
              if (turn.id !== lastActionTurn?.id) {
                return (
                  <p
                    key={turn.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Mic className="h-3.5 w-3.5" />
                    Earlier Elevate result
                  </p>
                )
              }
              return (
                <CoachElevateCard
                  key={turn.id}
                  userId={user?.id}
                  sessionId={turn.sessionId}
                  threadId={thread?.id}
                />
              )
            }
            if (turn.kind === 'replay-result') {
              if (turn.id !== lastActionTurn?.id) {
                return (
                  <p
                    key={turn.id}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Earlier Replay result
                  </p>
                )
              }
              return (
                <CoachReplayCard
                  key={turn.id}
                  sessionId={turn.sessionId}
                  threadId={thread?.id}
                />
              )
            }
            if (turn.id !== lastActionTurn?.id) {
              const previous = INTENTS.find((intent) => intent.id === turn.intent)
              if (!previous) return null
              const PreviousIcon = previous.icon
              return (
                <p
                  key={turn.id}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <PreviousIcon className="h-3.5 w-3.5" />
                  Opened earlier · {previous.label}
                </p>
              )
            }
            if (turn.intent === 'progress') {
              return <CoachPulseCard key={turn.id} threadId={thread?.id} />
            }
            if (turn.intent === 'prepare') {
              return (
                <CoachPrepareCard
                  key={turn.id}
                  threadId={thread?.id}
                  preparationId={thread?.preparationId}
                />
              )
            }
            if (turn.intent === 'elevate') {
              return <CoachElevateCard key={turn.id} userId={user?.id} threadId={thread?.id} />
            }
            if (turn.intent === 'replay') {
              return <CoachReplayCard key={turn.id} threadId={thread?.id} />
            }
            return null
          })}
          {thinking && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Coach is thinking…
            </p>
          )}
          {resultError && (
            <div className="flex flex-wrap items-center gap-3 text-sm text-destructive">
              <span>{resultError}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setResultError(null)
                  setResultRetryNonce((value) => value + 1)
                }}
              >
                Retry
              </Button>
            </div>
          )}

          <div ref={threadEndRef} />

          {!loadingThread && turns.length === 0 && (
            <p className="pt-2 text-sm text-muted-foreground">
              Tell Coach the outcome you want. It will choose the most useful next step.
            </p>
          )}
          </div>
        )}
      </div>

      {!isHome && <div className="shrink-0 pb-5">
        <form onSubmit={submitRequest} className={THREAD_LANE}>
          <div className="relative rounded-2xl border bg-background shadow-lg shadow-black/5">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void commitRequest()
                }
              }}
              rows={2}
              maxLength={500}
              placeholder="What would you like to work on?"
              className="min-h-[68px] resize-none rounded-2xl border-0 bg-transparent pr-14 shadow-none focus-visible:ring-0"
              aria-label="Tell your coach what you would like to work on"
            />
            <Button
              type="submit"
              size="icon"
              className="absolute bottom-2.5 right-2.5 h-9 w-9 rounded-lg"
              disabled={!draft.trim() || !thread}
              aria-label="Confirm coaching request"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>
      </div>}

      {historyOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close history"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l bg-background shadow-lg">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <p className="text-sm font-semibold">Goal history</p>
                <p className="text-xs text-muted-foreground">Active goals stay until you archive them.</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>
                Close
              </Button>
            </div>
            <div className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Active goals
                </h2>
                <div className="space-y-2">
                  {activeGoals.length === 0 && (
                    <p className="text-sm text-muted-foreground">No active goals yet.</p>
                  )}
                  {activeGoals.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      {historyEditingId === item.id ? (
                        <div className="space-y-2">
                          <Input
                            value={historyTitleDraft}
                            onChange={(event) => setHistoryTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveHistoryTitle(item.id)
                              if (event.key === 'Escape') setHistoryEditingId(null)
                            }}
                            maxLength={60}
                            autoFocus
                            aria-label="Rename coaching goal"
                          />
                          <div className="flex gap-2">
                            <Button type="button" size="sm" onClick={() => void saveHistoryTitle(item.id)}>
                              Save
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" className="w-full text-left" onClick={() => openThread(item.id)}>
                          <p className="text-sm font-medium">{displayCoachTitle(item.title)}</p>
                          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock3 className="h-3 w-3" />
                            Updated {new Date(item.updatedAt).toLocaleDateString()}
                          </p>
                        </button>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          onClick={() => beginHistoryRename(item)}
                        >
                          <Pencil className="h-3 w-3" />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          onClick={() => void archiveThread(item.id)}
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-destructive underline-offset-4 hover:underline"
                          onClick={() => void deleteHistoryThread(item)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Recent
                </h2>
                <div className="space-y-2">
                  {recentGoals.length === 0 && (
                    <p className="text-sm text-muted-foreground">Archived goals will appear here.</p>
                  )}
                  {recentGoals.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3">
                      {historyEditingId === item.id ? (
                        <div className="space-y-2">
                          <Input
                            value={historyTitleDraft}
                            onChange={(event) => setHistoryTitleDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') void saveHistoryTitle(item.id)
                              if (event.key === 'Escape') setHistoryEditingId(null)
                            }}
                            maxLength={60}
                            autoFocus
                            aria-label="Rename coaching goal"
                          />
                          <div className="flex gap-2">
                            <Button type="button" size="sm" onClick={() => void saveHistoryTitle(item.id)}>
                              Save
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryEditingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => openThread(item.id)}
                        >
                          <p className="text-sm font-medium">{displayCoachTitle(item.title)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">Archived goal</p>
                        </button>
                      )}
                      <div className="mt-3 flex gap-3 text-xs">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          onClick={() => beginHistoryRename(item)}
                        >
                          <Pencil className="h-3 w-3" />
                          Rename
                        </button>
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-destructive underline-offset-4 hover:underline"
                          onClick={() => void deleteHistoryThread(item)}
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  )
}
