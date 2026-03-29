/**
 * SpashtAI Normalization Layer
 *
 * Converts raw signal values to a 0-10 scale using band-based thresholds.
 * Each normalizer is tuned for communication coaching benchmarks.
 */

/** Interpolate a value within defined bands to produce a 0-10 score. */
function bandScore(value: number, bands: [number, number, number][]): number {
  for (const [min, max, score] of bands) {
    if (value >= min && value <= max) return score
  }
  return bands[bands.length - 1][2]
}

// ── Speech Rate ──
// Calibrated for actual speaker speaking time (not full meeting duration).
// Ideal conversational pace: 120-160 WPM. Bell-curve scoring.

export function normalizeWpm(wpm: number): number {
  return bandScore(wpm, [
    [120, 160, 10],
    [100, 119, 8],
    [161, 180, 8],
    [90, 99, 6],
    [181, 200, 6],
    [70, 89, 4],
    [201, 220, 4],
    [0, 69, 3],
    [221, 9999, 3],
  ])
}

export function normalizeSpeedVariability(variability: number): number {
  if (variability <= 0.15) return 10
  if (variability <= 0.3) return 8
  if (variability <= 0.5) return 6
  if (variability <= 0.7) return 4
  return 3
}

// ── Fillers ──

export function normalizeFillerRate(rate: number): number {
  // rate is a decimal (e.g., 0.023 = 2.3%)
  const pct = rate * 100
  if (pct < 1) return 10
  if (pct < 2) return 8
  if (pct < 3) return 7
  if (pct < 5) return 5
  if (pct < 8) return 3
  return 1
}

// ── Hedging ──

export function normalizeHedgingRate(rate: number): number {
  const pct = rate * 100
  if (pct < 0.5) return 10
  if (pct < 1) return 8
  if (pct < 2) return 6
  if (pct < 3) return 4
  return 2
}

// ── Readability ──

export function normalizeReadability(fleschScore: number): number {
  // Flesch Reading Ease: higher = easier to understand
  // For spoken communication, 60-80 is ideal (conversational)
  if (fleschScore >= 60 && fleschScore <= 80) return 10
  if (fleschScore >= 50 && fleschScore < 60) return 8
  if (fleschScore > 80 && fleschScore <= 90) return 8
  if (fleschScore >= 40 && fleschScore < 50) return 6
  if (fleschScore > 90) return 7
  if (fleschScore >= 30 && fleschScore < 40) return 4
  return 2
}

// ── Sentence Length ──

export function normalizeSentenceLength(avgLength: number): number {
  // 10-18 words per sentence is ideal for spoken communication
  if (avgLength >= 10 && avgLength <= 18) return 10
  if (avgLength >= 8 && avgLength < 10) return 8
  if (avgLength > 18 && avgLength <= 22) return 7
  if (avgLength >= 5 && avgLength < 8) return 6
  if (avgLength > 22 && avgLength <= 28) return 5
  return 3
}

// ── Sentence Brevity (for conciseness — shorter = more concise) ──

export function normalizeSentenceBrevity(avgLength: number): number {
  if (avgLength > 0 && avgLength <= 12) return 10
  if (avgLength > 12 && avgLength <= 18) return 7
  if (avgLength > 18 && avgLength <= 25) return 5
  return 3
}

// ── Subordinate Clause Ratio ──

export function normalizeSubordinateRatio(ratio: number): number {
  // Tighter ideal: 25-35% subordinate clauses signals well-structured thought
  if (ratio >= 0.25 && ratio <= 0.35) return 10
  if (ratio >= 0.2 && ratio < 0.25) return 8
  if (ratio > 0.35 && ratio <= 0.4) return 8
  if (ratio >= 0.15 && ratio < 0.2) return 7
  if (ratio > 0.4 && ratio <= 0.5) return 6
  if (ratio >= 0.1 && ratio < 0.15) return 6
  if (ratio < 0.1) return 4
  return 4
}

// ── Vocabulary Diversity ──

export function normalizeVocabDiversity(ratio: number): number {
  if (ratio >= 0.6) return 10
  if (ratio >= 0.5) return 8
  if (ratio >= 0.4) return 7
  if (ratio >= 0.3) return 5
  return 3
}

export function normalizeVocabSophistication(score: number): number {
  // Already on a 0-10 scale from signal extraction
  return Math.min(10, Math.max(0, score))
}

// ── Topic Coherence ──

export function normalizeTopicCoherence(avgSimilarity: number): number {
  // Tightened: spaCy small model vectors tend to cluster high (0.85+),
  // so only truly exceptional coherence scores 10.
  if (avgSimilarity >= 0.85) return 9
  if (avgSimilarity >= 0.75) return 8
  if (avgSimilarity >= 0.65) return 7
  if (avgSimilarity >= 0.55) return 5
  return 3
}

export function normalizeTopicDrift(driftCount: number, totalMessages: number): number {
  if (totalMessages === 0) return 10
  const driftRate = driftCount / totalMessages
  if (driftRate < 0.05) return 10
  if (driftRate < 0.1) return 8
  if (driftRate < 0.2) return 6
  if (driftRate < 0.3) return 4
  return 2
}

// ── Question Handling ──

export function normalizeResponseRelevance(scores: number[]): number {
  if (scores.length === 0) return 7
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length
  return Math.min(10, Math.round(avg * 10))
}

// ── Talk/Listen Balance ──

export function normalizeTalkListenBalance(userRatio: number): number {
  // In a 1-on-1 coaching session, 40-60% is ideal
  if (userRatio >= 0.4 && userRatio <= 0.6) return 10
  if (userRatio >= 0.3 && userRatio < 0.4) return 7
  if (userRatio > 0.6 && userRatio <= 0.7) return 7
  if (userRatio >= 0.2 && userRatio < 0.3) return 5
  if (userRatio > 0.7 && userRatio <= 0.8) return 5
  return 3
}

// ── Interaction ──

export function normalizeQuestionRate(questionsAsked: number, totalTurns: number): number {
  if (totalTurns === 0) return 5
  const rate = questionsAsked / totalTurns
  if (rate >= 0.15 && rate <= 0.4) return 10
  if (rate >= 0.1 && rate < 0.15) return 8
  if (rate > 0.4 && rate <= 0.5) return 7
  if (rate < 0.1) return 5
  return 4
}

// ── Idea Structure ──

export function normalizeIdeaStructure(markerCount: number, totalSentences: number): number {
  if (totalSentences === 0) return 5
  const rate = markerCount / totalSentences
  // Tightened: conversational "so/ok/right" inflate markers, so ideal is narrower
  if (rate >= 0.12 && rate <= 0.25) return 9
  if (rate >= 0.08 && rate < 0.12) return 7
  if (rate > 0.25 && rate <= 0.35) return 7
  if (rate >= 0.05 && rate < 0.08) return 6
  if (rate > 0.35 && rate <= 0.5) return 5
  if (rate < 0.05) return 4
  return 4
}
