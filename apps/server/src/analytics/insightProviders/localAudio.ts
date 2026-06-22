import { buildCoachingPrompt } from '../coachingPrompt'
import { parseCoachingJson } from './parseInsights'
import { readAudioBytes } from './readAudio'
import type { CoachingContext, CoachingInsights } from './types'

const DEFAULT_URL = 'http://localhost:11434/v1'
const DEFAULT_TEXT_MODEL = 'qwen2.5:14b'
const DEFAULT_AUDIO_MODEL = 'qwen2.5:14b'

function getTimeoutMs(): number {
  return parseInt(process.env.INSIGHT_REQUEST_TIMEOUT_MS || '', 10) || 120_000
}

function openAiAudioFormat(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (ext === 'mp3' || ext === 'mpeg') return 'mp3'
  if (ext === 'wav') return 'wav'
  if (ext === 'webm') return 'webm'
  if (ext === 'ogg') return 'ogg'
  return 'wav'
}

async function chatCompletions(
  baseUrl: string,
  model: string,
  content: unknown[],
): Promise<{ text: string; usage: { inputTokens?: number; outputTokens?: number } }> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), getTimeoutMs())

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ollama',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content }],
        temperature: 0.4,
        max_tokens: 3072,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const errBody = await res.text()
      throw new Error(`Local insight API ${res.status}: ${errBody.slice(0, 500)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    const text = data.choices?.[0]?.message?.content ?? ''
    return {
      text,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Text-only coaching via local OpenAI-compatible endpoint (Ollama). */
export async function generateLocalTextInsights(ctx: CoachingContext): Promise<CoachingInsights> {
  const baseUrl = process.env.LOCAL_AUDIO_INSIGHT_URL || DEFAULT_URL
  const model = process.env.LOCAL_TEXT_INSIGHT_MODEL || process.env.LOCAL_AUDIO_INSIGHT_MODEL || DEFAULT_TEXT_MODEL
  const prompt = buildCoachingPrompt(ctx, { includeAudioInstructions: false })

  const { text, usage } = await chatCompletions(baseUrl, model, [{ type: 'text', text: prompt }])
  const insights = parseCoachingJson(text, usage)
  insights.insightProvider = 'local-audio'
  return insights
}

/**
 * Audio + text coaching via Ollama OpenAI-compatible API.
 * Uses input_audio when a file is present; falls back to text-only on 4xx from the server.
 */
export async function generateLocalAudioInsights(ctx: CoachingContext): Promise<CoachingInsights> {
  if (!ctx.audioPath) {
    return generateLocalTextInsights(ctx)
  }

  const baseUrl = process.env.LOCAL_AUDIO_INSIGHT_URL || DEFAULT_URL
  const model = process.env.LOCAL_AUDIO_INSIGHT_MODEL || DEFAULT_AUDIO_MODEL
  const prompt = buildCoachingPrompt(ctx, { includeAudioInstructions: true })
  const bytes = readAudioBytes(ctx.audioPath)
  const format = openAiAudioFormat(ctx.audioPath)
  const b64 = Buffer.from(bytes).toString('base64')

  const contentWithAudio: unknown[] = [
    { type: 'text', text: prompt },
    {
      type: 'input_audio',
      input_audio: { data: b64, format },
    },
  ]

  try {
    const { text, usage } = await chatCompletions(baseUrl, model, contentWithAudio)
    const insights = parseCoachingJson(text, usage)
    insights.insightProvider = 'local-audio'
    return insights
  } catch (audioErr: any) {
    console.warn(
      `[insights] Local audio request failed (${audioErr.message}); retrying text-only with ${model}`,
    )
    return generateLocalTextInsights(ctx)
  }
}
