import { useEffect, useRef, useState } from 'react'
import { useTenantDemo } from '@/contexts/TenantDemoContext'
import { TenantDemoAnalytics } from '@/components/admin/TenantDemoAnalytics'
import { ExplorerResults } from '@/components/admin/analytics-explorer/ExplorerResults'
import { ExplorerStatus } from '@/components/admin/analytics-explorer/ExplorerStatus'
import { IdentityTable } from '@/components/admin/analytics-explorer/IdentityTable'
import { PlanDraft } from '@/components/admin/analytics-explorer/PlanDraft'
import { QuestionComposer } from '@/components/admin/analytics-explorer/QuestionComposer'
import { SavedQueryRail } from '@/components/admin/analytics-explorer/SavedQueryRail'
import { UnderstoodSummary } from '@/components/admin/analytics-explorer/UnderstoodSummary'
import { IndividualPlanDraft, IndividualResults, IndividualSummary, LearnerChoice } from '@/components/admin/analytics-explorer/IndividualExplorer'
import type { LearnerSummary } from '@/components/admin/LearnerSelector'
import {
  deleteSavedQuery,
  errorMessage,
  interpretQuestion,
  isAbortError,
  listIdentity,
  listSavedQueries,
  runAnalyticsPlan,
  runSavedQuery,
  updateSavedQuery,
} from '@/components/admin/analytics-explorer/api'
import { normalizeRefreshInterval, replaceSavedQuery } from '@/components/admin/analytics-explorer/format'
import { usePinnedAutoRefresh } from '@/components/admin/analytics-explorer/usePinnedAutoRefresh'
import {
  isIndividualPlan,
  isIndividualResult,
  type AnyAnalyticsPlan,
  type AnyAnalyticsResult,
  type IdentityState,
  type RefreshIntervalSec,
  type SavedQuery,
  type SavedQueryLists,
} from '@/components/admin/analytics-explorer/types'

type ExplorerView =
  | { status: 'idle' }
  | { status: 'loading'; message: string }
  | { status: 'error'; message: string }
  | { status: 'clarification'; question: string }
  | { status: 'unsupported'; reason: string }
  | { status: 'no_match'; reason: string }
  | { status: 'choose_learner'; question: string; reason: string; candidates: LearnerSummary[] }
  | { status: 'draft'; question: string; plan: AnyAnalyticsPlan; learner?: LearnerSummary; error: string | null }
  | { status: 'ready'; savedQuery: SavedQuery; result: AnyAnalyticsResult }

function viewMessage(view: Exclude<ExplorerView, { status: 'ready' | 'choose_learner' | 'draft' }>) {
  if (view.status === 'loading' || view.status === 'error') return view.message
  if (view.status === 'clarification') return view.question
  if (view.status === 'unsupported' || view.status === 'no_match') return view.reason
  return undefined
}

export function AnalyticsExplorer() {
  // The Tenant Admin demo never loads platform analytics: it shows labelled sample organization data.
  const { enabled } = useTenantDemo()
  return enabled ? <TenantDemoAnalytics view="ai" /> : <PlatformAnalyticsExplorer />
}

