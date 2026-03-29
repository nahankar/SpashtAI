/**
 * SpashtAI Insight Generator
 *
 * Calls AWS Bedrock (Claude / Nova) with the coaching prompt and parses
 * the structured JSON response into coaching insights.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime'
import { buildCoachingPrompt, type CoachingContext } from './coachingPrompt'

const BEDROCK_MODEL_ID = process.env.BEDROCK_COACHING_MODEL_ID
  || process.env.BEDROCK_REPLAY_MODEL_ID
  || 'amazon.nova-pro-v1:0'

const client = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})

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
  error?: string
}

export async function generateCoachingInsights(
  ctx: CoachingContext,
): Promise<CoachingInsights> {
  const prompt = buildCoachingPrompt(ctx)

  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: 3072,
      temperature: 0.4,
      topP: 0.9,
    },
  })

  try {
    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body,
    })

    const response = await client.send(command)
    const raw = JSON.parse(new TextDecoder().decode(response.body))

    const outputText: string = raw.output?.message?.content?.[0]?.text ?? ''
    const usage = raw.usage ?? {}

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
            topicsDiscussed: Array.isArray(parsed.meetingSummary.topicsDiscussed) ? parsed.meetingSummary.topicsDiscussed : [],
            keyOutcomes: Array.isArray(parsed.meetingSummary.keyOutcomes) ? parsed.meetingSummary.keyOutcomes : [],
            openQuestions: Array.isArray(parsed.meetingSummary.openQuestions) ? parsed.meetingSummary.openQuestions : [],
          }
        : null,
      topicFlow: parsed.topicFlow || '',
      overallNarrative: parsed.overallNarrative || '',
      promptTokens: usage.inputTokens ?? 0,
      completionTokens: usage.outputTokens ?? 0,
    }
  } catch (err: any) {
    console.error('Coaching insight generation failed:', err)
    return {
      topStrength: '',
      primaryImprovement: '',
      actionableAdvice: '',
      practiceExercise: '',
      practicePlan: [],
      decisionClarity: { decisionsDetected: 0, actionItemsDetected: 0, decisions: [], actionItems: [], summary: '' },
      meetingSummary: null,
      topicFlow: '',
      overallNarrative: '',
      promptTokens: 0,
      completionTokens: 0,
      error: err.message || 'Failed to generate insights',
    }
  }
}
