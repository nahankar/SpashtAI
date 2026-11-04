#!/usr/bin/env node
/** Bounded orchestration only: the existing CLI remains the real audio candidate. */
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { assertTargetAllowed, boundedNumber, classifyTarget, knownSecrets, loadLocalEnv, providerConfig } from './config.js'
import { getScenario, SCENARIOS } from './candidate/scenarios.js'
import { navigateProduct } from './browser/navigation.js'
import { accessItems, httpOk, inspectStack, providerItems, readLog, registrationItem, stackSummary, targetingItems, type PreflightItem } from './preflight.js'
import { redact, safeUrl } from './redact.js'

export const WORKFLOW_HELP = `SpashtAI voice workflow (developer tool)

  npm run voice:preflight -- [options]   check prerequisites only (never a passed voice test)
  npm run voice:test -- [options]        preflight, then run each selected scenario serially
  npm run voice:help                     this help

Options
  --target <url>          app (default VTC_TARGET_URL or http://localhost:5173)
  --api-url <url>         this stack's API (default VTC_API_URL or http://localhost:4000)
  --livekit-url <url>     this stack's LiveKit (default VTC_LIVEKIT_URL or ws://localhost:7880)
  --workspace <slug>      organization workspace; omit for Personal (never falls back silently)
  --auth-file <path>      signed-in browser state (default .auth/<host>_<port>.json)
  --manual-auth-file <p>  account WITHOUT automatic Interview conversation, for manual-interview
                          (default VTC_MANUAL_AUTH_FILE or .auth/manual-<host>_<port>.json)
  --experience both|interview|elevate   default scenario set (both)
  --scenario <id>         run only these scenarios (repeatable); see 'npm run vtc -- scenarios'
  --max-minutes <n>       conversation bound per scenario (0.1–20, default 8; manual-interview 12)
  --verify-timeout <s>    result wait per scenario (1–600, default 120)
  --run-timeout <min>     whole-scenario bound passed to the run (1–120, default derived)
  --api-log/--agent-log   the running processes' log files (sanitized tails are saved)
  --app-source <dir>      declared app checkout when processes cannot be inspected
  --browser-channel <c>   e.g. chrome
  --allow-production      only with explicit owner authorization for this run

Evidence levels reported by preflight
  reachable            an endpoint answered HTTP
  configured           a process/provider/account is set up for this target (env, model list, access, coverage)
  observed-registered  the agent's log shows registration with this LiveKit since its latest start
  verified-by-live-audio  only a run proves dispatch and audio (see each run's live-audio checks)

Cannot be verified automatically (document in your report):
  physical microphones/speakers/acoustics; that the running code equals a commit when the checkout is dirty;
  agents/APIs inside containers (revision unknown); provider generation quality; production readiness.

Exit codes: 0 all scenarios passed (or preflight ready), 1 failed, 2 blocked, 3 inconclusive.
`

const DEFAULT_SETS: Record<string, string[]> = {
  both: ['confident-interview', 'manual-interview', 'elevate-learner'],
  interview: ['confident-interview', 'manual-interview'],
  elevate: ['elevate-learner'],
}

function options(argv: string[]) {
  return parseArgs({ args: argv, allowPositionals: true, strict: true, options: {
    target: { type: 'string' }, 'api-url': { type: 'string' }, 'livekit-url': { type: 'string' }, workspace: { type: 'string' },
    'auth-file': { type: 'string' }, 'manual-auth-file': { type: 'string' }, output: { type: 'string' }, experience: { type: 'string' },
    scenario: { type: 'string', multiple: true }, 'max-minutes': { type: 'string' }, 'verify-timeout': { type: 'string' }, 'run-timeout': { type: 'string' },
    'agent-log': { type: 'string' }, 'api-log': { type: 'string' }, 'app-source': { type: 'string' }, 'browser-channel': { type: 'string' },
    'allow-production': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } })
}

export interface WorkflowSettings {
  command: string; target: string; api: string; livekit: string; workspace?: string; auth: string; manualAuth: string
  output: string; scenarios: string[]; maxMinutes?: number; verifyTimeout: number; runTimeout?: number
  allowProduction: boolean; logs: { api?: string; agent?: string }; appSource?: string; channel?: string
}

