#!/usr/bin/env node
/** Bounded orchestration only: the existing CLI remains the real audio candidate. */
import { existsSync, mkdirSync, openSync, readSync, closeSync, writeFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import { assertTargetAllowed, boundedNumber, classifyTarget, loadLocalEnv, providerConfig, knownSecrets } from './config.js'
import { navigateProduct } from './browser/navigation.js'
import { probe } from './providers/index.js'
import { redact, safeUrl } from './redact.js'

loadLocalEnv()
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  target: { type: 'string' }, 'api-url': { type: 'string' }, 'livekit-url': { type: 'string' },
  workspace: { type: 'string' }, 'auth-file': { type: 'string' }, output: { type: 'string' },
  experience: { type: 'string' }, scenario: { type: 'string' }, 'max-minutes': { type: 'string' },
  'verify-timeout': { type: 'string' }, 'agent-log': { type: 'string' }, 'api-log': { type: 'string' },
  'browser-channel': { type: 'string' }, 'allow-production': { type: 'boolean' },
} })
const command = positionals[0] ?? 'preflight'
const target = values.target ?? process.env.VTC_TARGET_URL ?? 'http://localhost:5173'
const api = values['api-url'] ?? process.env.VTC_API_URL ?? 'http://localhost:4000'
const livekit = values['livekit-url'] ?? process.env.VTC_LIVEKIT_URL ?? 'ws://localhost:7880'
const workspace = values.workspace ?? process.env.VTC_WORKSPACE
const auth = resolve(values['auth-file'] ?? process.env.VTC_AUTH_FILE ?? `.auth/${new URL(target).hostname}_${new URL(target).port || '443'}.json`)
const output = resolve(values.output ?? 'runs')
const dir = resolve(output, `workflow-${new Date().toISOString().replace(/[:.]/g, '-')}`)
const secrets = knownSecrets()
const checks: Array<{ name: string; ok: boolean; detail: string }> = []
const starts: Record<string, number> = {}
const check = (name: string, ok: boolean, detail: string) => {
  checks.push({ name, ok, detail: redact(detail, secrets) })
  process.stdout.write(`${ok ? 'OK' : 'BLOCKED'} ${name}: ${redact(detail, secrets)}\n`)
}
async function reachable(url: string) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' })).ok } catch { return false }
}
async function preflight() {
  // Credential-bearing URLs must never be accepted or persisted in evidence.
  for (const endpoint of [target, api, livekit]) {
    const u = new URL(endpoint)
    if (u.username || u.password || u.search || u.hash) throw new Error('Use endpoint URLs without credentials, queries or fragments')
    assertTargetAllowed(classifyTarget(endpoint), Boolean(values['allow-production']))
    if (classifyTarget(endpoint) !== 'local' && !values['allow-production']) throw new Error('Workflow defaults to local services; remote use needs explicit authorization and --allow-production')
  }
  if (output !== resolve('runs') && !output.startsWith(resolve('runs') + '/')) throw new Error('Workflow evidence must stay under the ignored tool runs directory')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  check('app', await reachable(target), `${safeUrl(target)}; start/reuse this worktree web process on its own port`)
  check('API readiness', await reachable(new URL('/ready', api).toString()), `${safeUrl(api)}/ready; use a dedicated local test database`)
  check('LiveKit reachability', await reachable(livekit.replace(/^ws/, 'http')), `${safeUrl(livekit)}; reachability is not proof of agent registration or audio`)
  const providers = providerConfig()
  for (const [name, cfg] of Object.entries(providers)) {
    if (cfg.provider !== 'openai-compatible') {
      check(`candidate ${name}`, cfg.provider === 'scripted' || (cfg.provider === 'macos-say' && process.platform === 'darwin'),
        `${cfg.provider}; independent listening must remain enabled`)
    } else {
      const result = await probe(cfg.baseUrl, cfg.apiKey)
      check(`candidate ${name}`, result.ok, `${safeUrl(cfg.baseUrl)}: ${result.detail}; model=${cfg.model} (generation not tested)`)
    }
  }
  check('browser auth state', existsSync(auth), existsSync(auth) ? 'private session file exists; validating in browser next' : 'Run npm run vtc -- login --target <app> with dedicated local account; never commit .auth')
  for (const kind of ['api', 'agent']) {
    const path = values[`${kind}-log` as 'api-log' | 'agent-log'] ?? process.env[`VTC_${kind.toUpperCase()}_LOG`]
    const ok = Boolean(path && existsSync(path) && statSync(path).isFile())
    check(`${kind} log`, ok, ok ? 'readable local log; sanitized run-window tail will be saved' : `Set --${kind}-log to the actual local process log; do not use production logs`)
    if (ok) starts[kind] = statSync(path!).size
  }
  if (checks.some(c => !c.ok)) return false
  let browser
  try {
    browser = await chromium.launch({ headless: true, channel: values['browser-channel'] })
    const context = await browser.newContext({ storageState: auth })
    const page = await context.newPage()
    const unexpected: string[] = []
    // Prevent a locally served frontend from sending credentials to a production API.
    await context.route('**/*', async route => {
      const u = new URL(route.request().url())
      if ((u.pathname.startsWith('/api/') || u.pathname.startsWith('/sessions')) && u.origin !== new URL(api).origin) {
        unexpected.push(u.origin); return route.abort()
      }
      return route.continue()
    })
    let scopeSeen = false
    let scopeToken = ''
    page.on('request', req => { if (new URL(req.url()).origin === new URL(api).origin && req.headers()['x-spasht-workspace']) { scopeSeen = true; scopeToken = req.headers()['x-spasht-workspace']! } })
    await navigateProduct(page, { targetUrl: target, workspace }, '/elevate')
    const token = await page.evaluate(() => localStorage.getItem('spashtai_token'))
    const me = token ? await context.request.get(new URL('/api/auth/me', api).toString(), {
      headers: { Authorization: `Bearer ${token}` }, timeout: 10000,
    }) : null
    check('authenticated account', me?.status() === 200, 'identity validated against selected API; no token saved in report')
    if (workspace) {
      await page.waitForTimeout(2500)
      check('selected workspace', scopeSeen && new URL(page.url()).pathname.startsWith(`/w/${workspace}/`), `${workspace}; workspace header must be emitted by the app, never fabricated`)
    } else check('selected workspace', !new URL(page.url()).pathname.startsWith('/w/'), 'Personal (explicit default)')
    if ((values.experience ?? 'both') !== 'elevate' && token && (!workspace || scopeToken)) {
      const options = await context.request.get(new URL('/api/interviews/options', api).toString(), {
        headers: { Authorization: `Bearer ${token}`, ...(workspace ? { 'x-spasht-workspace': scopeToken } : {}) }, timeout: 10000,
      })
      check('Interview access / bank options', options.status() === 200,
        `HTTP ${options.status()}; use a dedicated enabled learner, published fictional bank and configured voice profile`)
    }
    check('frontend API binding', unexpected.length === 0, unexpected.length ? 'frontend calls another API; fix VITE_API_BASE_URL, do not run' : 'no conflicting API requests observed')
    await context.close()
  } catch (error) {
    check('browser / workspace', false, `Could not validate browser auth/workspace: ${error instanceof Error ? error.message : 'browser failed'}. Check installed Chromium, login and membership/access`)
  } finally { await browser?.close() }
  return checks.every(c => c.ok)
}
function saveLogs() {
  for (const kind of Object.keys(starts)) {
    const path = values[`${kind}-log` as 'api-log' | 'agent-log'] ?? process.env[`VTC_${kind.toUpperCase()}_LOG`]
    // Bounded tail only. Logs can contain secrets even before this tool's run.
    const size = statSync(path!).size
    const from = Math.max(size - 256000, Math.min(starts[kind]!, size))
    const bytes = Buffer.alloc(size - from)
    const fd = openSync(path!, 'r')
    try { readSync(fd, bytes, 0, bytes.length, from) } finally { closeSync(fd) }
    writeFileSync(resolve(dir, `${kind}-run.log`), redact(bytes.toString(), secrets), { mode: 0o600 })
  }
}
async function child(scenario: string) {
  const args = ['--import', 'tsx', 'src/cli.ts', 'run', '--target', target, '--auth-file', auth,
    '--api-url', api, '--scenario', scenario, '--output', dir, '--max-minutes', String(boundedNumber(values['max-minutes'] ?? 8, 'max-minutes', 0.1, 20)),
    '--verify-timeout', String(boundedNumber(values['verify-timeout'] ?? 120, 'verify-timeout', 1, 600))]
  if (workspace) args.push('--workspace', workspace)
  if (values['allow-production']) args.push('--allow-production')
  if (values['browser-channel']) args.push('--browser-channel', values['browser-channel'])
  return await new Promise<number>(resolveCode => {
    const proc = spawn(process.execPath, args, { stdio: 'inherit' })
    // Whole scenario bound includes setup and sequential result polling, not just conversation time.
    const timer = setTimeout(() => proc.kill('SIGTERM'), 25 * 60_000)
    const killer = setTimeout(() => proc.kill('SIGKILL'), 26 * 60_000)
    proc.on('error', () => { clearTimeout(timer); clearTimeout(killer); resolveCode(2) })
    proc.on('exit', code => { clearTimeout(timer); clearTimeout(killer); resolveCode(code ?? 3) })
  })
}
async function main() {
  if (!['preflight', 'test'].includes(command)) throw new Error('Use preflight or test; see README for exact commands')
  const experience = values.experience ?? 'both'
  if (!['both', 'interview', 'elevate'].includes(experience)) throw new Error('experience must be both, interview or elevate')
  let ready = false
  const results: Array<{ scenario: string; exit: number }> = []
  try {
    ready = await preflight()
    if (ready && command === 'test') {
      const scenarios = values.scenario ? [values.scenario] : experience === 'both' ? ['confident-interview', 'elevate-learner'] : [experience === 'interview' ? 'confident-interview' : 'elevate-learner']
      for (const scenario of scenarios) results.push({ scenario, exit: await child(scenario) })
    }
  } finally {
    if (existsSync(dir)) {
      saveLogs()
      writeFileSync(resolve(dir, 'workflow.json'), JSON.stringify({ command, target: safeUrl(target), workspace: workspace ?? 'Personal', checks, results,
        outcome: !ready ? 'blocked' : command === 'preflight' ? 'preflight-only' : results.every(r => r.exit === 0) ? 'passed' : 'not-passed' }, null, 2), { mode: 0o600 })
      console.log(`Evidence: ${dir}`)
    }
  }
  process.exitCode = !ready ? 2 : results.find(r => r.exit !== 0)?.exit ?? 0
}
main().catch(error => { console.error(`Workflow blocked: ${redact(error instanceof Error ? error.message : 'check local configuration', secrets)}. No production authorization is implied.`); process.exitCode = 2 })