function PlatformAnalyticsExplorer() {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [view, setView] = useState<ExplorerView>({ status: 'idle' })
  const [lists, setLists] = useState<SavedQueryLists>({ pinned: [], recent: [] })
  const [listsStatus, setListsStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [listsError, setListsError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [identity, setIdentity] = useState<IdentityState>({ status: 'idle' })

  const foreground = useRef(0)
  const listTicket = useRef(0)
  const activeIdRef = useRef<string | null>(null)
  const usersPageRef = useRef(1)
  const identityRef = useRef<IdentityState>({ status: 'idle' })
  const askingRef = useRef(false)
  const askAbort = useRef<AbortController | null>(null)
  const usersAbort = useRef<AbortController | null>(null)
  const manualControllers = useRef(new Map<string, AbortController>())
  const runTokens = useRef(new Map<string, number>())
  const pageRunRef = useRef<(id: string, signal: AbortSignal) => Promise<void>>(async () => {})

  const pinnedQueries = lists.pinned.map((query) => ({
    id: query.id,
    refreshIntervalSec: normalizeRefreshInterval(query.refreshIntervalSec),
  }))
  const abortAuto = usePinnedAutoRefresh(pinnedQueries, (id, signal) => pageRunRef.current(id, signal))

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const ticket = ++listTicket.current
    listSavedQueries(controller.signal)
      .then((fresh) => {
        if (!active || ticket !== listTicket.current) return
        setLists(fresh)
        setListsStatus('ready')
        setListsError(null)
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted || isAbortError(error) || ticket !== listTicket.current) return
        setListsStatus('error')
        setListsError(errorMessage(error, 'Could not load saved questions'))
      })
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  useEffect(() => {
    const manuals = manualControllers.current
    return () => {
      askAbort.current?.abort()
      usersAbort.current?.abort()
      for (const controller of manuals.values()) controller.abort()
    }
  }, [])

  function publishIdentity(next: IdentityState) {
    identityRef.current = next
    setIdentity(next)
  }

  function clearIdentity() {
    usersAbort.current?.abort()
    publishIdentity({ status: 'idle' })
  }

  function clearError(id: string) {
    setErrors((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  function noteError(id: string, message: string) {
    setErrors((current) => ({ ...current, [id]: message }))
  }

  function remember(saved: SavedQuery) {
    listTicket.current += 1
    setLists((current) => replaceSavedQuery(current, saved))
    setView((current) => {
      if (current.status !== 'ready' || current.savedQuery.id !== saved.id) return current
      return { ...current, savedQuery: saved }
    })
  }

  async function reloadLists(quiet: boolean) {
    const ticket = ++listTicket.current
    if (!quiet) {
      setListsStatus('loading')
      setListsError(null)
    }
    try {
      const fresh = await listSavedQueries()
      if (ticket !== listTicket.current) return
      setLists(fresh)
      setListsStatus('ready')
      setListsError(null)
      setView((current) => {
        if (current.status !== 'ready') return current
        const match = [...fresh.pinned, ...fresh.recent].find((item) => item.id === current.savedQuery.id)
        return match ? { ...current, savedQuery: match } : current
      })
    } catch (error) {
      if (isAbortError(error) || ticket !== listTicket.current) return
      if (!quiet) {
        setListsStatus('error')
        setListsError(errorMessage(error, 'Could not load saved questions'))
      }
    }
  }

  async function loadUsers(id: string, page: number) {
    usersPageRef.current = page
    usersAbort.current?.abort()
    const controller = new AbortController()
    usersAbort.current = controller
    const previous = identityRef.current
    const keepPage = previous.status === 'ready' && previous.data.page === page
    publishIdentity(keepPage ? { ...previous, refreshing: true } : { status: 'loading', page })
    try {
      const data = await listIdentity(id, page, controller.signal)
      if (controller.signal.aborted || activeIdRef.current !== id) return
      usersPageRef.current = data.page
      publishIdentity({ status: 'ready', data, refreshing: false })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || activeIdRef.current !== id) return
      publishIdentity({
        status: 'error',
        page,
        message: errorMessage(error, 'Could not load matching learners'),
      })
    }
  }

  function showResult(saved: SavedQuery, result: AnyAnalyticsResult, ticket: number, page: number) {
    if (foreground.current !== ticket) return
    activeIdRef.current = saved.id
    setActiveId(saved.id)
    setView({ status: 'ready', savedQuery: saved, result })
    if (!isIndividualPlan(saved.plan) && saved.plan.answerKind === 'users') void loadUsers(saved.id, page)
    else clearIdentity()
  }

  async function executeRun(id: string, signal: AbortSignal, mode: 'interactive' | 'background') {
    const ticket = mode === 'interactive' ? ++foreground.current : foreground.current
    const token = (runTokens.current.get(id) ?? 0) + 1
    runTokens.current.set(id, token)
    const switching = mode === 'interactive' && activeIdRef.current !== id
    const resultPage = switching ? 1 : usersPageRef.current
    clearError(id)
    if (mode === 'interactive') {
      activeIdRef.current = id
      setActiveId(id)
      if (switching) {
        usersPageRef.current = 1
        clearIdentity()
        setView({ status: 'loading', message: 'Running the saved plan...' })
      }
    }
    setRefreshing((current) => ({ ...current, [id]: true }))
    try {
      const payload = await runSavedQuery(id, signal, mode === 'background' ? 'auto' : 'manual')
      if (signal.aborted || runTokens.current.get(id) !== token) return
      remember(payload.savedQuery)
      const visible = mode === 'interactive'
        ? foreground.current === ticket
        : foreground.current === ticket && activeIdRef.current === id
      if (visible) {
        showResult(payload.savedQuery, payload.result, ticket, mode === 'background' ? usersPageRef.current : resultPage)
      }
    } catch (error) {
      if (runTokens.current.get(id) !== token || foreground.current !== ticket) return
      const aborted = signal.aborted || isAbortError(error)
      if (!aborted) noteError(id, errorMessage(error, 'Could not refresh this question'))
      if (activeIdRef.current !== id) return
      const message = aborted ? 'The refresh was interrupted.' : errorMessage(error, 'Could not refresh this question')
      setView((current) => current.status === 'loading' ? { status: 'error', message } : current)
    } finally {
      if (manualControllers.current.get(id)?.signal === signal) manualControllers.current.delete(id)
      if (runTokens.current.get(id) === token) {
        setRefreshing((current) => {
          if (!current[id]) return current
          const next = { ...current }
          delete next[id]
          return next
        })
      }
    }
  }

  pageRunRef.current = async (id, signal) => {
    manualControllers.current.get(id)?.abort()
    await executeRun(id, signal, 'background')
  }

  async function ask(text: string, learnerId?: string) {
    const trimmed = text.trim()
    if (!trimmed || trimmed.length > 1000 || askingRef.current) return
    askingRef.current = true
    setAsking(true)
    setQuestion(trimmed)
    const ticket = ++foreground.current
    askAbort.current?.abort()
    const controller = new AbortController()
    askAbort.current = controller
    setView({ status: 'loading', message: 'Turning that question into a query...' })
    try {
      const response = await interpretQuestion(trimmed, controller.signal, learnerId)
      if (controller.signal.aborted || isAbortError(controller.signal.reason) || foreground.current !== ticket) return
      const interpretation = response.interpretation
      if (interpretation.status === 'clarification') {
        setView({ status: 'clarification', question: interpretation.question })
        return
      }
      if (interpretation.status === 'unsupported' || interpretation.status === 'no_match') {
        setView({ status: interpretation.status, reason: interpretation.reason })
        return
      }
      if (interpretation.status === 'choose_learner') {
        setView({ status: 'choose_learner', question: trimmed, reason: interpretation.reason, candidates: interpretation.candidates })
        return
      }
      setView({ status: 'draft', question: trimmed, plan: interpretation.plan, learner: interpretation.learner, error: null })
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || foreground.current !== ticket) return
      setView({ status: 'error', message: errorMessage(error, 'AI analytics is temporarily unavailable.') })
    } finally {
      askingRef.current = false
      setAsking(false)
    }
  }

  async function runDraft(questionText: string, plan: AnyAnalyticsPlan, learner?: LearnerSummary) {
    if (askingRef.current) return
    askingRef.current = true
    setAsking(true)
    const ticket = ++foreground.current
    askAbort.current?.abort()
    const controller = new AbortController()
    askAbort.current = controller
    setView({ status: 'draft', question: questionText, plan, learner, error: null })
    try {
      const response = await runAnalyticsPlan(questionText, plan, controller.signal)
      if (controller.signal.aborted || isAbortError(controller.signal.reason) || foreground.current !== ticket) return
      remember(response.savedQuery)
      showResult(response.savedQuery, response.result, ticket, 1)
      void reloadLists(true)
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error) || foreground.current !== ticket) return
      setView({
        status: 'draft',
        question: questionText,
        plan,
        learner,
        error: errorMessage(error, 'Could not run this analytics plan.'),
      })
    } finally {
      askingRef.current = false
      setAsking(false)
    }
  }

  function openSaved(query: SavedQuery) {
    setQuestion(query.question)
    abortAuto(query.id)
    const controller = new AbortController()
    manualControllers.current.get(query.id)?.abort()
    manualControllers.current.set(query.id, controller)
    void executeRun(query.id, controller.signal, 'interactive')
  }

  async function patchSaved(
    query: SavedQuery,
    patch: { pinned?: boolean; title?: string; refreshIntervalSec?: RefreshIntervalSec },
  ) {
    clearError(query.id)
    try {
      const updated = await updateSavedQuery(query.id, patch)
      remember(updated)
      if (patch.pinned != null) await reloadLists(true)
    } catch (error) {
      noteError(query.id, errorMessage(error, 'Could not update this question'))
      throw error
    }
  }

  async function removeSaved(query: SavedQuery) {
    clearError(query.id)
    try {
      await deleteSavedQuery(query.id)
    } catch (error) {
      noteError(query.id, errorMessage(error, 'Could not delete this question'))
      throw error
    }
    abortAuto(query.id)
    manualControllers.current.get(query.id)?.abort()
    listTicket.current += 1
    setLists((current) => ({
      pinned: current.pinned.filter((item) => item.id !== query.id),
      recent: current.recent.filter((item) => item.id !== query.id),
    }))
    if (activeIdRef.current === query.id) {
      foreground.current += 1
      activeIdRef.current = null
      setActiveId(null)
      setView({ status: 'idle' })
      clearIdentity()
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Analytics</h1>
        <p className="text-muted-foreground">
          Ask a plain-language question about learners, feature use, or language scores, or about one learner's Progress Pulse or day-wise activity (name them by email). Pinned answers refresh from the saved plan while this tab is visible.
        </p>
      </div>
      <QuestionComposer question={question} asking={asking} onQuestion={setQuestion} onAsk={(value) => { void ask(value) }} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4" aria-live="polite">
          {view.status === 'draft' ? (
            isIndividualPlan(view.plan) ? (
              <IndividualPlanDraft
                plan={view.plan}
                learner={view.learner}
                running={asking}
                error={view.error}
                onChange={(plan) => setView({ ...view, plan, error: null })}
                onRun={() => { void runDraft(view.question, view.plan, view.learner) }}
              />
            ) : (
              <PlanDraft
                plan={view.plan}
                running={asking}
                error={view.error}
                onChange={(plan) => setView({ status: 'draft', question: view.question, plan, error: null })}
                onRun={() => { void runDraft(view.question, view.plan) }}
              />
            )
          ) : view.status === 'choose_learner' ? (
            <LearnerChoice reason={view.reason} candidates={view.candidates} onChoose={(learnerId) => { void ask(view.question, learnerId) }} />
          ) : view.status === 'ready' && isIndividualPlan(view.savedQuery.plan) && isIndividualResult(view.result) ? (
            <>
              <IndividualSummary plan={view.savedQuery.plan} learner={view.result.learner} />
              <IndividualResults title={view.savedQuery.title} result={view.result} refreshing={Boolean(refreshing[view.savedQuery.id])} />
            </>
          ) : view.status === 'ready' && !isIndividualPlan(view.savedQuery.plan) && !isIndividualResult(view.result) ? (
            <>
              <UnderstoodSummary plan={view.savedQuery.plan} />
              <ExplorerResults
                title={view.savedQuery.title}
                result={view.result}
                refreshing={Boolean(refreshing[view.savedQuery.id])}
              />
              {view.savedQuery.plan.answerKind === 'users' && (
                <IdentityTable
                  state={identity}
                  threshold={view.result.privacyThreshold}
                  onPage={(page) => { void loadUsers(view.savedQuery.id, page) }}
                />
              )}
            </>
          ) : view.status === 'ready' ? (
            <ExplorerStatus status="error" message="This saved answer no longer matches its plan. Run the question again." />
          ) : (
            <ExplorerStatus
              status={view.status === 'no_match' ? 'unsupported' : view.status}
              title={view.status === 'no_match' ? 'No learner matches' : undefined}
              message={viewMessage(view)}
              onRetry={view.status === 'error' ? () => { void ask(question) } : undefined}
            />
          )}
        </div>
        <SavedQueryRail
          lists={lists}
          status={listsStatus}
          error={listsError}
          activeId={activeId}
          refreshing={refreshing}
          errors={errors}
          onOpen={openSaved}
          onRefresh={openSaved}
          onTogglePin={(query) => patchSaved(query, { pinned: !query.pinned })}
          onRename={(query, title) => patchSaved(query, { title })}
          onInterval={(query, refreshIntervalSec) => patchSaved(query, { refreshIntervalSec })}
          onDelete={removeSaved}
          onRetry={() => { void reloadLists(false) }}
        />
      </div>
    </div>
  )
}
