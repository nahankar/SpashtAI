export interface FocusArea {
  id: string
  label: string
  description: string
  keywords: string[]
}

export const FOCUS_AREAS: FocusArea[] = [
  {
    id: 'clarity',
    label: 'Clarity',
    description: 'Communicate ideas clearly and concisely',
    keywords: ['clarity', 'clear', 'structure', 'concise', 'organized', 'articulate'],
  },
  {
    id: 'confidence',
    label: 'Confidence',
    description: 'Project confidence through voice and language',
    keywords: ['confidence', 'confident', 'assertive', 'decisive', 'authority'],
  },
  {
    id: 'filler_words',
    label: 'Filler Words',
    description: 'Reduce filler words like um, uh, like, you know',
    keywords: ['filler', 'um', 'uh', 'like', 'you know', 'basically', 'actually'],
  },
  {
    id: 'engagement',
    label: 'Engagement',
    description: 'Keep your audience engaged and interested',
    keywords: ['engagement', 'engage', 'interest', 'attention', 'interactive', 'storytelling'],
  },
  {
    id: 'pacing',
    label: 'Pacing & Speed',
    description: 'Maintain appropriate speaking pace with strategic pauses',
    keywords: ['pace', 'pacing', 'speed', 'slow', 'fast', 'pause', 'rushing'],
  },
  {
    id: 'structure',
    label: 'Structure',
    description: 'Organize responses using frameworks like STAR, PREP',
    keywords: ['structure', 'organize', 'framework', 'star', 'prep', 'format'],
  },
  {
    id: 'conciseness',
    label: 'Conciseness',
    description: 'Deliver your message without unnecessary words',
    keywords: ['concise', 'brief', 'rambling', 'wordy', 'verbose', 'tangent'],
  },
  {
    id: 'action_items',
    label: 'Action Items & Closing',
    description: 'Clearly assign tasks and close conversations decisively',
    keywords: ['action', 'closing', 'decision', 'assignment', 'next steps', 'follow up'],
  },
]

/**
 * Infer the best matching focus area from an improvement point or context string.
 */
export function inferFocusArea(text: string): string {
  const lower = text.toLowerCase()
  let best = 'clarity'
  let bestCount = 0

  for (const area of FOCUS_AREAS) {
    const count = area.keywords.filter((kw) => lower.includes(kw)).length
    if (count > bestCount) {
      bestCount = count
      best = area.id
    }
  }
  return best
}

export function getFocusAreaLabel(id: string): string {
  return FOCUS_AREAS.find((a) => a.id === id)?.label ?? id
}
