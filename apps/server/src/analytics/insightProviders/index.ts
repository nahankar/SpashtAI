import { existsSync } from 'fs'
import { generateBedrockAudioInsights } from './bedrockAudio'
import { generateBedrockTextInsights } from './bedrockText'
import { generateLocalAudioInsights } from './localAudio'
import type { CoachingContext, CoachingInsights, InsightProviderId } from './types'
import { emptyCoachingInsights } from './types'

export type {
  CoachingContext,
  CoachingInsights,
  InsightProviderId,
  PracticePlanItem,
  MeetingSummary,
} from './types'

export { resolveElevateSessionAudio, resolveReplayUploadAudio } from './resolveSessionAudio'

function getConfiguredProvider(): InsightProviderId {
  const raw = (process.env.INSIGHT_PROVIDER || '').trim().toLowerCase()
  if (raw === 'local-audio' || raw === 'bedrock-audio' || raw === 'bedrock-text') {
    return raw
  }
  // Safe default: text Bedrock (works without local audio models)
  return 'bedrock-text'
}

function hasReadableAudio(ctx: CoachingContext): boolean {
  return Boolean(ctx.audioPath && existsSync(ctx.audioPath))
}

/**
 * Generate coaching insights using the configured provider, with fallbacks.
 *
 * - local-audio: Ollama/OpenAI-compat (audio when file present, else text)
 * - bedrock-audio: Bedrock Converse + audio (prod, when INSIGHT_PROVIDER=bedrock-audio)
 * - bedrock-text: Nova Pro text-only (default / fallback)
 */
export async function generateCoachingInsights(ctx: CoachingContext): Promise<CoachingInsights> {
  const provider = getConfiguredProvider()
  const withAudio = hasReadableAudio(ctx)

  try {
    if (provider === 'local-audio') {
      return await generateLocalAudioInsights(ctx)
    }

    if (provider === 'bedrock-audio' && withAudio) {
      try {
        return await generateBedrockAudioInsights(ctx)
      } catch (audioErr: any) {
        console.warn(`[insights] bedrock-audio failed: ${audioErr.message}; falling back to bedrock-text`)
        return await generateBedrockTextInsights(ctx)
      }
    }

    if (provider === 'bedrock-audio' && !withAudio) {
      console.warn('[insights] bedrock-audio configured but no audio file; using bedrock-text')
    }

    return await generateBedrockTextInsights(ctx)
  } catch (err: any) {
    console.error(`[insights] Provider ${provider} failed:`, err)
    const empty = emptyCoachingInsights(err.message || 'Failed to generate insights')
    empty.insightProvider = provider
    return empty
  }
}
