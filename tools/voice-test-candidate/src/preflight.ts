import { existsSync, readFileSync, statSync } from 'node:fs'
import type { BrowserContext, Page } from 'playwright'
import { getScenario } from './candidate/scenarios.js'
import type { ProviderConfig } from './config.js'
import { inspectStack, sameUrl, type ComponentProvenance } from './provenance.js'

/**
 * Evidence levels, from weakest to strongest. Preflight never reports the last one: only a live run proves that
 * the agent was dispatched and spoke.
 *  reachable           — an HTTP endpoint answered
 *  configured          — a component is set up to use the right target/model/account (process env, model list, API)
 *  observed-registered — the agent's own log shows it registered with this LiveKit since its latest start
 *  verified-by-live-audio — a run received the agent's speech and the app heard the candidate (run report only)
 */
export type EvidenceLevel = 'reachable' | 'configured' | 'observed-registered' | 'verified-by-live-audio' | 'safety' | 'access'

export interface PreflightItem {
  name: string
  ok: boolean
  /** Not a blocker: recorded but does not stop the workflow (e.g. revision not verifiable). */
  advisory?: boolean
  level: EvidenceLevel
  detail: string
  remedy?: string
}

export async function httpOk(url: string, timeoutMs = 5000): Promise<{ ok: boolean; status: number | null; error?: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    await res.arrayBuffer().catch(() => undefined)
    return { ok: res.ok, status: res.status }
  } catch (error) {
    return { ok: false, status: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The configured model must be listed by the provider (where the API lists models). Generation is not tested. */
export async function providerModel(name: string, cfg: { baseUrl: string; apiKey: string; model: string }): Promise<PreflightItem> {
  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(5000) })
    if (!res.ok) return { name: `candidate ${name}`, ok: false, level: 'reachable', detail: `${cfg.baseUrl}/models answered HTTP ${res.status}`, remedy: 'start the provider or fix VTC_*_BASE_URL' }
    const body = await res.json().catch(() => ({})) as { data?: Array<{ id: string }> }
    const ids = (body.data ?? []).map(m => m.id)
    const listed = ids.includes(cfg.model)
    return { name: `candidate ${name}`, ok: listed, level: listed ? 'configured' : 'reachable',
      detail: listed ? `${cfg.baseUrl}: model ${cfg.model} is listed (reachability + configuration; generation not tested)`
        : `${cfg.baseUrl} reachable but model ${cfg.model} is not listed (available: ${ids.slice(0, 8).join(', ') || 'none'})`,
      remedy: listed ? undefined : `pull/load ${cfg.model} or set the VTC_*_MODEL to a listed model` }
  } catch (error) {
    return { name: `candidate ${name}`, ok: false, level: 'reachable', detail: `${cfg.baseUrl} unreachable: ${error instanceof Error ? error.message : error}`, remedy: 'start the provider (see README prerequisites)' }
  }
}

export function providerItems(providers: ProviderConfig): Promise<PreflightItem[]> {
  return Promise.all((['stt', 'llm', 'tts'] as const).map(async key => {
    const cfg = providers[key]
    const label = { stt: 'speech recognition', llm: 'response generation', tts: 'speech synthesis' }[key]
    if (cfg.provider === 'openai-compatible') return providerModel(label, cfg)
    const ok = key === 'llm' ? cfg.provider === 'scripted' : key === 'tts' ? cfg.provider === 'macos-say' && process.platform === 'darwin' : false
    return { name: `candidate ${label}`, ok, level: 'configured' as const, detail: `${cfg.provider}${key === 'stt' ? ' — independent listening must stay enabled' : ''}` }
  }))
}

/**
 * Targeting from the running processes: web → API, API → LiveKit, agent → LiveKit and API callback.
 * "configured" means the process environment (or its env file) points there; it does not prove traffic flows.
 */
