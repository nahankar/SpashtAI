import { vi } from 'vitest'
import { createLiveSessionApi } from './api'
import { LiveSessionController } from './controller'
import type { LaunchConfig, LiveSessionEffects, RecorderPort } from './types'
export function fixture() {
  const calls: Array<{ path: string; method: string; body: Record<string, unknown>; signal?: AbortSignal | null }> = []
  let id = 0; let random = 0.1
  const effects: LiveSessionEffects = {
    sessionChanged: vi.fn(), clearMessages: vi.fn(), resetMetrics: vi.fn(), hideHistory: vi.fn(), toast: vi.fn(), log: vi.fn(),
    messages: vi.fn(() => []), addMessage: vi.fn(async () => {}), upsertStreamingMessage: vi.fn(),
    rewardPoints: vi.fn(), left: vi.fn(), discarded: vi.fn(), discardFinished: vi.fn(),
  }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ path: String(input).replace('http://api', ''), method: init?.method || 'GET', body: init?.body ? JSON.parse(String(init.body)) : {}, signal: init?.signal })
    return new Response(JSON.stringify({ token: `token-${id}`, url: 'wss://room' }))
  })
  const api = createLiveSessionApi({ baseUrl: 'http://api', fetch: fetcher as typeof fetch, headers: () => ({ Authorization: 'Bearer user' }),
    now: () => new Date('2026-10-07T00:00:00Z'), randomId: () => `segment-${++id}` })
  const controller = new LiveSessionController({ api, now: () => new Date('2026-10-07T00:00:00Z'), random: () => { random += 0.1; return random }, effects })
  const config: LaunchConfig = { sessionName: '', focusArea: '', focusContext: '', boothDemo: false, identity: 'ignored', userName: 'Learner' }
  return { controller, api, config, calls, effects, fetcher }
}

export function recorder(status: 'uploaded' | 'pending' | 'failed' | 'unavailable' = 'uploaded'): RecorderPort {
  return { seal: vi.fn(async () => {}), finalize: vi.fn(async () => ({ ok: status === 'uploaded', audioCapture: status })),
    waitForFinalization: vi.fn(async () => ({ ok: true, audioCapture: 'uploaded' as const })),
    retryUpload: vi.fn(async () => ({ ok: true, audioCapture: 'uploaded' as const })), discard: vi.fn(async () => {}) }
}
