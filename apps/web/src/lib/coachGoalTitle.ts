import { explicitFocusAreas } from '@/lib/focus-areas'

const GOAL_TITLES: Record<string, string> = {
  clarity: 'Improve clarity',
  confidence: 'Improve confidence',
  filler_words: 'Reduce filler words',
  engagement: 'Improve engagement',
  pacing: 'Improve pacing',
  structure: 'Improve structure',
  conciseness: 'Improve conciseness',
  action_items: 'Improve action items',
  snapshot: 'Communication snapshot',
}

/** Titles we assign before a specific skill is known. A later skill may replace these. */
const GENERIC_GOAL_TITLES = new Set(['Communication snapshot'])

const BASELINE_REQUEST =
  /\b(?:assess(?:\s+my)?\s+skills?|communication\s+snapshot|baseline|where\s+to\s+start|get\s+started|don'?t\s+know|not\s+sure)\b/i

export function suggestCoachGoalTitle(input: {
  userMessages: string[]
  focusAreas: Array<string | null | undefined>
}): string | null {
  const ordered: string[] = []
  for (const focus of input.focusAreas) {
    if (focus && GOAL_TITLES[focus]) ordered.push(focus)
  }
  for (const message of input.userMessages) {
    ordered.push(...explicitFocusAreas(message).filter((focus) => GOAL_TITLES[focus]))
    if (BASELINE_REQUEST.test(message)) ordered.push('snapshot')
  }

  const specific = [...ordered].reverse().find((focus) => focus !== 'snapshot')
  if (specific) return GOAL_TITLES[specific]
  if (ordered.includes('snapshot')) return GOAL_TITLES.snapshot

  const first = input.userMessages.map((message) => message.trim()).find(Boolean)
  if (!first) return null
  const words = first.replace(/[?.!]+$/g, '').split(/\s+/).slice(0, 6).join(' ')
  const clipped = words.length > 60 ? `${words.slice(0, 57).trimEnd()}…` : words
  return clipped.charAt(0).toUpperCase() + clipped.slice(1)
}

/** True when an empty or generic automatic title should take a more specific name. */
export function coachGoalTitleNeedsUpdate(
  current: string | null | undefined,
  next: string | null,
): boolean {
  if (!next) return false
  const existing = current?.trim()
  if (!existing) return true
  if (existing === next) return false
  return GENERIC_GOAL_TITLES.has(existing)
}
