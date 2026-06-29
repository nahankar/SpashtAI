/**
 * Per-turn "better phrasing" suggestions for the Playback view.
 *
 * For a *few* of the user's most improvable turns, we ask the configured LLM
 * (Bedrock Nova or a local Ollama-compatible endpoint — same selection as the
 * coaching insights pipeline) whether the wording could be tightened or made
 * clearer, and return a short, specific suggestion + optional rewrite.
 *
 * This is deliberately small and best-effort: it never throws to the caller
 * (returns [] on any failure) and is cached in-memory per session so we don't
 * re-spend tokens on every Playback open.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { getBedrockClient } from './insightProviders/bedrockClient'

export interface TurnSuggestion {
  turnIndex: number
  /** What kind of improvement this is. */
  kind: 'concise' | 'wording' | 'clarity'
  /** One-sentence, specific coaching note. */
  suggestion: string
  /** Optional tightened rewrite of the turn (short). */
  rewrite?: string
}

interface TurnLike {
  turnIndex: number
  role: string
  text?: string | null
  metrics?: unknown
}

interface Candidate {
  turnIndex: number
  text: string
  wordCount: number
  fillers: number
}

const CACHE_TTL_MS = 1000 * 60 * 30
const cache = new Map<string, { at: number; data: TurnSuggestion[] }>()

/** Hard cap so we only ever spend tokens on a handful of turns. */
const MAX_TURNS = 3
const MIN_WORDS = 18

function isEnabled(): boolean {
  return process.env.ENABLE_TURN_SUGGESTIONS !== '0'
}

function usingLocalProvider(): boolean {
  return (process.env.INSIGHT_PROVIDER || '').trim().toLowerCase() === 'local-audio'
}

function getTimeoutMs(): number {
  return parseInt(process.env.INSIGHT_REQUEST_TIMEOUT_MS || '', 10) || 60_000
}

/** Pick the handful of turns with the most room to improve (long / filler-heavy). */
function selectCandidates(turns: TurnLike[]): Candidate[] {
  const scored: (Candidate & { score: number })[] = []
  for (const t of turns) {
    if (t.role !== 'user') continue
    const text = (t.text || '').trim()
    if (!text) continue
    const m = (t.metrics || {}) as Record<string, unknown>
    const wordCount =
      typeof m.word_count === 'number' ? (m.word_count as number) : text.split(/\s+/).length
    if (wordCount < MIN_WORDS) continue
    const fillers = typeof m.filler_count === 'number' ? (m.filler_count as number) : 0
    scored.push({
      turnIndex: t.turnIndex,
      text,
      wordCount,
      fillers,
      score: wordCount + fillers * 12,
    })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_TURNS).map(({ score: _score, ...c }) => c)
}

function buildPrompt(candidates: Candidate[]): string {
  const items = candidates
    .map((c) => `Turn ${c.turnIndex} (${c.wordCount} words):\n"""${c.text}"""`)
    .join('\n\n')

  return [
    'You are a concise, encouraging communication coach reviewing a few spoken answers from a practice session.',
    'For EACH turn below, decide if the speaker could improve it by being more concise, using stronger/clearer word choices, or sharpening the structure.',
    'Only flag a turn if there is a genuinely useful improvement — if a turn is already strong, OMIT it from the output.',
    'Keep each suggestion to ONE short sentence. The optional rewrite must be a tightened version of what they actually said (do not invent new facts).',
    '',
    'Return ONLY a JSON array (no prose, no code fences) of objects with this shape:',
    '[{ "turnIndex": number, "kind": "concise" | "wording" | "clarity", "suggestion": string, "rewrite": string }]',
    'Omit "rewrite" if a rewrite would not help. Return [] if nothing is worth flagging.',
    '',
    'Turns:',
    items,
  ].join('\n')
}

async function invokeBedrock(prompt: string): Promise<string> {
  const modelId =
    process.env.BEDROCK_COACHING_MODEL_ID ||
    process.env.BEDROCK_REPLAY_MODEL_ID ||
    'amazon.nova-pro-v1:0'
  const client = getBedrockClient()
  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 1024, temperature: 0.3, topP: 0.9 },
    }),
  })
  const response = await client.send(command)
  const raw = JSON.parse(new TextDecoder().decode(response.body))
  return raw.output?.message?.content?.[0]?.text ?? ''
}

async function invokeLocal(prompt: string): Promise<string> {
  const baseUrl = (process.env.LOCAL_AUDIO_INSIGHT_URL || 'http://localhost:11434/v1').replace(/\/$/, '')
  const model =
    process.env.LOCAL_TEXT_INSIGHT_MODEL || process.env.LOCAL_AUDIO_INSIGHT_MODEL || 'qwen2.5:14b'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), getTimeoutMs())
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ollama' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 1024,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Local LLM ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

function parseSuggestions(raw: string, validIndexes: Set<number>): TurnSuggestion[] {
  if (!raw) return []
  // Strip code fences and grab the first JSON array.
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []

  const out: TurnSuggestion[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const turnIndex = typeof o.turnIndex === 'number' ? o.turnIndex : Number(o.turnIndex)
    const suggestion = typeof o.suggestion === 'string' ? o.suggestion.trim() : ''
    if (!Number.isFinite(turnIndex) || !validIndexes.has(turnIndex) || !suggestion) continue
    const kindRaw = typeof o.kind === 'string' ? o.kind.toLowerCase() : ''
    const kind: TurnSuggestion['kind'] =
      kindRaw === 'concise' || kindRaw === 'wording' || kindRaw === 'clarity'
        ? (kindRaw as TurnSuggestion['kind'])
        : 'wording'
    const rewrite = typeof o.rewrite === 'string' && o.rewrite.trim() ? o.rewrite.trim() : undefined
    out.push({ turnIndex, kind, suggestion, rewrite })
  }
  return out
}

/**
 * Generate (or return cached) per-turn phrasing suggestions for a session.
 * Best-effort: returns [] if disabled, no candidates, or the LLM call fails.
 */
export async function generateTurnSuggestions(
  sessionId: string,
  turns: TurnLike[],
): Promise<TurnSuggestion[]> {
  if (!isEnabled()) return []

  const cached = cache.get(sessionId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data

  const candidates = selectCandidates(turns)
  if (candidates.length === 0) {
    cache.set(sessionId, { at: Date.now(), data: [] })
    return []
  }

  try {
    const prompt = buildPrompt(candidates)
    const raw = usingLocalProvider() ? await invokeLocal(prompt) : await invokeBedrock(prompt)
    const validIndexes = new Set(candidates.map((c) => c.turnIndex))
    const data = parseSuggestions(raw, validIndexes)
    cache.set(sessionId, { at: Date.now(), data })
    return data
  } catch (err: any) {
    console.warn(`[turn-suggestions] generation failed for ${sessionId}: ${err?.message || err}`)
    // Cache the empty result briefly so a broken provider doesn't get hammered.
    cache.set(sessionId, { at: Date.now(), data: [] })
    return []
  }
}
