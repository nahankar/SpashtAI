import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProviderConfig } from '../config.js'
import { encodeWav, type Pcm } from '../audio/pcm.js'
import { Budget, providerFetch } from './http.js'

const run = promisify(execFile)

export interface SpeechToText { readonly budget: Budget; transcribe(pcm: Pcm, signal?: AbortSignal): Promise<string> }
export interface TextToSpeech { readonly budget: Budget; readonly description: string; synthesize(text: string, signal?: AbortSignal): Promise<Buffer> }
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface ChatModel { readonly budget: Budget; readonly description: string; complete(messages: ChatMessage[], opts?: { json?: boolean; signal?: AbortSignal }): Promise<string> }

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function createStt(cfg: ProviderConfig['stt']): SpeechToText {
  const budget = new Budget('speech recognition', cfg.maxRequests)
  if (cfg.provider === 'none') {
    return { budget, async transcribe() { throw new Error('Speech recognition is disabled (VTC_STT_PROVIDER=none)') } }
  }
  return {
    budget,
    async transcribe(pcm, signal) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(encodeWav(pcm))], { type: 'audio/wav' }), 'utterance.wav')
      form.append('model', cfg.model)
      form.append('language', 'en')
      form.append('response_format', 'json')
      const res = await providerFetch(budget, `${trimSlash(cfg.baseUrl)}/audio/transcriptions`,
        { method: 'POST', body: form, headers: { Authorization: `Bearer ${cfg.apiKey}` } }, { timeoutMs: cfg.timeoutMs, signal })
      const body = await res.json() as { text?: string }
      return (body.text ?? '').trim()
    },
  }
}

export function createTts(cfg: ProviderConfig['tts']): TextToSpeech {
  const budget = new Budget('speech synthesis', cfg.maxRequests)
  if (cfg.provider === 'macos-say') {
    const voice = cfg.voice === 'am_michael' ? 'Daniel' : cfg.voice
    return {
      budget, description: `macOS say (voice ${voice})`,
      async synthesize(text) {
        budget.take()
        const dir = mkdtempSync(join(tmpdir(), 'vtc-say-'))
        try {
          const file = join(dir, 'speech.wav')
          await run('say', ['-v', voice, '-r', String(Math.round(180 * cfg.speed)), '--file-format=WAVE', '--data-format=LEI16@24000', '-o', file, text], { timeout: cfg.timeoutMs })
          return readFileSync(file)
        } finally { rmSync(dir, { recursive: true, force: true }) }
      },
    }
  }
  return {
    budget, description: `${cfg.model} via ${cfg.baseUrl} (voice ${cfg.voice})`,
    async synthesize(text, signal) {
      const res = await providerFetch(budget, `${trimSlash(cfg.baseUrl)}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, input: text, voice: cfg.voice, response_format: 'wav', speed: cfg.speed }),
      }, { timeoutMs: cfg.timeoutMs, signal })
      return Buffer.from(await res.arrayBuffer())
    },
  }
}

export function stripReasoning(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim()
}

export function createChat(cfg: ProviderConfig['llm']): ChatModel {
  const budget = new Budget('response generation', cfg.maxRequests)
  return {
    budget, description: `${cfg.model} via ${cfg.baseUrl}`,
    async complete(messages, opts = {}) {
      const res = await providerFetch(budget, `${trimSlash(cfg.baseUrl)}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, temperature: cfg.temperature, max_tokens: 700,
          ...(cfg.reasoningEffort ? { reasoning_effort: cfg.reasoningEffort } : {}),
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}) }),
      }, { timeoutMs: cfg.timeoutMs, signal: opts.signal })
      const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      return stripReasoning(body.choices?.[0]?.message?.content ?? '')
    },
  }
}

/** Checks reachability only (no paid generation): lists models where the API supports it. */
export async function probe(baseUrl: string, apiKey: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${trimSlash(baseUrl)}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }
    const body = await res.json().catch(() => ({})) as { data?: Array<{ id: string }> }
    return { ok: true, detail: `${body.data?.length ?? 0} models` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

export type { Pcm }
