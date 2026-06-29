import { FOCUS_AREAS, getFocusAreaLabel, EXERCISE_PREVIEWS } from './focus-areas'
import { pulseSkillLabel } from './pulse-skills'
import type { SessionReport } from './generate-session-pdf'

/** Maps a skill/score key to a practiceable Elevate focus-area id. */
const SKILL_TO_FOCUS: Record<string, string> = {
  clarity: 'clarity',
  conciseness: 'conciseness',
  confidence: 'confidence',
  structure: 'structure',
  engagement: 'engagement',
  pacing: 'pacing',
  delivery: 'pacing',
  emotionalControl: 'confidence',
}

export interface ReportExtrasInput {
  apiBase: string
  headers: HeadersInit
  /** Per-skill scores (0–10) for this session; used as a fallback for Next Steps. */
  scores: Record<string, number | null>
  /** This session's overall score (0–10) for the summary line. */
  overallScore?: number | null
  coaching?: { overallNarrative?: string; topStrength?: string } | null
}

export interface ReportExtras {
  summary: string | null
  progressPulse: NonNullable<SessionReport['progressPulse']>
  nextSteps: NonNullable<SessionReport['nextSteps']>
}

/**
 * Builds the standardized "extras" shared by every SpashtAI PDF report:
 * a report summary, the cross-session Progress Pulse standing, and recommended
 * next steps with deep links back into Elevate. Keeps Elevate and Replay
 * reports identical so they never drift apart.
 */
export async function buildReportExtras(input: ReportExtrasInput): Promise<ReportExtras> {
  const { apiBase, headers, scores, overallScore, coaching } = input

  // ── Progress Pulse (cross-session trends) ──
  let progressPulse: ReportExtras['progressPulse'] = []
  try {
    const pulseRes = await fetch(`${apiBase}/api/progress-pulse/summary`, { headers })
    if (pulseRes.ok) {
      const pulseData = await pulseRes.json()
      const items = Array.isArray(pulseData?.summary) ? pulseData.summary : []
      progressPulse = items.map((it: any) => ({
        skill: it.skill,
        label: pulseSkillLabel(it.skill),
        currentScore: Number(it.currentScore) || 0,
        delta: it.delta ?? null,
      }))
    }
  } catch {
    /* pulse is optional */
  }

  // ── Report summary: how the session went + Progress Pulse standing ──
  const summaryParts: string[] = []
  if (overallScore != null) {
    summaryParts.push(`This session scored ${overallScore.toFixed(1)}/10 overall.`)
  }
  if (coaching?.overallNarrative) {
    summaryParts.push(coaching.overallNarrative)
  } else if (coaching?.topStrength) {
    summaryParts.push(coaching.topStrength)
  }
  if (progressPulse.length) {
    const pulseAvg =
      progressPulse.reduce((s, p) => s + (p.currentScore || 0), 0) / progressPulse.length
    const improving = progressPulse
      .filter((p) => (p.delta ?? 0) > 0.3)
      .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))
      .map((p) => p.label)
    const weakest = [...progressPulse].sort((a, b) => a.currentScore - b.currentScore)[0]
    let pulseLine = `Across your tracked sessions, your communication skills average ${pulseAvg.toFixed(1)}/10.`
    if (improving.length) {
      pulseLine += ` You're improving in ${improving.slice(0, 2).join(' and ')}.`
    }
    if (weakest && weakest.currentScore < 7) {
      pulseLine += ` ${weakest.label} needs the most attention right now.`
    }
    summaryParts.push(pulseLine)
  }
  const summary = summaryParts.length ? summaryParts.join(' ') : null

  // ── Recommended next steps: targeted practice with deep links to Elevate ──
  const weakSource: { key: string; score: number }[] = progressPulse.length
    ? progressPulse.map((p) => ({ key: p.skill, score: p.currentScore }))
    : Object.entries(scores)
        .filter(([, v]) => typeof v === 'number')
        .map(([k, v]) => ({ key: k, score: v as number }))

  const targetFocus: string[] = []
  for (const { key } of weakSource.sort((a, b) => a.score - b.score)) {
    const fid = SKILL_TO_FOCUS[key] ?? key
    if (FOCUS_AREAS.some((f) => f.id === fid) && !targetFocus.includes(fid)) targetFocus.push(fid)
    if (targetFocus.length >= 3) break
  }
  if (targetFocus.length === 0) targetFocus.push('clarity', 'pacing')

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const nextSteps = targetFocus.map((fid) => {
    const fa = FOCUS_AREAS.find((f) => f.id === fid)
    const ex = EXERCISE_PREVIEWS[fid]
    const title = ex?.name ? `${ex.name} (${fa?.label ?? fid})` : `Practice: ${fa?.label ?? fid}`
    const description = [fa?.description, ex?.duration ? `~${ex.duration}.` : '', ex?.steps?.[0]]
      .filter(Boolean)
      .join(' — ')
    return { title, description, url: `${origin}/elevate?focusArea=${encodeURIComponent(fid)}` }
  })

  return { summary, progressPulse, nextSteps }
}

// Re-export for callers that build subtitles/labels alongside the extras.
export { getFocusAreaLabel }
