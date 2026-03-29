/**
 * SpashtAI Progress Pulse Integration
 *
 * Maps skill scores to Progress Pulse entries with trend smoothing.
 * Automatically creates pulse entries from the analytics pipeline.
 */

import type { SkillScores } from './skillScores'
import { prisma } from '../lib/prisma'

const TREND_CURRENT_WEIGHT = 0.7
const TREND_HISTORY_WEIGHT = 0.3

export interface PulseEntry {
  skill: string
  score: number
  metadata?: Record<string, any>
}

/**
 * Convert skill scores into Progress Pulse entries.
 * Only includes skills that have non-null scores.
 */
export function skillScoresToPulseEntries(
  scores: SkillScores,
  components?: Record<string, Record<string, number>>,
): PulseEntry[] {
  const entries: PulseEntry[] = []

  const skillMap: [keyof SkillScores, string][] = [
    ['clarity', 'clarity'],
    ['conciseness', 'conciseness'],
    ['confidence', 'confidence'],
    ['structure', 'structure'],
    ['engagement', 'engagement'],
    ['pacing', 'pacing'],
    ['delivery', 'delivery'],
    ['emotionalControl', 'emotional_control'],
  ]

  for (const [key, pulseSkill] of skillMap) {
    const val = scores[key]
    if (val === null || val === undefined) continue
    entries.push({
      skill: pulseSkill,
      score: val,
      metadata: components?.[key],
    })
  }

  return entries
}

/**
 * Apply trend smoothing: blends current score with historical average
 * to prevent wild swings in Progress Pulse.
 */
export async function getSmoothedScore(
  userId: string,
  skill: string,
  currentScore: number,
): Promise<number> {
  const history = await prisma.progressPulse.findMany({
    where: { userId, skill },
    orderBy: { recordedAt: 'desc' },
    take: 5,
    select: { score: true },
  })

  if (history.length === 0) return currentScore

  const historicalAvg = history.reduce((sum, h) => sum + h.score, 0) / history.length
  return Math.round(
    (TREND_CURRENT_WEIGHT * currentScore + TREND_HISTORY_WEIGHT * historicalAvg) * 10,
  ) / 10
}

/**
 * Save skill scores to Progress Pulse for a session.
 */
export async function saveSkillScoresToPulse(
  userId: string,
  sessionId: string,
  source: 'elevate' | 'replay',
  scores: SkillScores,
  components?: Record<string, Record<string, number>>,
): Promise<number> {
  const entries = skillScoresToPulseEntries(scores, components)
  if (entries.length === 0) return 0

  const smoothedEntries = await Promise.all(
    entries.map(async (e) => ({
      ...e,
      score: await getSmoothedScore(userId, e.skill, e.score),
    })),
  )

  await prisma.progressPulse.createMany({
    data: smoothedEntries.map((e) => ({
      userId,
      sessionId,
      source,
      skill: e.skill,
      score: e.score,
      metadata: e.metadata ?? undefined,
    })),
  })

  return smoothedEntries.length
}
