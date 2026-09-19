import { isCoachFocusArea } from './focusAreas'

export const PULSE_EVIDENCE_WINDOW_DAYS = 30
const TREND_THRESHOLD = 0.3
const STRONGEST_GAP = 0.5
const OPPORTUNITY_BELOW = 7

export type PulseEvidenceMode = 'scores' | 'relevant'
export type PulseTrend = 'up' | 'down' | 'steady' | 'latest'

export interface PulseSkillInput {
  skill: string
  score: number
  delta: number | null
  measurements: number
}

export interface PulseEvidenceSkill {
  skill: string
  score: number
  delta: number | null
  measurements: number
  trend: PulseTrend
}

export interface PulseEvidence {
  mode: PulseEvidenceMode
  windowDays: number
  measurementCount: number
  skills: PulseEvidenceSkill[]
  highlight: { kind: 'strongest' | 'highest'; skill: string }
  opportunity: { skill: string } | null
}

export function pulseTrend(delta: number | null, measurements: number): PulseTrend {
  if (measurements < 2 || delta == null) return 'latest'
  if (delta > TREND_THRESHOLD) return 'up'
  if (delta < -TREND_THRESHOLD) return 'down'
  return 'steady'
}

export function isPulseScoreQuestion(message: string): boolean {
  const text = message.toLowerCase().replace(/[’']/g, "'")
  return (
    /\b(what(?:'s| is| are)? my scores?|show (?:me )?my scores?|my (?:pulse )?scores?|scorecard)\b/.test(
      text,
    ) || /\b(progress pulse|pulse scores?)\b/.test(text)
  )
}

export function isPulseProgressQuestion(message: string): boolean {
  const text = message.toLowerCase().replace(/[’']/g, "'")
  if (isPulseScoreQuestion(text)) return false
  return /\b(how am i doing|how's my|how is my|am i improving|getting better|my progress)\b/.test(
    text,
  )
}

export function parseEvidenceMode(raw: unknown): PulseEvidenceMode | null {
  if (raw === 'scores' || raw === 'relevant') return raw
  if (raw === true) return 'relevant'
  return null
}

function isListedSkill(skill: string): boolean {
  return isCoachFocusArea(skill) && skill !== 'snapshot'
}

export function summarisePulseSkills(skills: PulseSkillInput[]): {
  highlight: PulseEvidence['highlight'] | null
  opportunity: PulseEvidence['opportunity']
} {
  const listed = skills.filter((skill) => isListedSkill(skill.skill))
  if (listed.length === 0) return { highlight: null, opportunity: null }

  const ranked = [...listed].sort((a, b) => b.score - a.score)
  const top = ranked[0]
  const second = ranked[1]
  const canCallStrongest =
    Boolean(second) &&
    top.measurements >= 2 &&
    top.score - second.score >= STRONGEST_GAP

  const weakest = [...listed].sort((a, b) => a.score - b.score)[0]
  const opportunity =
    listed.length >= 2 && weakest.skill !== top.skill && weakest.score < OPPORTUNITY_BELOW
      ? { skill: weakest.skill }
      : null

  return {
    highlight: {
      kind: canCallStrongest ? 'strongest' : 'highest',
      skill: top.skill,
    },
    opportunity,
  }
}

export function buildPulseEvidence(
  skills: PulseSkillInput[],
  meta: { windowDays: number; measurementCount: number },
  mode: PulseEvidenceMode,
  focusSkill?: string | null,
): PulseEvidence | null {
  const listed = skills
    .filter((skill) => isListedSkill(skill.skill))
    .map((skill) => ({
      skill: skill.skill,
      score: skill.score,
      delta: skill.delta,
      measurements: skill.measurements,
      trend: pulseTrend(skill.delta, skill.measurements),
    }))
  if (listed.length === 0 || meta.measurementCount < 1) return null

  const { highlight, opportunity } = summarisePulseSkills(listed)
  if (!highlight) return null

  const wanted = new Set<string>()
  if (mode === 'scores') {
    for (const skill of listed) wanted.add(skill.skill)
  } else {
    wanted.add(highlight.skill)
    if (opportunity) wanted.add(opportunity.skill)
    if (focusSkill && listed.some((skill) => skill.skill === focusSkill)) {
      wanted.add(focusSkill)
    }
  }

  const selected = listed
    .filter((skill) => wanted.has(skill.skill))
    .sort((a, b) => b.score - a.score)

  return {
    mode,
    windowDays: meta.windowDays,
    measurementCount: meta.measurementCount,
    skills: selected,
    highlight,
    opportunity,
  }
}

export function resolvePulseEvidenceMode(input: {
  message: string
  llmMode: PulseEvidenceMode | null
  hasClarification: boolean
}): PulseEvidenceMode | null {
  if (input.hasClarification) return null
  if (isPulseScoreQuestion(input.message)) return 'scores'
  if (isPulseProgressQuestion(input.message)) return 'relevant'
  if (input.llmMode) return input.llmMode
  return null
}