/** Validates everything before any network access. Throws with an actionable message. */
export function settings(argv: string[], env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): WorkflowSettings {
  const { values, positionals } = options(argv)
  const command = values.help ? 'help' : positionals[0] ?? 'preflight'
  if (!['preflight', 'test', 'help'].includes(command)) throw new Error(`Unknown command "${command}". Use preflight, test or help.`)
  const target = values.target ?? env.VTC_TARGET_URL ?? 'http://localhost:5173'
  const api = values['api-url'] ?? env.VTC_API_URL ?? 'http://localhost:4000'
  const livekit = values['livekit-url'] ?? env.VTC_LIVEKIT_URL ?? 'ws://localhost:7880'
  const allowProduction = Boolean(values['allow-production'])
  for (const endpoint of [target, api, livekit]) {
    const u = new URL(endpoint)
    // Credential-bearing URLs must never be accepted or persisted in evidence.
    if (u.username || u.password || u.search || u.hash) throw new Error('Use endpoint URLs without credentials, queries or fragments')
    assertTargetAllowed(classifyTarget(endpoint), allowProduction)
    if (classifyTarget(endpoint) !== 'local' && !allowProduction) throw new Error('Workflow defaults to local services; remote use needs explicit authorization and --allow-production')
  }
  const output = resolve(cwd, values.output ?? 'runs')
  const runs = resolve(cwd, 'runs')
  if (output !== runs && !output.startsWith(runs + '/')) throw new Error('Workflow evidence must stay under the ignored tool runs directory')
  const experience = values.experience ?? 'both'
  if (!DEFAULT_SETS[experience]) throw new Error('experience must be both, interview or elevate')
  const scenarios = values.scenario?.length ? values.scenario : DEFAULT_SETS[experience]
  for (const s of scenarios) if (!SCENARIOS[s]) throw new Error(`Unknown scenario "${s}". Available: ${Object.keys(SCENARIOS).join(', ')}`)
  const host = new URL(target)
  const hostKey = `${host.hostname}_${host.port || (host.protocol === 'https:' ? '443' : '80')}`
  return {
    command, target, api, livekit, workspace: values.workspace ?? env.VTC_WORKSPACE,
    auth: resolve(cwd, values['auth-file'] ?? env.VTC_AUTH_FILE ?? `.auth/${hostKey}.json`),
    manualAuth: resolve(cwd, values['manual-auth-file'] ?? env.VTC_MANUAL_AUTH_FILE ?? `.auth/manual-${hostKey}.json`),
    output, scenarios,
    maxMinutes: values['max-minutes'] !== undefined ? boundedNumber(values['max-minutes'], 'max-minutes', 0.1, 20) : undefined,
    verifyTimeout: boundedNumber(values['verify-timeout'] ?? 120, 'verify-timeout', 1, 600),
    runTimeout: values['run-timeout'] !== undefined ? boundedNumber(values['run-timeout'], 'run-timeout', 1, 120) : undefined,
    allowProduction, logs: { api: values['api-log'] ?? env.VTC_API_LOG, agent: values['agent-log'] ?? env.VTC_AGENT_LOG },
    appSource: values['app-source'] ?? env.VTC_APP_SOURCE, channel: values['browser-channel'],
  }
}

export function authFor(s: WorkflowSettings, scenario: string): string {
  return getScenario(scenario).interviewMode === 'manual' ? s.manualAuth : s.auth
}

async function preflight(s: WorkflowSettings, record: (item: PreflightItem) => void): Promise<boolean> {
  const local = classifyTarget(s.target) === 'local'
  const app = await httpOk(s.target)
  record({ name: 'app', ok: app.ok, level: 'reachable', detail: `${safeUrl(s.target)} → ${app.status ?? app.error}`, remedy: app.ok ? undefined : 'start/reuse this stack\'s web process on its own port' })
  const ready = await httpOk(new URL('/ready', s.api).toString())
  const health = ready.ok ? ready : await httpOk(new URL('/health', s.api).toString())
  record({ name: 'API', ok: health.ok, level: 'reachable', detail: `${safeUrl(s.api)} /ready or /health → ${health.status ?? health.error}`, remedy: health.ok ? undefined : 'start this stack\'s API with a dedicated local database' })
  const lk = await httpOk(s.livekit.replace(/^ws/, 'http'))
  record({ name: 'LiveKit', ok: lk.ok, level: 'reachable', detail: `${safeUrl(s.livekit)} → ${lk.status ?? lk.error}; reachability is not agent registration or dispatch` })
  for (const item of await providerItems(providerConfig())) record(item)

  const stack = local ? inspectStack({ targetUrl: s.target, apiUrl: s.api, livekitUrl: s.livekit, declaredSource: s.appSource }) : []
  if (local) {
    for (const item of targetingItems(stack, { api: s.api, livekit: s.livekit })) record(item)
    for (const item of stackSummary(stack)) record(item)
  }
  const agentLog = readLog(s.logs.agent)
  const agents = stack.filter(c => c.component === 'agent' && c.pid)
  if (agentLog && agents.length > 1) record({ name: 'agent registration (log)', ok: false, level: 'configured', detail: `${agents.length} workers target ${s.livekit}; which one the log belongs to (and which one gets dispatched) is ambiguous`, remedy: 'give this stack its own LiveKit; never stop another session\'s worker' })
  else if (agentLog) record(registrationItem(agentLog.text, agentLog.modifiedMs, agents[0], s.livekit))
  else record({ name: 'agent registration (log)', ok: false, advisory: true, level: 'configured', detail: 'no --agent-log given: registration not observed (process targeting above still applies)', remedy: 'pass --agent-log <file the running agent writes>' })
  for (const kind of ['api', 'agent'] as const) {
    const path = s.logs[kind]
    const ok = Boolean(path && existsSync(path) && statSync(path).isFile())
    record({ name: `${kind} log`, ok, advisory: kind === 'api', level: 'configured', detail: ok ? 'readable local log; a sanitized run-window tail will be saved' : `--${kind}-log not given or unreadable`, remedy: ok ? undefined : `set --${kind}-log to the actual local process log (never production logs)` })
  }

  const byAuth = new Map<string, string[]>()
  for (const scenario of s.scenarios) byAuth.set(authFor(s, scenario), [...(byAuth.get(authFor(s, scenario)) ?? []), scenario])
  for (const [auth, scenarios] of byAuth) {
    const label = auth === s.manualAuth ? 'manual Interview account' : 'account'
    if (!existsSync(auth)) { record({ name: `${label} browser state`, ok: false, level: 'access', detail: `missing ${auth}`, remedy: 'run the login command for this account (README: test accounts)' }); continue }
    await browserChecks(s, auth, scenarios, label, record)
  }
  return true
}

