/** Versioned product-event contract. schemaVersion 1 keeps legacy latency in duration. */

export const PRODUCT_SCHEMA_VERSION = 2
export const MAX_ENGAGEMENT_MS = 4 * 60 * 60 * 1000
export const MAX_REQUEST_MS = 120_000
export const MIN_COHORT = 5

export const PRODUCT_FEATURES = [
  'app',
  'elevate',
  'replay',
  'prepare',
  'interviews',
  'progress_pulse',
  'feedback',
] as const

export type ProductFeature = (typeof PRODUCT_FEATURES)[number]

/**
 * FeatureUsage actions that count as having used a feature.
 * Opening a dashboard, viewing results, or starting a form does not.
 * Keep infra/cube/model/learners.yml in sync with this list.
 */
export const FEATURE_USE_ACTIONS = {
  elevate: ['session_start', 'session_end', 'auto_completed', 'rtc_connected'],
  replay: ['session_create', 'analyze', 'process_completed', 'process_failed'],
  interviews: ['practice_start', 'answer_completed', 'answer_skipped', 'run_completed', 'run_abandoned', 'rtc_connected'],
  progress_pulse: ['tracked'],
  prepare: [
    'journey_created',
    'event_practice_started',
    'event_practice_completed',
    'event_recording_created',
    'event_recording_analyzed',
    'question_added',
    'interview_logged',
    'stage_completed',
    'reflection_saved',
  ],
  feedback: ['submitted'],
} as const satisfies Record<Exclude<ProductFeature, 'app'>, readonly string[]>

const SERVER_ACTIONS: Record<ProductFeature, readonly string[]> = {
  app: ['page_view', 'page_exit'],
  elevate: ['session_start', 'session_end', 'auto_completed', 'rtc_connected', 'results_viewed', 'exported'],
  replay: ['session_create', 'analyze', 'process_completed', 'process_failed', 'results_viewed', 'exported'],
  prepare: [
    'journey_created',
    'event_practice_started',
    'event_practice_completed',
    'event_recording_created',
    'event_recording_analyzed',
    'question_added',
    'interview_logged',
    'stage_completed',
    'reflection_saved',
  ],
  interviews: ['practice_start', 'answer_completed', 'answer_skipped', 'run_completed', 'run_abandoned', 'run_discarded', 'rtc_connected', 'results_viewed'],
  progress_pulse: ['dashboard_viewed', 'tracked', 'skipped'],
  feedback: ['form_started', 'submitted', 'status_changed', 'first_response', 'resolved'],
}

const CLIENT_ACTIONS: Record<ProductFeature, readonly string[]> = {
  app: ['page_view', 'page_exit'],
  elevate: ['rtc_connected', 'results_viewed', 'exported'],
  replay: ['results_viewed', 'exported'],
  prepare: [],
  interviews: ['results_viewed', 'rtc_connected'],
  progress_pulse: ['dashboard_viewed'],
  feedback: ['form_started'],
}

const METADATA_KEYS = new Set([
  'path',
  'source',
  'skill',
  'status',
  'phase',
  'mediaKind',
  'hasAttachment',
  'count',
  'stage',
  'reason',
  'type',
])

const OUTCOMES = new Set([
  'started',
  'completed',
  'failed',
  'skipped',
  'viewed',
  'tracked',
  'inactivity',
  'discarded',
  'acknowledged',
  'resolved',
])

export type ProductEventDraft = {
  feature: string
  action: string
  sessionId?: string | null
  duration?: number | null
  engagementMs?: number | null
  outcome?: string | null
  path?: string | null
  visitId?: string | null
  eventId?: string | null
  metadata?: Record<string, unknown> | null
}

export type SanitizedProductEvent = {
  feature: ProductFeature
  action: string
  sessionId: string | null
  duration: number | null
  engagementMs: number | null
  outcome: string | null
  path: string | null
  visitId: string | null
  eventId: string | null
  metadata: Record<string, string | number | boolean> | null
  schemaVersion: number
}

export function isProductFeature(value: string): value is ProductFeature {
  return (PRODUCT_FEATURES as readonly string[]).includes(value)
}

export function isAllowedAction(feature: ProductFeature, action: string, source: 'client' | 'server') {
  const list = source === 'client' ? CLIENT_ACTIONS[feature] : SERVER_ACTIONS[feature]
  return list.includes(action)
}

function clamp(value: number, max: number): number | null {
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(max, Math.round(value)))
}

function cleanId(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(trimmed) || trimmed.length > max) return null
  return trimmed
}

export function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.split('?')[0]?.split('#')[0] ?? ''
  if (!path.startsWith('/') || path.length > 160) return null
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(path)) return null
  return path
}

export function sanitizeMetadata(input: unknown): Record<string, string | number | boolean> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!METADATA_KEYS.has(key)) continue
    if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = Math.max(0, Math.min(1_000_000_000, Math.round(value)))
    else if (typeof value === 'string') {
      const text = value.trim().slice(0, 80)
      if (text) out[key] = text
    }
  }
  return Object.keys(out).length ? out : null
}

export function sanitizeProductEvent(draft: ProductEventDraft, source: 'client' | 'server'): SanitizedProductEvent | string {
  if (!isProductFeature(draft.feature)) return 'Invalid feature or action'
  const action = String(draft.action || '').slice(0, 64)
  if (!isAllowedAction(draft.feature, action, source)) return 'Invalid feature or action'
  const outcome = typeof draft.outcome === 'string' && OUTCOMES.has(draft.outcome) ? draft.outcome : null
  const eventId = cleanId(draft.eventId, 80)
  const visitId = cleanId(draft.visitId, 80)
  const path = cleanPath(draft.path) ?? cleanPath(sanitizeMetadata(draft.metadata)?.path)
  const engagementMs = typeof draft.engagementMs === 'number' ? clamp(draft.engagementMs, MAX_ENGAGEMENT_MS) : null
  const duration = typeof draft.duration === 'number' ? clamp(draft.duration, MAX_REQUEST_MS) : null
  const modern = eventId || visitId || path || engagementMs != null || outcome
  return {
    feature: draft.feature,
    action,
    sessionId: cleanId(draft.sessionId, 80),
    duration,
    engagementMs,
    outcome,
    path,
    visitId,
    eventId,
    metadata: sanitizeMetadata(draft.metadata),
    schemaVersion: modern ? PRODUCT_SCHEMA_VERSION : 1,
  }
}