export function targetingItems(stack: ComponentProvenance[], urls: { api: string; livekit: string }): PreflightItem[] {
  const items: PreflightItem[] = []
  const web = stack.find(c => c.component === 'web')
  const api = stack.find(c => c.component === 'api')
  const agents = stack.filter(c => c.component === 'agent' && c.pid)
  const check = (name: string, value: string | undefined, want: string, source: string | undefined, remedy: string) => items.push({
    name, level: 'configured', ok: sameUrl(value, want),
    detail: value ? `${value} (${source})${sameUrl(value, want) ? '' : ` ≠ expected ${want}`}` : `not visible in the process environment or its env file (expected ${want})`, remedy: sameUrl(value, want) ? undefined : remedy,
    advisory: !value,
  })
  if (web?.pid) check('web → API binding', web.targets?.VITE_API_BASE_URL?.value, urls.api, web.targets?.VITE_API_BASE_URL?.source, 'restart the web dev server with VITE_API_BASE_URL set to this stack\'s API')
  if (api?.pid) check('API → LiveKit', api.targets?.LIVEKIT_URL?.value, urls.livekit, api.targets?.LIVEKIT_URL?.source, 'restart the API with LIVEKIT_URL set to this stack\'s LiveKit')
  if (!agents.length) items.push({ name: 'agent worker process', ok: false, level: 'configured', detail: `no local agent worker targets ${urls.livekit}`, remedy: 'start this checkout\'s agent with LIVEKIT_URL and SERVER_URL for this stack (README: isolated stack)' })
  else {
    items.push({ name: 'agent workers on this LiveKit', ok: agents.length === 1, level: 'configured',
      detail: `${agents.length} worker process(es): ${agents.map(a => `pid ${a.pid} in ${a.sourceDir ?? 'unknown dir'}`).join('; ')}`,
      remedy: agents.length === 1 ? undefined : 'LiveKit dispatches unnamed workers at random: use a dedicated LiveKit per stack' })
    for (const a of agents) check(`agent pid ${a.pid} → API callback`, a.targets?.SERVER_URL?.value, urls.api, a.targets?.SERVER_URL?.source, 'restart the agent with SERVER_URL set to this stack\'s API')
  }
  return items
}

/**
 * Agent registration from its log: the latest worker start must be followed by a registration for this LiveKit,
 * with no later connection failure, and the log must have been written since the process started.
 * This is observation of registration, not of dispatch.
 */
export function registrationItem(logText: string, logModifiedMs: number, agent: ComponentProvenance | undefined, livekit: string): PreflightItem {
  const name = 'agent registration (log)'
  const lines = logText.split(/\r?\n/)
  const start = lines.map((l, i) => (/starting worker/.test(l) ? i : -1)).filter(i => i >= 0).at(-1)
  if (start === undefined) return { name, ok: false, level: 'configured', detail: 'no "starting worker" line in the agent log (is this the running agent\'s log?)', remedy: 'pass --agent-log for the running agent process' }
  const after = lines.slice(start).join('\n')
  const reg = [...after.matchAll(/registered worker[\s\S]{0,400}?"url":\s*"([^"]+)"/g)].at(-1)
  const failed = /failed to connect|worker shutting down|process exiting.*worker/i.test(after.slice(reg ? (reg.index ?? 0) : 0).split('\n').slice(1).join('\n'))
  const startedAt = agent?.processStartedAt ? new Date(agent.processStartedAt).getTime() : null
  const fresh = startedAt === null || logModifiedMs >= startedAt
  if (!reg) return { name, ok: false, level: 'configured', detail: 'no registration since the latest worker start', remedy: 'check agent credentials and LIVEKIT_URL; look for connection errors in the agent log' }
  if (!sameUrl(reg[1], livekit)) return { name, ok: false, level: 'configured', detail: `latest registration is for ${reg[1]}, not ${livekit}`, remedy: 'this log belongs to an agent on another LiveKit' }
  if (failed) return { name, ok: false, level: 'configured', detail: 'a connection failure or shutdown follows the latest registration', remedy: 'restart the agent and inspect its log' }
  if (!fresh) return { name, ok: false, level: 'configured', detail: 'the log has not been written since the agent process started (stale log?)', remedy: 'pass the log the running agent writes to' }
  return { name, ok: true, level: 'observed-registered', detail: `registered with ${reg[1]} after its latest start${agent?.pid ? ` (pid ${agent.pid} alive)` : ''}; dispatch and audio are only proven by a live run` }
}

export function readLog(path: string | undefined): { text: string; modifiedMs: number } | null {
  if (!path || !existsSync(path) || !statSync(path).isFile()) return null
  const size = statSync(path).size
  const text = readFileSync(path).subarray(Math.max(0, size - 2_000_000)).toString('utf8')
  return { text, modifiedMs: statSync(path).mtimeMs }
}

interface InterviewOptions { coverage?: Array<{ track: string; experienceBand: string; difficulty: string; count: number }>; conversationAvailable?: boolean; durations?: { allowed: Array<number | null> } }

/** Questions the Interview setup page offers by default: first Automation Testing (else first) track and band, all difficulties. */
export function defaultCoverage(options: InterviewOptions): { track: string; band: string; count: number } | null {
  const coverage = options.coverage ?? []
  const initial = coverage.find(c => c.track === 'Automation Testing' && c.difficulty === 'Simple') ?? coverage[0]
  if (!initial) return null
  return { track: initial.track, band: initial.experienceBand, count: coverage.filter(c => c.track === initial.track && c.experienceBand === initial.experienceBand).reduce((n, c) => n + c.count, 0) }
}