/** Browser-level checks with the real app: API binding, workspace emission, auth, access, coverage, mode. */
async function browserChecks(s: WorkflowSettings, auth: string, scenarios: string[], label: string, record: (item: PreflightItem) => void) {
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: s.channel })
    const context = await browser.newContext({ storageState: auth })
    const page = await context.newPage()
    const unexpected = new Set<string>()
    // Prevent a locally served frontend from sending credentials to another (e.g. production) API.
    await context.route('**/*', async route => {
      const u = new URL(route.request().url())
      if ((u.pathname.startsWith('/api/') || u.pathname.startsWith('/sessions')) && u.origin !== new URL(s.api).origin) { unexpected.add(u.origin); return route.abort() }
      return route.continue()
    })
    let scope = ''
    page.on('request', req => { if (new URL(req.url()).origin === new URL(s.api).origin && req.headers()['x-spasht-workspace']) scope = req.headers()['x-spasht-workspace']! })
    await navigateProduct(page, { targetUrl: s.target, workspace: s.workspace }, '/elevate')
    await page.waitForTimeout(1500)
    if (/\/auth\//.test(new URL(page.url()).pathname)) record({ name: `${label}: signed in`, ok: false, level: 'access', detail: 'the app redirected to sign-in', remedy: 're-run login for this target/account' })
    if (s.workspace) {
      const inside = new URL(page.url()).pathname.startsWith(`/w/${s.workspace}/`)
      record({ name: `${label}: workspace ${s.workspace}`, ok: inside && Boolean(scope), level: 'access',
        detail: inside ? (scope ? 'page stayed in the workspace and the app sent its workspace scope' : 'page is in the workspace but the app sent no workspace scope (no Personal fallback is allowed)') : `page left the workspace (${new URL(page.url()).pathname})`,
        remedy: inside && scope ? undefined : 'check membership and workspace access; re-login if the scope expired' })
    } else record({ name: `${label}: workspace`, ok: !new URL(page.url()).pathname.startsWith('/w/'), level: 'access', detail: 'Personal (explicit default)' })
    record({ name: `${label}: frontend API binding`, ok: unexpected.size === 0, level: 'safety',
      detail: unexpected.size ? `frontend called ${[...unexpected].join(', ')} instead of ${new URL(s.api).origin}; requests were refused` : `all app API requests went to ${new URL(s.api).origin}`,
      remedy: unexpected.size ? 'restart the web process with VITE_API_BASE_URL for this stack; do not run' : undefined })
    if (unexpected.size === 0 && (!s.workspace || scope)) {
      for (const item of await accessItems(page, context, s.api, scenarios, s.workspace ? { 'x-spasht-workspace': scope } : {})) record({ ...item, name: `${label}: ${item.name}` })
    }
    await context.close()
  } catch (error) {
    record({ name: `${label}: browser`, ok: false, level: 'access', detail: `could not validate in the browser: ${error instanceof Error ? error.message.split('\n')[0] : 'browser failed'}`, remedy: 'check Chromium install, login, membership and access' })
  } finally { await browser?.close() }
}

