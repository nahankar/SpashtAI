import type { BrowserContext, Page } from 'playwright'
import type { AudioBridge } from '../browser/bridge.js'
import type { RunConfig } from '../config.js'
import type { ConversationEngine, StopReason } from '../engine/conversation.js'
import type { Evidence } from '../report/evidence.js'

/** Required checks decide pass/fail; advisory checks are reported but never change the overall result. */
export interface Check {
  name: string
  status: 'passed' | 'failed' | 'pending' | 'skipped'
  required: boolean
  /** Where the evidence came from: what the browser displayed, the audio, or a read-only API call. */
  basis: 'browser' | 'audio' | 'api' | 'tool'
  detail: string
}

/** A missing prerequisite (auth, service, access, data) — the run cannot meaningfully proceed. */
export class BlockedError extends Error {}

export interface AdapterContext {
  page: Page
  context: BrowserContext
  evidence: Evidence
  bridge: AudioBridge
  cfg: RunConfig
  api: AppApi
  screenshot(name: string): Promise<void>
}

export interface ExperienceAdapter {
  readonly name: string
  /** Navigate, configure, start and activate audio through the UI. */
  prepare(ctx: AdapterContext): Promise<void>
  /** Polled during the conversation: has the application itself signalled the end of the session? */
  completion(ctx: AdapterContext): Promise<{ complete: boolean; reason?: string } | null>
  /** End the session through its normal UI lifecycle. */
  finish(ctx: AdapterContext, stop: StopReason, engine: ConversationEngine): Promise<{ ended: boolean; detail: string }>
  verify(ctx: AdapterContext, engine: ConversationEngine): Promise<Check[]>
  identifiers(): Record<string, string | null>
  /** Gives adapters whose completion is heard (not shown) access to the candidate's conversation state. */
  attach?(engine: ConversationEngine): void
}

/**
 * Read-only access to the application's API using the browser's own session. The origin is learned from the
 * requests the app itself makes; the token never leaves this object or appears in evidence.
 */
export class AppApi {
  origin: string | null = null

  constructor(private readonly page: Page, private readonly context: BrowserContext) {
    page.on('request', req => {
      if (this.origin) return
      const url = new URL(req.url())
      if (url.pathname.startsWith('/api/')) this.origin = url.origin
    })
  }

  private async token(): Promise<string | null> {
    return await this.page.evaluate(() => localStorage.getItem('spashtai_token')).catch(() => null)
  }

  async get<T = unknown>(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T | null }> {
    if (!this.origin) throw new Error('API origin not observed yet')
    const token = await this.token()
    const res = await this.context.request.get(`${this.origin}${path}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, timeout: 20_000, failOnStatusCode: false,
    })
    let body: T | null = null
    const type = res.headers()['content-type'] ?? ''
    if (type.includes('json')) body = await res.json().catch(() => null) as T | null
    else await res.body().catch(() => undefined)
    return { status: res.status(), body }
  }
}

export async function pollUntil<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs: number, intervalMs = 3000): Promise<T | null> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const value = await fn().catch(() => null)
    if (value) return value
    if (Date.now() >= end) return null
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

/** Fraction of the candidate's content words that the application's transcript contains (advisory only). */
export function wordRecall(spoken: string, captured: string): number {
  const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
  const said = words(spoken)
  if (!said.length) return 0
  const heard = new Set(words(captured))
  return said.filter(w => heard.has(w)).length / said.length
}
