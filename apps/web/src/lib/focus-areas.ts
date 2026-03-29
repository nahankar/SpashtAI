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

export interface ExercisePreview {
  name: string
  duration: string
  steps: string[]
}

export const EXERCISE_PREVIEWS: Record<string, ExercisePreview> = {
  clarity: {
    name: 'Clarity Challenge',
    duration: '3\u20134 min',
    steps: [
      'Explain a complex concept in simple terms (60s)',
      'Re-explain using an analogy or real-world example',
      'Distill your message into one sentence',
    ],
  },
  confidence: {
    name: 'Confidence Builder',
    duration: '3\u20134 min',
    steps: [
      'Present a recommendation with zero hedging',
      'Defend your position under pushback',
      'Deliver a final decisive two-sentence statement',
    ],
  },
  filler_words: {
    name: 'Filler Word Elimination',
    duration: '4\u20135 min',
    steps: [
      'Speak on a topic for 90s \u2014 replace fillers with pauses',
      'Repeat with a new topic, halve your filler count',
      'Deliver a 30-second filler-free summary',
    ],
  },
  engagement: {
    name: 'Engagement Activator',
    duration: '3\u20134 min',
    steps: [
      'Present an idea with questions and examples',
      'Re-engage a bored audience with a hook',
      'Close with a compelling call-to-action',
    ],
  },
  pacing: {
    name: 'Pacing Control',
    duration: '3\u20134 min',
    steps: [
      'Speak at a steady pace with deliberate pauses',
      'Maintain pace while discussing something exciting',
      'Deliver one key takeaway slowly and deliberately',
    ],
  },
  structure: {
    name: 'Structure Sprint',
    duration: '3\u20134 min',
    steps: [
      'Answer a question using PREP (Point, Reason, Example, Point)',
      'Use signposting for a multi-part answer',
      'Give a 30-second structured summary',
    ],
  },
  conciseness: {
    name: 'Conciseness Drill',
    duration: '3\u20134 min',
    steps: [
      'Answer a question completely in under 30 seconds',
      'Deliver the same answer in 15 seconds or less',
      'Summarize in one sentence',
    ],
  },
  action_items: {
    name: 'Decisive Closer',
    duration: '3\u20134 min',
    steps: [
      'Close a meeting with decisions, owners, and deadlines',
      'Pin down a non-committal stakeholder diplomatically',
      'Send a follow-up summary: decisions, actions, dates',
    ],
  },
}