/** Account- and product-level access, read with the browser's own session and workspace scope. */
export async function accessItems(page: Page, context: BrowserContext, api: string, scenarios: string[], scope: Record<string, string>): Promise<PreflightItem[]> {
  const items: PreflightItem[] = []
  const token = await page.evaluate(() => localStorage.getItem('spashtai_token')).catch(() => null)
  if (!token) return [{ name: 'authenticated account', ok: false, level: 'access', detail: 'no signed-in session in the browser state', remedy: 'npm run vtc -- login --target <app> (or --manual)' }]
  const get = (path: string) => context.request.get(new URL(path, api).toString(), { headers: { Authorization: `Bearer ${token}`, ...scope }, timeout: 10_000, failOnStatusCode: false })
  const me = await get('/api/auth/me')
  items.push({ name: 'authenticated account', ok: me.status() === 200, level: 'access',
    detail: me.status() === 200 ? 'identity accepted by the selected API (token not recorded)' : `HTTP ${me.status()} from /api/auth/me`, remedy: me.status() === 200 ? undefined : 'session expired or belongs to another API: re-run login for this target' })
  if (me.status() !== 200) return items
  const experiences = new Set(scenarios.map(s => getScenario(s).experience))
  if (experiences.has('elevate')) {
    const sessions = await get('/sessions')
    items.push({ name: 'Elevate access', ok: sessions.status() === 200, level: 'access', detail: `GET /sessions → HTTP ${sessions.status()}`, remedy: sessions.status() === 200 ? undefined : 'enable Elevate for this account/workspace' })
  }
  if (experiences.has('interview')) {
    const res = await get('/api/interviews/options')
    const options = (res.status() === 200 ? await res.json().catch(() => ({})) : {}) as InterviewOptions
    items.push({ name: 'Interview access', ok: res.status() === 200, level: 'access', detail: `GET /api/interviews/options → HTTP ${res.status()}`, remedy: res.status() === 200 ? undefined : 'grant interviews + interview_voice and configure the voice profile' })
    if (res.status() === 200) {
      const cover = defaultCoverage(options)
      for (const id of scenarios.filter(s => getScenario(s).experience === 'interview')) {
        const scenario = getScenario(id)
        const need = scenario.manualPlan?.length ?? 2
        items.push({ name: `Interview coverage for ${id}`, ok: (cover?.count ?? 0) >= need, level: 'configured',
          detail: cover ? `default selection ${cover.track} / ${cover.band}: ${cover.count} reviewed question(s); scenario needs ≥ ${need}` : 'no reviewed questions', remedy: (cover?.count ?? 0) >= need ? undefined : 'publish more fictional bank questions for the default selection' })
        if (scenario.interviewMode) {
          const automatic = options.conversationAvailable === true
          items.push({ name: `Interview mode for ${id}`, ok: (scenario.interviewMode === 'automatic') === automatic, level: 'access',
            detail: `account ${automatic ? 'has' : 'does not have'} automatic conversation; scenario needs ${scenario.interviewMode}`,
            remedy: scenario.interviewMode === 'manual' ? 'use the manual Interview account (no interview_conversation access)' : 'grant interview_conversation to this account' })
        }
        if (scenario.practiceMinutes && options.durations && !options.durations.allowed.includes(scenario.practiceMinutes)) {
          items.push({ name: `practice time for ${id}`, ok: false, level: 'access', detail: `${scenario.practiceMinutes} min not offered (allowed ${options.durations.allowed.join(', ')})`, remedy: 'pass --interview-minutes with an allowed value' })
        }
      }
      const runs = await get('/api/interviews/runs')
      const open = runs.status() === 200 ? ((await runs.json().catch(() => ({}))) as { runs?: Array<{ endedAt: string | null }> }).runs?.filter(r => !r.endedAt).length ?? 0 : 0
      items.push({ name: 'no unfinished Interview practice', ok: open === 0, advisory: true, level: 'access', detail: open ? `${open} unfinished practice(s); runs need --close-unfinished` : 'none', remedy: open ? 'the workflow passes --close-unfinished, which ends it through the UI' : undefined })
    }
  }
  return items
}

export function stackSummary(stack: ComponentProvenance[]): PreflightItem[] {
  return stack.map(c => ({ name: `${c.component} revision`, ok: c.status === 'verified', advisory: true, level: 'configured' as const,
    detail: `${c.status}${c.commit ? ` ${c.commit.slice(0, 7)}${c.branch ? ` (${c.branch})` : ''}` : ''}${c.sourceDir ? ` — ${c.sourceDir}` : ''}: ${c.basis}` }))
}

export { inspectStack }
