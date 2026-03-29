/**
 * SpashtAI Skill Scoring Layer
 *
 * Converts normalized signal values into 8 user-facing skill scores (0-10).
 * Phase 1 covers 6 text-based skills; Delivery and Emotional Control
 * are null until audio signals become available (Phase 2).
 */

import {
  normalizeWpm,
  normalizeSpeedVariability,
  normalizeFillerRate,
  normalizeHedgingRate,
  normalizeReadability,
  normalizeSentenceLength,
  normalizeSentenceBrevity,
  normalizeSubordinateRatio,
  normalizeVocabDiversity,
  normalizeVocabSophistication,
  normalizeTopicCoherence,
  normalizeTopicDrift,
  normalizeResponseRelevance,
  normalizeTalkListenBalance,
  normalizeQuestionRate,
  normalizeIdeaStructure,
} from './normalization'

export interface TextSignals {
  speechRate: { wpm: number; variability: number; totalWords: number }
  fillers: { count: number; rate: number; byType: Record<string, number> }
  hedging: { count: number; rate: number; phrases: string[] }
  sentenceComplexity: {
    avgLength: number
    subordinateRatio: number
    readability: number
    fleschKincaid: number
    gunningFog: number
  }
  vocabDiversity: {
    ratio: number
    uniqueWords: number
    totalWords: number
    sophistication: number
  }
  topicCoherence: { avgSimilarity: number; driftCount: number }
  questionHandling: {
    questionsReceived: number
    avgResponseTime: number
    relevanceScores: number[]
  }
  talkListenBalance: { userRatio: number }
  interactionSignals: {
    questionsAsked: number
    participantReferences: number
    followUps: number
  }
  ideaStructure: { markerCount: number; markerTypes: Record<string, number> }
  entities?: {
    companies: string[]
    roles: string[]
    skills: string[]
    technologies: string[]
    people: string[]
  }
}

export interface SkillScores {
  clarity: number
  conciseness: number
  confidence: number
  structure: number
  engagement: number
  pacing: number
  delivery: number | null
  emotionalControl: number | null
}

export interface SkillBreakdown {
  scores: SkillScores
  components: Record<string, Record<string, number>>
}

function clamp(val: number): number {
  return Math.round(Math.min(10, Math.max(0, val)) * 10) / 10
}

/**
 * Compute the 8 skill scores from extracted text signals.
 */
export function calculateSkillScores(
  signals: TextSignals,
  totalMessages: number = 0,
): SkillBreakdown {
  const totalTurns = Math.max(1, Math.floor(totalMessages / 2))
  const estSentences = Math.max(
    1,
    Math.round(signals.speechRate.totalWords / Math.max(1, signals.sentenceComplexity.avgLength)),
  )

  // ── Clarity ──
  const c_readability = normalizeReadability(signals.sentenceComplexity.readability)
  const c_sentenceLen = normalizeSentenceLength(signals.sentenceComplexity.avgLength)
  const c_coherence = normalizeTopicCoherence(signals.topicCoherence.avgSimilarity)
  const clarity = clamp(0.4 * c_readability + 0.3 * c_sentenceLen + 0.3 * c_coherence)

  // ── Conciseness ──
  const cn_filler = normalizeFillerRate(signals.fillers.rate)
  const cn_vocabDiv = normalizeVocabDiversity(signals.vocabDiversity.ratio)
  const cn_brevity = normalizeSentenceBrevity(signals.sentenceComplexity.avgLength)
  const conciseness = clamp(0.5 * cn_filler + 0.3 * cn_vocabDiv + 0.2 * cn_brevity)

  // ── Confidence (Phase 1: text-only, no voice_stability) ──
  const cf_hedging = normalizeHedgingRate(signals.hedging.rate)
  const cf_filler = normalizeFillerRate(signals.fillers.rate)
  const confidence = clamp(0.55 * cf_hedging + 0.45 * cf_filler)

  // ── Structure ──
  const s_structure = normalizeIdeaStructure(signals.ideaStructure.markerCount, estSentences)
  const s_coherence = normalizeTopicCoherence(signals.topicCoherence.avgSimilarity)
  const s_sentStruct = normalizeSubordinateRatio(signals.sentenceComplexity.subordinateRatio)
  const structure = clamp(0.4 * s_structure + 0.35 * s_coherence + 0.25 * s_sentStruct)

  // ── Engagement ──
  const e_questions = normalizeQuestionRate(signals.interactionSignals.questionsAsked, totalTurns)
  const e_balance = normalizeTalkListenBalance(signals.talkListenBalance.userRatio)
  const e_relevance = normalizeResponseRelevance(signals.questionHandling.relevanceScores)
  const engagement = clamp(0.35 * e_questions + 0.35 * e_balance + 0.3 * e_relevance)

  // ── Pacing (Phase 1: text-estimated only) ──
  const p_rate = normalizeWpm(signals.speechRate.wpm)
  const p_variability = normalizeSpeedVariability(signals.speechRate.variability)
  const pacing = clamp(0.6 * p_rate + 0.4 * p_variability)

  // ── Delivery & Emotional Control (Phase 2: audio required) ──

  return {
    scores: {
      clarity,
      conciseness,
      confidence,
      structure,
      engagement,
      pacing,
      delivery: null,
      emotionalControl: null,
    },
    components: {
      clarity: { readability: c_readability, sentenceLength: c_sentenceLen, coherence: c_coherence },
      conciseness: { fillerPenalty: cn_filler, vocabDiversity: cn_vocabDiv, sentenceBrevity: cn_brevity },
      confidence: { hedging: cf_hedging, fillers: cf_filler },
      structure: { ideaStructure: s_structure, coherence: s_coherence, sentenceStructure: s_sentStruct },
      engagement: { questionRate: e_questions, talkBalance: e_balance, responseRelevance: e_relevance },
      pacing: { speechRate: p_rate, variability: p_variability },
    },
  }
}

/**
 * Compute a weighted overall communication score from skill scores.
 * Weights: Clarity 25%, Confidence 20%, Engagement 15%, Structure 15%, Conciseness 15%, Pacing 10%
 * Applies a -0.5 penalty if any skill is below 3.
 */
export function calculateWeightedOverallScore(scores: SkillScores): number {
  const weights: { key: keyof SkillScores; weight: number }[] = [
    { key: 'clarity', weight: 0.25 },
    { key: 'confidence', weight: 0.20 },
    { key: 'engagement', weight: 0.15 },
    { key: 'structure', weight: 0.15 },
    { key: 'conciseness', weight: 0.15 },
    { key: 'pacing', weight: 0.10 },
  ]

  let totalWeight = 0
  let weightedSum = 0
  let hasLowSkill = false

  for (const { key, weight } of weights) {
    const val = scores[key]
    if (val == null) continue
    weightedSum += val * weight
    totalWeight += weight
    if (val < 3) hasLowSkill = true
  }

  if (totalWeight === 0) return 0

  let overall = weightedSum / totalWeight
  if (hasLowSkill) overall = Math.max(0, overall - 0.5)

  return Math.round(overall * 10) / 10
}
