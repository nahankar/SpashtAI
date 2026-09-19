import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime'
import { getBedrockClient } from '../analytics/insightProviders/bedrockClient'

/**
 * Coach runs two tiers. Conversational turns are latency-sensitive and happen on
 * every message, so they use the cheaper/faster model. Interpreting a finished
 * session happens once per session and is the output users judge Coach on, so it
 * uses the stronger model.
 */
export const COACH_FAST_MODEL_ID =
  process.env.BEDROCK_COACH_FAST_MODEL_ID || 'amazon.nova-lite-v1:0'

export const COACH_DEEP_MODEL_ID =
  process.env.BEDROCK_COACH_DEEP_MODEL_ID ||
  process.env.BEDROCK_REPLAY_MODEL_ID ||
  'amazon.nova-pro-v1:0'

const FAILURE_THRESHOLD = Math.max(
  1,
  Number.parseInt(process.env.BEDROCK_COACH_FAILURE_THRESHOLD || '1', 10) || 1,
)
const CIRCUIT_COOLDOWN_MS = Math.max(
  10_000,
  Number.parseInt(process.env.BEDROCK_COACH_CIRCUIT_COOLDOWN_MS || '60000', 10) || 60_000,
)
let consecutiveFailures = 0
let circuitOpenUntil = 0

/** Coach is optional. Credential resolution is delegated to the AWS SDK's full
 * default chain (env, profile/SSO, web identity, ECS and EC2 instance roles). */
export function isCoachLlmEnabled(): boolean {
  return process.env.COACH_LLM_DISABLED !== '1' && Date.now() >= circuitOpenUntil
}

export function markCoachLlmFailure(): void {
  consecutiveFailures += 1
  if (consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS
  }
}

export interface CoachModelOptions {
  modelId: string
  maxTokens?: number
  temperature?: number
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 6_000

/**
 * Invokes a Bedrock text model through Converse, which normalizes request and
 * response shapes across supported Nova and Anthropic models.
 */
export async function invokeCoachModel(
  prompt: string,
  { modelId, maxTokens = 700, temperature = 0.3, timeoutMs = DEFAULT_TIMEOUT_MS }: CoachModelOptions,
): Promise<string> {
  if (!isCoachLlmEnabled()) {
    throw new Error('Coach model circuit is open')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await getBedrockClient().send(
      new ConverseCommand({
        modelId,
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { maxTokens, temperature, topP: 0.9 },
      }),
      { abortSignal: controller.signal },
    )
    const text = response.output?.message?.content?.find((block) => 'text' in block)?.text ?? ''
    consecutiveFailures = 0
    circuitOpenUntil = 0
    return text
  } catch (error) {
    markCoachLlmFailure()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Extracts the first JSON object from a completion. Models intermittently wrap
 * JSON in prose or a fenced block even when told not to, so we locate the object
 * by brace balance rather than trusting the whole string to parse.
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth++
    else if (char === '}') {
      depth--
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1))
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}
