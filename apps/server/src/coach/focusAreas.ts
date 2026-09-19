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

const EXPLICIT_FOCUS_PATTERNS: Array<[CoachFocusArea, RegExp]> = [
  ['filler_words', /\b(?:filler(?:\s+words?)?|ums?|uhs?)\b/i],
  ['pacing', /\b(?:pace|pacing|speaking\s+speed|too\s+(?:fast|slow)|rushing)\b/i],
  ['conciseness', /\b(?:concise|conciseness|rambling|wordy|verbose)\b/i],
  ['clarity', /\b(?:clarity|clearer|clearly|unclear)\b/i],
  ['confidence', /\b(?:confidence|confident|nervous|assertive)\b/i],
  ['engagement', /\b(?:engagement|engaging|engage|audience\s+attention)\b/i],
  ['structure', /\b(?:structure|structured|organise|organize|framework)\b/i],
  ['action_items', /\b(?:action\s+items?|next\s+steps?|closing)\b/i],
]

/** Skills the user explicitly named in this message, independent of prior thread state. */
export function explicitCoachFocuses(message: string): CoachFocusArea[] {
  return EXPLICIT_FOCUS_PATTERNS.filter(([, pattern]) => pattern.test(message)).map(
    ([focus]) => focus,
  )
}

export function coachFocusLabel(focus: CoachFocusArea): string {
  const labels: Record<CoachFocusArea, string> = {
    clarity: 'clarity',
    confidence: 'confidence',
    filler_words: 'filler words',
    engagement: 'engagement',
    pacing: 'pacing',
    structure: 'structure',
    conciseness: 'conciseness',
    action_items: 'action items and closing',
    snapshot: 'Communication Snapshot',
  }
  return labels[focus]
}

export function isExplanationRequest(message: string): boolean {
  return /^(?:why|how (?:does|will|would|is|are|can)|what(?:'s| is) the (?:reason|rationale|connection))\b/i.test(
    message.trim(),
  )
}

export function isUncertainMessage(message: string): boolean {
  return /^(?:i\s+(?:do not|don't|dont)\s+know|not\s+sure|no\s+idea|unsure)[.!?]*$/i.test(
    message.trim(),
  )
}

export function isExploratoryMessage(message: string): boolean {
  return /\b(?:what|which|any)\b.{0,24}\b(?:options?|areas?|choices?)\b/i.test(message)
}

export function isAffirmedFocusIntent(message: string, answeringClarification: boolean): boolean {
  if (isExploratoryMessage(message) || isExplanationRequest(message) || isUncertainMessage(message)) {
    return false
  }
  if (answeringClarification && explicitCoachFocuses(message).length === 1) return true
  return /\b(?:i\s+(?:want|need|would like|wanna)\b|help\s+me\b|work\s+on\b|focus\s+on\b|improve\b|reduce\b|practi[cs]e\b)/i.test(
    message,
  )
}

export const COACH_MODULES = ['elevate', 'replay', 'prepare', 'progress'] as const

export type CoachModule = (typeof COACH_MODULES)[number]

const MODULE_SET = new Set<string>(COACH_MODULES)

export function isCoachModule(value: unknown): value is CoachModule {
  return typeof value === 'string' && MODULE_SET.has(value)
}

const MODULE_SIGNAL_PATTERNS: Array<[CoachModule, RegExp]> = [
  ['replay', /\b(?:recording|recorded|upload(?:ed)?|transcript|audio file|video file)\b/i],
  ['prepare', /\b(?:interview|hr round|recruiter|hiring|onsite|journey)\b/i],
  ['progress', /\b(?:score|scores|progress|pulse|trend|how am i doing)\b/i],
]

/**
 * Workspace the message itself points at. Used to decide whether a skill the
 * user named should become Elevate practice or should only re-focus the
 * workspace they already asked for.
 */
export function detectModuleSignal(message: string): CoachModule | null {
  return MODULE_SIGNAL_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0] ?? null
}