function saveLogs(s: WorkflowSettings, dir: string, starts: Record<string, number>, secrets: string[]) {
  for (const kind of Object.keys(starts) as Array<'api' | 'agent'>) {
    const path = s.logs[kind]!
    // Bounded tail only. Logs can contain secrets even before this tool's run.
    const size = statSync(path).size
    const from = Math.max(size - 256_000, Math.min(starts[kind]!, size))
    const bytes = Buffer.alloc(size - from)
    const fd = openSync(path, 'r')
    try { readSync(fd, bytes, 0, bytes.length, from) } finally { closeSync(fd) }
    writeFileSync(resolve(dir, `${kind}-run.log`), redact(bytes.toString(), secrets), { mode: 0o600 })
  }
}

function child(s: WorkflowSettings, scenario: string, dir: string): Promise<number> {
  const maxMinutes = s.maxMinutes ?? (getScenario(scenario).interviewMode === 'manual' ? 12 : 8)
  const args = ['--import', 'tsx', 'src/cli.ts', 'run', '--target', s.target, '--auth-file', authFor(s, scenario),
    '--api-url', s.api, '--livekit-url', s.livekit, '--scenario', scenario, '--output', dir, '--max-minutes', String(maxMinutes),
    '--verify-timeout', String(s.verifyTimeout), '--close-unfinished']
  if (s.runTimeout) args.push('--run-timeout', String(s.runTimeout))
  if (s.workspace) args.push('--workspace', s.workspace)
  if (s.appSource) args.push('--app-source', s.appSource)
  if (s.allowProduction) args.push('--allow-production')
  if (s.channel) args.push('--browser-channel', s.channel)
  return new Promise<number>(resolveCode => {
    const proc = spawn(process.execPath, args, { stdio: 'inherit' })
    // Outer guard in case the run's own watchdog cannot act (e.g. the process hangs outside the event loop).
    const bound = ((s.runTimeout ?? maxMinutes + 2 * s.verifyTimeout / 60 + 6) + 2) * 60_000
    const timer = setTimeout(() => proc.kill('SIGTERM'), bound)
    const killer = setTimeout(() => proc.kill('SIGKILL'), bound + 60_000)
    proc.on('error', () => { clearTimeout(timer); clearTimeout(killer); resolveCode(2) })
    proc.on('exit', code => { clearTimeout(timer); clearTimeout(killer); resolveCode(code ?? 3) })
  })
}

export function workflowOutcome(ready: boolean, command: string, results: Array<{ exit: number }>): 'blocked' | 'preflight-ready' | 'passed' | 'not-passed' {
  if (!ready) return 'blocked'
  if (command === 'preflight') return 'preflight-ready'
  return results.length && results.every(r => r.exit === 0) ? 'passed' : 'not-passed'
}

async function main() {
  loadLocalEnv()
  const s = settings(process.argv.slice(2))
  if (s.command === 'help') { process.stdout.write(WORKFLOW_HELP); return }
  const secrets = knownSecrets()
  const dir = resolve(s.output, `workflow-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const items: PreflightItem[] = []
  const record = (item: PreflightItem) => {
    const clean = { ...item, detail: redact(item.detail, secrets) }
    items.push(clean)
    const tag = clean.ok ? 'OK     ' : clean.advisory ? 'NOTE   ' : 'BLOCKED'
    process.stdout.write(`${tag} [${clean.level}] ${clean.name}: ${clean.detail}${!clean.ok && clean.remedy ? `\n          → ${clean.remedy}` : ''}\n`)
  }
  const starts: Record<string, number> = {}
  for (const kind of ['api', 'agent'] as const) { const p = s.logs[kind]; if (p && existsSync(p)) starts[kind] = statSync(p).size }
  const results: Array<{ scenario: string; exit: number }> = []
  let ready = false
  try {
    await preflight(s, record)
    ready = items.every(i => i.ok || i.advisory)
    process.stdout.write(`\nPreflight ${ready ? 'READY' : 'BLOCKED'} — prerequisites only; a voice test has not run.\n`)
    if (ready && s.command === 'test') for (const scenario of s.scenarios) results.push({ scenario, exit: await child(s, scenario, dir) })
  } finally {
    saveLogs(s, dir, starts, secrets)
    const outcome = workflowOutcome(ready, s.command, results)
    writeFileSync(resolve(dir, 'workflow.json'), JSON.stringify({ command: s.command, target: safeUrl(s.target), api: safeUrl(s.api), livekit: safeUrl(s.livekit),
      workspace: s.workspace ?? 'Personal', scenarios: s.scenarios, preflight: items, results, outcome }, null, 2), { mode: 0o600 })
    process.stdout.write(`Workflow outcome: ${outcome}\nEvidence: ${dir}\n`)
  }
  process.exitCode = !ready ? 2 : results.find(r => r.exit !== 0)?.exit ?? 0
}

if (process.argv[1] && /workflow\.(ts|js)$/.test(process.argv[1])) {
  main().catch(error => { console.error(`Workflow blocked: ${redact(error instanceof Error ? error.message : 'check local configuration', knownSecrets())}. No production authorization is implied.`); process.exitCode = 2 })
}
