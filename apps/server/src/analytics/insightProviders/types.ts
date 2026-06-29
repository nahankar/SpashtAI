import type { SkillScores, TextSignals } from '../skillScores'

export type InsightProviderId = 'local-audio' | 'bedrock-audio' | 'bedrock-text'

export interface PracticePlanItem {
  title: string
  description: string
  focusSkill: string
}

export interface MeetingSummary {
  topicsDiscussed: string[]
  keyOutcomes: string[]
  openQuestions: string[]
}

export interface CoachingInsights {
  topStrength: string
  primaryImprovement: string
  actionableAdvice: string
  practiceExercise: string
  practicePlan: PracticePlanItem[]
  decisionClarity: {
    decisionsDetected: number
    actionItemsDetected: number
    decisions: string[]
    actionItems: string[]
    summary: string
  }
  meetingSummary: MeetingSummary | null
  topicFlow: string
  overallNarrative: string
  promptTokens: number
  completionTokens: number
  /** Which provider produced these insights (for debugging) */
  insightProvider?: InsightProviderId
  error?: string
}

export interface CoachingContext {
  skillScores: SkillScores
  signals: TextSignals
  sessionName?: string
  focusArea?: string
  totalMessages: number
  durationSec: number
  /** Absolute path to session audio (user track preferred) */
  audioPath?: string
  audioMime?: string
  /** Override Bedrock model id (admin-configured Replay LLM); text provider only. */
  modelId?: string
}

export function emptyCoachingInsights(error?: string): CoachingInsights {
  return {
    topStrength: '',
    primaryImprovement: '',
    actionableAdvice: '',
    practiceExercise: '',
    practicePlan: [],
    decisionClarity: {
      decisionsDetected: 0,
      actionItemsDetected: 0,
      decisions: [],
      actionItems: [],
      summary: '',
    },
    meetingSummary: null,
    topicFlow: '',
    overallNarrative: '',
    promptTokens: 0,
    completionTokens: 0,
    error,
  }
}
