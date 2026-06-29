import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { buildCoachingPrompt } from '../coachingPrompt'
import { getBedrockClient } from './bedrockClient'
import { parseCoachingJson } from './parseInsights'
import type { CoachingContext, CoachingInsights } from './types'

const BEDROCK_MODEL_ID =
  process.env.BEDROCK_COACHING_MODEL_ID ||
  process.env.BEDROCK_REPLAY_MODEL_ID ||
  'amazon.nova-pro-v1:0'

export async function generateBedrockTextInsights(ctx: CoachingContext): Promise<CoachingInsights> {
  const prompt = buildCoachingPrompt(ctx, { includeAudioInstructions: false })
  const client = getBedrockClient()

  const body = JSON.stringify({
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: 3072,
      temperature: 0.4,
      topP: 0.9,
    },
  })

  const command = new InvokeModelCommand({
    modelId: ctx.modelId || BEDROCK_MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body,
  })

  const response = await client.send(command)
  const raw = JSON.parse(new TextDecoder().decode(response.body))
  const outputText: string = raw.output?.message?.content?.[0]?.text ?? ''
  const usage = raw.usage ?? {}

  const insights = parseCoachingJson(outputText, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  })
  insights.insightProvider = 'bedrock-text'
  return insights
}
