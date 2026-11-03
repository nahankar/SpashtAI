import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type Experience = 'interview' | 'elevate'
export type TargetKind = 'local' | 'production' | 'remote'

export interface ProviderConfig {
  stt: { provider: 'openai-compatible' | 'none'; baseUrl: string; model: string; apiKey: string; timeoutMs: number; maxRequests: number }
  llm: { provider: 'openai-compatible' | 'scripted'; baseUrl: string; model: string; apiKey: string; timeoutMs: number; maxRequests: number; temperature: number; reasoningEffort: string }
  tts: { provider: 'openai-compatible' | 'macos-say'; baseUrl: string; model: string; voice: string; apiKey: string; timeoutMs: number; maxRequests: number; speed: number }
}

export interface RunConfig {
  targetUrl: string
  targetKind: TargetKind
  experience: Experience
  scenario: string
  profile: string
  authFile: string
  headed: boolean
  muteSpeakers: boolean
  browserChannel?: string
  maxDurationMs: number
  maxTurns: number
  outputDir: string
  trace: boolean
  /** Screencast frames and DOM snapshots in the trace (large: the live audio meter redraws constantly). */
  traceFull: boolean
  video: boolean
  seed: number
  /** Interview practice time chosen in the setup UI (minutes). */
  interviewMinutes: number
  elevateFocus: string
  closeUnfinished: boolean
  verifyTimeoutMs: number
  providers: ProviderConfig
}

export const DEFAULT_TARGET = 'http://localhost:5173'
const DEFAULT_PRODUCTION_HOSTS = ['spasht.ai', 'www.spasht.ai', 'app.spasht.ai', 'api.spasht.ai']

/** Reads KEY=VALUE lines from the ignored local env file without overriding real environment variables. */
export function loadLocalEnv(file = resolve(process.cwd(), '.env.local')): void {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || line.trimStart().startsWith('#')) continue
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[m[1]] === undefined) process.env[m[1]] = value
  }
}

export function classifyTarget(url: string, env: NodeJS.ProcessEnv = process.env): TargetKind {
  const host = new URL(url).hostname.toLowerCase()
  const list = (value: string | undefined) => (value ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)
  const production = [...DEFAULT_PRODUCTION_HOSTS, ...list(env.VTC_PRODUCTION_HOSTS)]
  // Any spasht.ai subdomain is treated as production unless explicitly declared non-production (e.g. staging).
  const declaredNonProduction = list(env.VTC_NONPRODUCTION_HOSTS).includes(host)
  if (!declaredNonProduction && production.some(p => host === p || host.endsWith(`.${p}`))) return 'production'
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.local')) return 'local'
  return 'remote'
}

/** Production sessions are real customer-facing usage; they need an explicit, per-invocation opt-in. */
export function assertTargetAllowed(kind: TargetKind, allowProduction: boolean): void {
  if (kind === 'production' && !allowProduction) {
    throw new Error('Target looks like production. Re-run with --allow-production only if you intend to start a real production session.')
  }
}

export function providerConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Record<string, string>> = {}): ProviderConfig {
  const get = (key: string, fallback: string) => overrides[key] ?? env[key] ?? fallback
  const num = (key: string, fallback: number) => Number(get(key, String(fallback)))
  return {
    stt: {
      provider: get('VTC_STT_PROVIDER', 'openai-compatible') as ProviderConfig['stt']['provider'],
      baseUrl: get('VTC_STT_BASE_URL', 'http://localhost:8001/v1'),
      model: get('VTC_STT_MODEL', 'Systran/faster-distil-whisper-small.en'),
      apiKey: get('VTC_STT_API_KEY', 'local'),
      timeoutMs: num('VTC_STT_TIMEOUT_MS', 30_000),
      maxRequests: num('VTC_STT_MAX_REQUESTS', 400),
    },
    llm: {
      provider: get('VTC_LLM_PROVIDER', 'openai-compatible') as ProviderConfig['llm']['provider'],
      baseUrl: get('VTC_LLM_BASE_URL', 'http://localhost:11434/v1'),
      model: get('VTC_LLM_MODEL', 'gemma4:12b'),
      apiKey: get('VTC_LLM_API_KEY', 'local'),
      timeoutMs: num('VTC_LLM_TIMEOUT_MS', 60_000),
      maxRequests: num('VTC_LLM_MAX_REQUESTS', 60),
      temperature: num('VTC_LLM_TEMPERATURE', 0.6),
      // Spoken replies need no hidden reasoning; 'none' disables it on Ollama. Set empty to omit the field.
      reasoningEffort: get('VTC_LLM_REASONING_EFFORT', 'none'),
    },
    tts: {
      provider: get('VTC_TTS_PROVIDER', 'openai-compatible') as ProviderConfig['tts']['provider'],
      baseUrl: get('VTC_TTS_BASE_URL', 'http://localhost:8002/v1'),
      model: get('VTC_TTS_MODEL', 'kokoro'),
      voice: get('VTC_TTS_VOICE', 'am_michael'),
      apiKey: get('VTC_TTS_API_KEY', 'local'),
      timeoutMs: num('VTC_TTS_TIMEOUT_MS', 60_000),
      maxRequests: num('VTC_TTS_MAX_REQUESTS', 200),
      speed: num('VTC_TTS_SPEED', 1),
    },
  }
}

/** Secrets that must never appear in evidence even if a page or provider echoes them. */
export function knownSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['VTC_PASSWORD', 'VTC_STT_API_KEY', 'VTC_LLM_API_KEY', 'VTC_TTS_API_KEY']
    .map(k => env[k] ?? '').filter(v => v && v !== 'local')
}
