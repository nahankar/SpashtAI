import type { CoachingInsights } from './types'

export function parseCoachingJson(
  outputText: string,
  usage: { inputTokens?: number; outputTokens?: number } = {},
): CoachingInsights {
  const jsonMatch = outputText.match(/\{[\s\S]*\}/)
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : outputText)
  const dc = parsed.decisionClarity || {}

  return {
    topStrength: parsed.topStrength || '',
    primaryImprovement: parsed.primaryImprovement || '',
    actionableAdvice: parsed.actionableAdvice || '',
    practiceExercise: parsed.practiceExercise || '',
    practicePlan: Array.isArray(parsed.practicePlan) ? parsed.practicePlan : [],
    decisionClarity: {
      decisionsDetected: dc.decisionsDetected ?? 0,
      actionItemsDetected: dc.actionItemsDetected ?? 0,
      decisions: Array.isArray(dc.decisions) ? dc.decisions : [],
      actionItems: Array.isArray(dc.actionItems) ? dc.actionItems : [],
      summary: dc.summary || '',
    },
    meetingSummary: parsed.meetingSummary
      ? {
          topicsDiscussed: Array.isArray(parsed.meetingSummary.topicsDiscussed)
            ? parsed.meetingSummary.topicsDiscussed
            : [],
          keyOutcomes: Array.isArray(parsed.meetingSummary.keyOutcomes)
            ? parsed.meetingSummary.keyOutcomes
            : [],
          openQuestions: Array.isArray(parsed.meetingSummary.openQuestions)
            ? parsed.meetingSummary.openQuestions
            : [],
        }
      : null,
    topicFlow: parsed.topicFlow || '',
    overallNarrative: parsed.overallNarrative || '',
    promptTokens: usage.inputTokens ?? 0,
    completionTokens: usage.outputTokens ?? 0,
  }
}
