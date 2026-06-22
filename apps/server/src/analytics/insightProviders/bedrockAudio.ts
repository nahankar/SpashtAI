import { ConverseCommand, type AudioFormat } from '@aws-sdk/client-bedrock-runtime'
import { buildCoachingPrompt } from '../coachingPrompt'
import { getBedrockClient } from './bedrockClient'
import { parseCoachingJson } from './parseInsights'
import { bedrockAudioFormat } from './resolveSessionAudio'
import { readAudioBytes } from './readAudio'
import type { CoachingContext, CoachingInsights } from './types'

const BEDROCK_AUDIO_MODEL_ID =
  process.env.BEDROCK_COACHING_AUDIO_MODEL_ID || 'amazon.nova-2-sonic-v1:0'

export async function generateBedrockAudioInsights(ctx: CoachingContext): Promise<CoachingInsights> {
  if (!ctx.audioPath) {
    throw new Error('bedrock-audio requires audioPath on CoachingContext')
  }

  const prompt = buildCoachingPrompt(ctx, { includeAudioInstructions: true })
  const audioBytes = readAudioBytes(ctx.audioPath)
  const format = bedrockAudioFormat(ctx.audioPath) as AudioFormat
  const client = getBedrockClient()

  const command = new ConverseCommand({
    modelId: BEDROCK_AUDIO_MODEL_ID,
    messages: [
      {
        role: 'user',
        content: [
          { text: prompt },
          {
            audio: {
              format,
              source: { bytes: audioBytes },
            },
          },
        ],
      },
    ],
    inferenceConfig: {
      maxTokens: 3072,
      temperature: 0.4,
      topP: 0.9,
    },
  })

  const response = await client.send(command)
  const parts = response.output?.message?.content ?? []
  const outputText = parts.map((p) => ('text' in p ? p.text : '')).join('')
  const usage = (response.usage ?? {}) as {
    inputTokens?: number
    outputTokens?: number
  }

  const insights = parseCoachingJson(outputText, {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  })
  insights.insightProvider = 'bedrock-audio'
  return insights
}
