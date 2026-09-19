/**
 * Focus areas Coach is allowed to brief a practice session with.
 *
 * Mirrors focus areas in apps/web/src/lib/focus-areas.ts. `snapshot` is allowed
 * only for a broad communication assessment; targeted practice should use a
 * specific skill.
 */
export const COACH_FOCUS_AREAS = [
  'clarity',
  'confidence',
  'filler_words',
  'engagement',
  'pacing',
  'structure',
  'conciseness',
  'action_items',
  'snapshot',
] as const

export type CoachFocusArea = (typeof COACH_FOCUS_AREAS)[number]

const FOCUS_AREA_SET = new Set<string>(COACH_FOCUS_AREAS)

export function isCoachFocusArea(value: unknown): value is CoachFocusArea {
  return typeof value === 'string' && FOCUS_AREA_SET.has(value)
}

export const COACH_MODULES = ['elevate', 'replay', 'prepare', 'progress'] as const

export type CoachModule = (typeof COACH_MODULES)[number]

const MODULE_SET = new Set<string>(COACH_MODULES)

export function isCoachModule(value: unknown): value is CoachModule {
  return typeof value === 'string' && MODULE_SET.has(value)
}
