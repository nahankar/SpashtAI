/** Read-only review of organization learner sessions: query building and display helpers. */

export const REVIEW_PRODUCTS = [
  { id: 'elevate', label: 'Elevate' },
  { id: 'replay', label: 'Replay' },
  { id: 'interviews', label: 'Interviews' },
] as const
export const REVIEW_STATUSES = [
  { id: 'completed', label: 'Completed' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'failed', label: 'Failed' },
] as const
export type ReviewProduct = typeof REVIEW_PRODUCTS[number]['id']
export type ReviewStatus = typeof REVIEW_STATUSES[number]['id']

export interface ReviewFilters { learner?: string; product?: ReviewProduct; status?: ReviewStatus; from?: string; to?: string }
export interface ReviewLearner { memberId: string | null; name: string; email: string | null }
export interface ReviewItem {
  id: string; product: ReviewProduct; name: string | null; learner: ReviewLearner
  startedAt: string; endedAt: string | null; durationSeconds: number | null; status: ReviewStatus
}
export interface ReviewPage { items: ReviewItem[]; nextCursor: string | null; timeZone: string }

export interface ReviewRecording { id: string; kind: string; mimeType: string; durationSeconds: number | null; segmentIndex: number | null; available: boolean }
export interface ReviewTurn { id: string; role: string | null; text: string; audioStart: number | null; audioEnd: number | null; score: { stars: number | null; tags: string[] } | null; coachNote: string | null }
export interface CoachingInsights {
  topStrength: string | null; primaryImprovement: string | null; actionableAdvice: string | null; practiceExercise: string | null
  overallNarrative: string | null; topicFlow: string | null; practicePlan: Array<{ title: string | null; description: string | null; focusSkill: string | null }>
}
export type SkillScores = Record<string, number | null>
export interface InterviewCriterion { criterion: string; finding: string; evidence: string[]; explanation: string }
export interface InterviewAttemptReview {
  id: string; index: number; status: string; completionReason: string | null; assistance: string
  question: { text: string; track: string | null; category: string | null; topic: string | null; difficulty: string | null }
  capturedText: string; answer: { text: string; source: string; revision: number } | null
  feedback: { status: string; errorCode: string | null; result: null | {
    classification: string; criteria: InterviewCriterion[]; strengths: string[]; gaps: string[]; misconceptions: string[]
    guidance: string; uncertainty: string[]; responseKind: string | null } }
}
export interface ReviewDetail {
  product: ReviewProduct; readOnly: true
  session: { id: string; name: string | null; learner: ReviewLearner; startedAt: string; endedAt: string | null; durationSeconds: number | null; status: ReviewStatus
    meetingType?: string; userRole?: string; focusAreas?: string[]; meetingGoal?: string | null }
  recordings: ReviewRecording[]
  transcript?: ReviewTurn[]
  results?: null | { metrics: Record<string, number | null>; skillScores: SkillScores | null; coachingInsights: CoachingInsights | null }
  interview?: null | { track: string; experienceBand: string; startingDifficulty: string; durationMinutes: number | null; evaluationEnabled: boolean; attempts: InterviewAttemptReview[] }
  replay?: null | {
    transcriptText: string; structuredTranscript: Array<{ speaker: string; text: string; startTime: number | null; endTime: number | null }>
    metrics: Record<string, number | string | null>; scores: Record<string, number | null>; skillScores: SkillScores | null
    feedback: { strengths: unknown; improvements: unknown; recommendations: unknown; contextSpecificFeedback: unknown; keyMoments: unknown; scope: string }
    coachingInsights: CoachingInsights | null
  }
}

export const REVIEW_API = '/api/workspaces/current/review/sessions'
const isProduct = (value: string | null): value is ReviewProduct => REVIEW_PRODUCTS.some(p => p.id === value)
const isStatus = (value: string | null): value is ReviewStatus => REVIEW_STATUSES.some(s => s.id === value)
const isDay = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)

/** Filters from the page address; unknown values are dropped rather than sent to the server. */
export function filtersFromSearch(params: URLSearchParams): ReviewFilters {
  const learner = params.get('learner'), product = params.get('product'), status = params.get('status'), from = params.get('from'), to = params.get('to')
  return {
    ...(learner && learner.length <= 160 ? { learner } : {}),
    ...(isProduct(product) ? { product } : {}),
    ...(isStatus(status) ? { status } : {}),
    ...(isDay(from) ? { from } : {}),
    ...(isDay(to) ? { to } : {}),
  }
}

