import type { ReactNode } from 'react'

/** Six Progress Pulse skill blocks shown on the home dashboard. */
export const PULSE_SKILL_BLOCKS = [
  { id: 'clarity', label: 'Clarity' },
  { id: 'conciseness', label: 'Conciseness' },
  { id: 'confidence', label: 'Confidence' },
  { id: 'engagement', label: 'Engagement' },
  { id: 'pacing', label: 'Pacing & Speed' },
  { id: 'structure', label: 'Structure' },
] as const

export type PulseSkillId = (typeof PULSE_SKILL_BLOCKS)[number]['id']

const LABEL_BY_ID = Object.fromEntries(PULSE_SKILL_BLOCKS.map((s) => [s.id, s.label])) as Record<
  string,
  string
>

/** Match skill names in coaching copy to pulse block labels. */
export function highlightSkillTerms(text: string): ReactNode[] {
  const patterns: Array<{ re: RegExp; id: string; label: string }> = []
  for (const block of PULSE_SKILL_BLOCKS) {
    patterns.push({
      re: new RegExp(`\\b${block.label.replace(/&/g, '&')}\\b`, 'gi'),
      id: block.id,
      label: block.label,
    })
    patterns.push({
      re: new RegExp(`\\b${block.id.replace(/_/g, '[\\s_]')}\\b`, 'gi'),
      id: block.id,
      label: block.label,
    })
  }
  patterns.push({ re: /\bpacing\b/gi, id: 'pacing', label: 'Pacing & Speed' })
  patterns.push({ re: /\bstructure\b/gi, id: 'structure', label: 'Structure' })
  patterns.push({ re: /\bconciseness\b/gi, id: 'conciseness', label: 'Conciseness' })

  const spans: Array<{ start: number; end: number; id: string; label: string }> = []
  for (const p of patterns) {
    for (const m of text.matchAll(p.re)) {
      if (m.index == null) continue
      const start = m.index
      const end = start + m[0].length
      if (spans.some((s) => start < s.end && end > s.start)) continue
      spans.push({ start, end, id: p.id, label: LABEL_BY_ID[p.id] ?? p.label })
    }
  }
  spans.sort((a, b) => a.start - b.start)
  if (spans.length === 0) return [text]

  const nodes: ReactNode[] = []
  let cursor = 0
  for (const span of spans) {
    if (span.start > cursor) nodes.push(text.slice(cursor, span.start))
    nodes.push(
      <span
        key={`${span.start}-${span.id}`}
        className="inline-flex items-center rounded-md bg-primary/15 px-1.5 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/25"
        title={`Progress Pulse skill: ${span.label}`}
      >
        {text.slice(span.start, span.end)}
      </span>,
    )
    cursor = span.end
  }
  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}

export function pulseSkillLabel(id: string): string {
  return LABEL_BY_ID[id] ?? id
}
