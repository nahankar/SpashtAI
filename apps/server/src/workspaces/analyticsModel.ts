import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { getBedrockClient } from '../analytics/insightProviders/bedrockClient'
import { logger } from '../lib/logger'

const MODEL_ID = process.env.BEDROCK_ADMIN_ANALYTICS_MODEL_ID || process.env.BEDROCK_COACH_FAST_MODEL_ID || 'amazon.nova-pro-v1:0'
const TIMEOUT_MS = Math.max(2_000, Number(process.env.ADMIN_ANALYTICS_AI_TIMEOUT_MS || 12_000))

/** One bounded model call that returns raw text; callers validate it against the allowlisted plan contract. */
export async function completeWorkspaceAnalytics(prompt: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const startedAt = Date.now()
  try {
    const response = await getBedrockClient().send(new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 800, temperature: 0, topP: 0.9 },
    }), { abortSignal: controller.signal })
    logger.info({ event: 'workspace_analytics.interpret', modelId: MODEL_ID, latencyMs: Date.now() - startedAt,
      inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens })
    return response.output?.message?.content?.find(block => 'text' in block)?.text ?? ''
  } finally {
    clearTimeout(timer)
  }
}
