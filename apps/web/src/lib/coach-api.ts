import { apiClient } from '@/lib/api-client'

export type CoachThreadStatus = 'active' | 'archived'

export type CoachThreadSummary = {
  id: string
  title: string | null
  status: CoachThreadStatus
  preparationId: string | null
  createdAt: string
  updatedAt: string
}

export type CoachTurnRecord = {
  id: string
  role: 'user' | 'coach'
  kind: string | null
  text: string | null
  payload: Record<string, unknown> | null
  createdAt: string
}

export function displayCoachTitle(title: string | null | undefined): string {
  const value = title?.trim()
  return value || 'Untitled goal'
}

export function listCoachThreads() {
  return apiClient<{ threads: CoachThreadSummary[] }>('/api/coach/threads')
}

export function createCoachThread(title?: string) {
  return apiClient<{ thread: CoachThreadSummary; turns: CoachTurnRecord[] }>(
    '/api/coach/threads',
    {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    },
  )
}

export function getCoachThread(id: string) {
  return apiClient<{
    thread: CoachThreadSummary
    turns: CoachTurnRecord[]
    actions: Array<{
      id: string
      module: string
      action: string
      targetId: string | null
      createdAt: string
    }>
  }>(`/api/coach/threads/${encodeURIComponent(id)}`)
}

export function patchCoachThread(
  id: string,
  data: {
    title?: string | null
    status?: CoachThreadStatus
    preparationId?: string | null
  },
) {
  return apiClient<{ thread: CoachThreadSummary }>(
    `/api/coach/threads/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(data),
    },
  )
}

export function deleteCoachThread(id: string) {
  return apiClient<{ deleted: true }>(`/api/coach/threads/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function saveCoachTurns(id: string, turns: CoachTurnRecord[]) {
  return apiClient<{ turns: CoachTurnRecord[] }>(
    `/api/coach/threads/${encodeURIComponent(id)}/turns`,
    {
      method: 'PUT',
      body: JSON.stringify({ turns }),
    },
  )
}

export function recordCoachAction(
  id: string,
  data: { module: string; action: string; targetId?: string | null },
) {
  return apiClient<{
    action: {
      id: string
      module: string
      action: string
      targetId: string | null
      createdAt: string
    }
  }>(`/api/coach/threads/${encodeURIComponent(id)}/actions`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function coachElevatePath(
  params: Record<string, string>,
  threadId?: string,
) {
  const search = new URLSearchParams(params)
  search.set('coach', '1')
  if (threadId) search.set('thread', threadId)
  return `/elevate?${search.toString()}`
}

export type CoachModule = 'elevate' | 'replay' | 'prepare' | 'progress'

export type CoachBrief = {
  focusArea: string | null
  scenario: string | null
  durationSec: number | null
  preparationId: string | null
  stageId: string | null
}

export type CoachRecommendation = {
  module: CoachModule
  label: string
  reason: string
  brief: CoachBrief
}

export type CoachClarification = {
  question: string
  options: string[]
}

export type CoachResponse = {
  reply: string
  /** Suggested name for an unnamed thread. Null once the goal is set. */
  goalTitle: string | null
  clarify: CoachClarification | null
  recommend: CoachRecommendation | null
}

export type CoachHistoryTurn = { role: 'user' | 'coach'; text: string }

/**
 * Asks Coach to respond to a message. Resolves to null when the server has no
 * usable model output (HTTP 204), so callers fall back to rule-based routing.
 */
export function respondCoach(
  id: string,
  body: { message: string; history: CoachHistoryTurn[]; answeringClarification?: boolean },
) {
  return apiClient<CoachResponse | null>(
    `/api/coach/threads/${encodeURIComponent(id)}/respond`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

/** Interprets a finished session in the context of the thread's goal. */
export function interpretCoachSession(
  id: string,
  body: { sessionId: string; module: 'elevate' | 'replay' },
) {
  return apiClient<CoachResponse | null>(
    `/api/coach/threads/${encodeURIComponent(id)}/interpret`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

/** Turns a Coach brief into Elevate launch params so the session opens configured. */
export function briefToElevateParams(brief: CoachBrief): Record<string, string> {
  const params: Record<string, string> = {}
  if (brief.focusArea) params.focus = brief.focusArea
  const durationContext = brief.durationSec
    ? `Target duration: ${Math.round(brief.durationSec / 60)} minutes.`
    : ''
  const context = [brief.scenario, durationContext].filter(Boolean).join(' ')
  if (context) params.context = context
  if (brief.preparationId) params.preparationId = brief.preparationId
  if (brief.stageId) params.stageId = brief.stageId
  params.newSession = 'true'
  return params
}