export function filterSearch(filters: ReviewFilters, after?: string) {
  const params = new URLSearchParams()
  for (const key of ['learner', 'product', 'status', 'from', 'to'] as const) if (filters[key]) params.set(key, filters[key]!)
  if (after) params.set('after', after)
  return params.toString()
}

export function reviewListPath(filters: ReviewFilters, after?: string) {
  const query = filterSearch(filters, after)
  return query ? `${REVIEW_API}?${query}` : REVIEW_API
}
export function reviewDetailPath(product: ReviewProduct, id: string) { return `${REVIEW_API}/${product}/${encodeURIComponent(id)}` }
export function reviewTicketPath(product: ReviewProduct, sessionId: string, recordingId: string) {
  return `${reviewDetailPath(product, sessionId)}/recordings/${encodeURIComponent(recordingId)}/ticket`
}
/** Workspace page address of one review (inside the workspace shell). */
export function reviewPagePath(base: string, item: Pick<ReviewItem, 'product' | 'id'>) { return `${base}/admin/sessions/${item.product}/${encodeURIComponent(item.id)}` }
export function learnerSessionsPath(base: string, memberId: string) { return `${base}/admin/sessions?${filterSearch({ learner: memberId })}` }

export function productLabel(product: string) { return REVIEW_PRODUCTS.find(p => p.id === product)?.label ?? product }
export function statusLabel(status: string) { return REVIEW_STATUSES.find(s => s.id === status)?.label ?? status }

export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}
export function formatClock(seconds: number | null | undefined) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
/** Time as the organization reads it (its configured time zone), never the reviewer's browser zone. */
export function formatWhen(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
  } catch {
    return date.toISOString()
  }
}

export function speakerLabel(role: string | null, product: ReviewProduct) {
  if (role === 'user') return 'Learner'
  if (role === 'assistant') return product === 'interviews' ? 'Interviewer' : 'Coach'
  return role ?? 'Speaker'
}

export const SKILL_LABELS: Record<string, string> = {
  clarity: 'Clarity', conciseness: 'Conciseness', confidence: 'Confidence', structure: 'Structure', engagement: 'Engagement',
  pacing: 'Pacing', delivery: 'Delivery', emotionalControl: 'Emotional control',
}
export function scoredSkills(scores: SkillScores | null | undefined) {
  return Object.entries(scores ?? {}).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([key, value]) => ({ key, label: SKILL_LABELS[key] ?? key, value: Math.round(value * 10) / 10 }))
}

/** Learner-facing feedback lists may hold plain strings or small objects; show only their text. */
export function feedbackLines(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (typeof item === 'string') return item.trim() ? [item] : []
    if (item && typeof item === 'object') {
      const text = Object.values(item as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      return text.length ? [text.join(' — ')] : []
    }
    return []
  })
}

const FINDING: Record<string, string> = { MET: 'Met', PARTIAL: 'Partly met', NOT_MET: 'Needs improvement', NOT_ASSESSED: 'Not established' }
const CLASSIFICATION: Record<string, string> = { CORRECT: 'Correct', PARTIAL: 'Partly correct', INCORRECT: 'Incorrect', NOT_ANSWERED: 'Not answered' }
const FEEDBACK_STATUS: Record<string, string> = {
  AFTER_PRACTICE: 'Shown after the practice ends', NOT_ENABLED: 'Technical feedback was not enabled', TRANSCRIPT_INCOMPLETE: 'Transcript incomplete; not graded',
  PENDING: 'Feedback in progress', RUNNING: 'Feedback in progress', FAILED: 'Feedback unavailable', CANCELLED: 'Not graded',
  SKIPPED: 'Question skipped', INCOMPLETE: 'Not answered', AWAITING_ANSWER: 'Not answered yet',
}
export const findingLabel = (value: string) => FINDING[value] ?? value
export const classificationLabel = (value: string) => CLASSIFICATION[value] ?? value
export const feedbackStatusLabel = (value: string) => FEEDBACK_STATUS[value] ?? value
