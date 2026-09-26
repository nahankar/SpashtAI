import { buildReplayEvidence, legacyInput, neutralContent, replaySegments, type ReplayEvidenceInput, type ReplaySelection } from './replay-evidence'
import { calculateReplayMetrics } from './replay-metrics'
import { guardPaceClaims } from '../analytics/paceClaims'
import { calculateWeightedOverallScore, type SkillScores } from '../analytics/skillScores'
import type { TranscriptSegment } from './transcript-parser'

export function meetingOnlyInsights(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  if (!source.meetingSummary && !source.decisionClarity) return null
  return { meetingSummary: source.meetingSummary ?? null, decisionClarity: source.decisionClarity ?? null }
}

/** Public allowlist: old numeric columns and provider evidence never certify delivery. */
export function replayResultView(row: Record<string, any>, selection: ReplaySelection | null) {
  const segments = replaySegments(row.structuredTranscript)
  const raw = row.deliveryEvidence as ReplayEvidenceInput | null
  const input = raw?.version === 'replay-delivery-v1' ? raw : legacyInput(segments, row.transcriptionSource)
  const evidence = buildReplayEvidence(input, selection, segments)
  const text = evidence.identity.state === 'confirmed' ? calculateReplayMetrics(segments, evidence.identity.speaker!) : null
  const sameAssessment = evidence.identity.state === 'confirmed' && !!input.analysisSelectionRevision && input.analysisSelectionRevision === selection?.revision
  const keys = ['clarity', 'conciseness', 'confidence', 'structure', 'engagement', 'pacing', 'delivery', 'emotionalControl'] as const
  const scores = Object.fromEntries(keys.map(key => {
    const value = sameAssessment ? row.skillScores?.scores?.[key] : null
    const allowed = key !== 'delivery' && key !== 'emotionalControl' && (key !== 'pacing' || evidence.pace.wpm != null)
    return [key, allowed && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null]
  })) as unknown as SkillScores
  // Never spread stored score envelopes: legacy signals can include private
  // transcript excerpts and unsupported score dimensions.
  const components = Object.fromEntries(keys.filter(key => scores[key] != null).map(key => {
    const value = row.skillScores?.components?.[key]
    return [key, value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, n]) => typeof n === 'number' && Number.isFinite(n))) : {}]
  }))
  const skills = Object.values(scores).some(v => v != null) ? { scores, components } : null
  const coaching = sameAssessment ? neutralContent(guardPaceClaims(row.coachingInsights, evidence.pace.wpm != null)) : meetingOnlyInsights(row.coachingInsights)
  return { evidence, skillScores: skills, coachingInsights: coaching, result: {
    transcriptText: row.transcriptText ?? '', structuredTranscript: segments,
    speakerCount: row.speakerCount, transcriptionSource: row.transcriptionSource,
    wordsPerMinute: evidence.pace.wpm, paceStatus: evidence.pace.status,
    fillerWordCount: text?.fillerWordCount ?? null, fillerWordRate: text?.fillerWordRate ?? null,
    hedgingCount: text?.hedgingCount ?? null, hedgingRate: text?.hedgingRate ?? null,
    avgSentenceLength: text?.avgSentenceLength ?? null, vocabularyDiversity: text?.vocabularyDiversity ?? null,
    totalTurns: text?.totalTurns ?? null, wordShare: text?.speakingPercentage ?? null,
    speakingPercentage: null, interruptionCount: null, longestMonologueSec: null, avgResponseTimeSec: null,
    questionsAsked: text?.questionsAsked ?? null, repetitionRequests: null,
    overallScore: skills ? calculateWeightedOverallScore(skills.scores as SkillScores) : null,
    clarityScore: skills?.scores.clarity ?? null, confidenceScore: skills?.scores.confidence ?? null, engagementScore: skills?.scores.engagement ?? null,
    strengths: (neutralContent(row.strengths, sameAssessment) ?? []) as unknown[], improvements: (neutralContent(row.improvements, sameAssessment) ?? []) as unknown[],
    recommendations: (neutralContent(row.recommendations, sameAssessment) ?? []) as unknown[], contextSpecificFeedback: (neutralContent(row.contextSpecificFeedback, sameAssessment) ?? []) as unknown[],
    keyMoments: sameAssessment ? neutralContent(row.keyMoments) : [],
    annotatedTranscript: sameAssessment && Array.isArray(row.annotatedTranscript) ? row.annotatedTranscript.filter((s: TranscriptSegment) => s && s.speaker === selection?.speaker && typeof s.text === 'string') : [],
    skillScores: skills, coachingInsights: coaching,
    modelUsed: row.modelUsed, promptTokens: row.promptTokens, completionTokens: row.completionTokens, processingTimeMs: row.processingTimeMs,
    feedbackScope: sameAssessment ? 'Text-based assessment for your confirmed speaker. Vocal personality, emotion and competence are not inferred.' : 'Unattributed content notes from the original analysis—not an assessment of your selected speaker. Confirm a speaker, then re-analyze for personalized content feedback; valid cached transcription is reused.',
  } }
}
