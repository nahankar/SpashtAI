#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { assertTargetAllowed, classifyTarget, DEFAULT_TARGET, loadLocalEnv, providerConfig, type Experience, type RunConfig } from './config.js'
import { getScenario, SCENARIOS } from './candidate/scenarios.js'
import { PROFILES } from './candidate/profiles.js'
import { probe } from './providers/index.js'

const HELP = `SpashtAI voice test candidate (developer tool — never part of the product)

Usage: npm run vtc -- <command> [options]

Commands
  run              Drive one live Interview or Elevate session by voice and write an evidence bundle
  login            Save a signed-in browser session for the target (form or --manual)
  register-local   Create the fictional password test account on a LOCAL stack (one time)
  diagnose         Provider-free audio transport check (virtual mic -> WebRTC -> capture); not an end-to-end run
  providers        Check that speech recognition, response generation and synthesis endpoints are reachable
  scenarios        List scenarios and candidate profiles

Common options
  --target <url>            App URL (default ${DEFAULT_TARGET}); production hosts need --allow-production
  --auth-file <path>        Browser session file (default .auth/<host>_<port>.json)
  --headed                  Show the browser (speaker output stays muted unless --speakers)
  --speakers                Let the browser play SpashtAI audio through the speakers
  --browser-channel <name>  e.g. chrome to use installed Google Chrome instead of Playwright Chromium
  --output <dir>            Evidence root (default ./runs)

run options
  --experience interview|elevate      (default: the scenario's experience)
  --scenario <id>                     (default confident-interview / elevate-learner)
  --profile <id>                      fictional candidate profile (default: the scenario's)
  --max-minutes <n>                   hard limit on the conversation (default: practice time + 5, Elevate 12)
  --max-turns <n>                     hard limit on candidate replies (default 14 Interview, 10 Elevate)
  --interview-minutes <n>             practice time chosen in the Interview setup (default 5)
  --elevate-focus <id>                Elevate focus area (default clarity)
  --verify-timeout <seconds>          wait for recording/evaluation after the session (default 240)
  --close-unfinished                  end an unfinished Interview practice through the UI before starting
  --seed <n>                          reproducible delays and pauses (default 1)
  --no-trace                          skip the Playwright trace
  --trace-snapshots                   include DOM snapshots in the trace (much larger)
  --video                             record browser video (no audio)
  --allow-production                  required to target production
  Provider overrides (also via VTC_* environment variables, see config.example.env):
  --stt-url --stt-model --llm-provider openai-compatible|scripted --llm-url --llm-model
  --tts-provider openai-compatible|macos-say --tts-url --tts-voice

login options
  --manual                  Sign in yourself in a visible browser (e.g. Google)
  (otherwise VTC_EMAIL and VTC_PASSWORD are used with the app's email/password form)

register-local options
  --api-url <url>           Local API (default http://localhost:4000); uses VTC_EMAIL / VTC_PASSWORD

Exit codes: 0 passed, 1 failed, 2 blocked, 3 inconclusive, 64 usage error.
`

function defaultAuthFile(target: string): string {
  const url = new URL(target)
  return resolve('.auth', `${url.hostname}_${url.port || (url.protocol === 'https:' ? '443' : '80')}.json`)
}

async function main(argv: string[]): Promise<number> {
  loadLocalEnv()
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true, strict: true,
    options: {
      help: { type: 'boolean', short: 'h' }, target: { type: 'string' }, 'auth-file': { type: 'string' }, headed: { type: 'boolean' },
      speakers: { type: 'boolean' }, 'browser-channel': { type: 'string' }, output: { type: 'string' }, experience: { type: 'string' },
      scenario: { type: 'string' }, profile: { type: 'string' }, 'max-minutes': { type: 'string' }, 'max-turns': { type: 'string' },
      'interview-minutes': { type: 'string' }, 'elevate-focus': { type: 'string' }, 'verify-timeout': { type: 'string' },
      'close-unfinished': { type: 'boolean' }, seed: { type: 'string' }, 'no-trace': { type: 'boolean' }, 'trace-snapshots': { type: 'boolean' }, video: { type: 'boolean' },
      'allow-production': { type: 'boolean' }, manual: { type: 'boolean' }, 'api-url': { type: 'string' },
      'stt-url': { type: 'string' }, 'stt-model': { type: 'string' }, 'llm-provider': { type: 'string' }, 'llm-url': { type: 'string' },
      'llm-model': { type: 'string' }, 'tts-provider': { type: 'string' }, 'tts-url': { type: 'string' }, 'tts-voice': { type: 'string' },
    },
  })
  const command = positionals[0]
  if (values.help || !command) { process.stdout.write(HELP); return command ? 0 : 64 }
  const target = values.target ?? process.env.VTC_TARGET_URL ?? DEFAULT_TARGET
  const targetKind = classifyTarget(target)
  assertTargetAllowed(targetKind, Boolean(values['allow-production']))
  const authFile = resolve(values['auth-file'] ?? process.env.VTC_AUTH_FILE ?? defaultAuthFile(target))
  const output = resolve(values.output ?? 'runs')

  if (command === 'scenarios') {
    for (const s of Object.values(SCENARIOS)) process.stdout.write(`${s.id.padEnd(22)} ${s.experience.padEnd(10)} ${s.description}\n`)
    process.stdout.write('\nProfiles:\n')
    for (const p of Object.values(PROFILES)) process.stdout.write(`${p.id.padEnd(22)} ${p.name} — ${p.summary}\n`)
    return 0
  }

  const overrides: Record<string, string> = {}
  const map: Record<string, string> = { 'stt-url': 'VTC_STT_BASE_URL', 'stt-model': 'VTC_STT_MODEL', 'llm-provider': 'VTC_LLM_PROVIDER', 'llm-url': 'VTC_LLM_BASE_URL',
    'llm-model': 'VTC_LLM_MODEL', 'tts-provider': 'VTC_TTS_PROVIDER', 'tts-url': 'VTC_TTS_BASE_URL', 'tts-voice': 'VTC_TTS_VOICE' }
  for (const [flag, key] of Object.entries(map)) { const v = (values as Record<string, unknown>)[flag]; if (typeof v === 'string') overrides[key] = v }
  const providers = providerConfig(process.env, overrides)

  if (command === 'providers') {
    let ok = true
    for (const [name, p] of [['speech recognition', providers.stt], ['response generation', providers.llm], ['speech synthesis', providers.tts]] as const) {
      if (p.provider !== 'openai-compatible') { process.stdout.write(`${name}: ${p.provider} (no endpoint)\n`); continue }
      const r = await probe(p.baseUrl, p.apiKey)
      ok &&= r.ok
      process.stdout.write(`${name}: ${r.ok ? 'ok' : 'UNREACHABLE'} — ${p.baseUrl} model=${p.model} (${r.detail})\n`)
    }
    return ok ? 0 : 2
  }

  if (command === 'diagnose') {
    const { diagnoseTransport } = await import('./diagnose.js')
    const result = await diagnoseTransport({ outputDir: output, headed: values.headed, channel: values['browser-channel'] })
    for (const c of result.checks) process.stdout.write(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}\n`)
    process.stdout.write(`\nDiagnostic ${result.passed ? 'passed' : 'FAILED'} (provider-free transport check, not an end-to-end run). Evidence: ${result.dir}\n`)
    return result.passed ? 0 : 1
  }

  if (command === 'login') {
    const { loginManually, loginWithForm } = await import('./auth.js')
    if (values.manual) await loginManually({ targetUrl: target, authFile, channel: values['browser-channel'] })
    else {
      const email = process.env.VTC_EMAIL, password = process.env.VTC_PASSWORD
      if (!email || !password) { process.stderr.write('Set VTC_EMAIL and VTC_PASSWORD (environment or .env.local), or use --manual.\n'); return 64 }
      await loginWithForm({ targetUrl: target, email, password, authFile, headed: Boolean(values.headed), channel: values['browser-channel'] })
    }
    process.stdout.write(`Saved signed-in browser session to ${authFile} (keep it private; it is git-ignored).\n`)
    return 0
  }

  if (command === 'register-local') {
    const { registerLocalAccount } = await import('./auth.js')
    const email = process.env.VTC_EMAIL, password = process.env.VTC_PASSWORD
    if (!email || !password) { process.stderr.write('Set VTC_EMAIL and VTC_PASSWORD first.\n'); return 64 }
    process.stdout.write(`${await registerLocalAccount({ apiUrl: values['api-url'] ?? 'http://localhost:4000', email, password, targetKind })}\n`)
    return 0
  }

  if (command === 'run') {
    const scenarioId = values.scenario ?? (values.experience === 'elevate' ? 'elevate-learner' : 'confident-interview')
    const scenario = getScenario(scenarioId)
    const experience = (values.experience ?? scenario.experience) as Experience
    if (!['interview', 'elevate'].includes(experience)) { process.stderr.write('--experience must be interview or elevate\n'); return 64 }
    if (experience !== scenario.experience) { process.stderr.write(`Scenario ${scenario.id} is for ${scenario.experience}.\n`); return 64 }
    const interviewMinutes = Number(values['interview-minutes'] ?? 5)
    const maxMinutes = Number(values['max-minutes'] ?? (experience === 'interview' ? interviewMinutes + 5 : 12))
    const cfg: RunConfig = {
      targetUrl: target, targetKind, experience, scenario: scenario.id, profile: values.profile ?? scenario.defaultProfile, authFile,
      headed: Boolean(values.headed), muteSpeakers: !values.speakers, browserChannel: values['browser-channel'],
      maxDurationMs: maxMinutes * 60_000, maxTurns: Number(values['max-turns'] ?? (experience === 'interview' ? 14 : 10)), outputDir: output,
      trace: !values['no-trace'], traceSnapshots: Boolean(values['trace-snapshots']), video: Boolean(values.video), seed: Number(values.seed ?? 1), interviewMinutes,
      elevateFocus: values['elevate-focus'] ?? 'clarity', closeUnfinished: Boolean(values['close-unfinished']),
      verifyTimeoutMs: Number(values['verify-timeout'] ?? 240) * 1000, providers,
    }
    const { runSession } = await import('./run.js')
    const report = await runSession(cfg)
    process.stdout.write(`\nResult: ${report.outcome.toUpperCase()}\n${report.outcomeReasons.map(r => `  - ${r}`).join('\n')}\nReport: ${resolve(output, report.runId, 'report.md')}\n`)
    return { passed: 0, failed: 1, blocked: 2, inconclusive: 3 }[report.outcome]
  }

  process.stderr.write(`Unknown command "${command}"\n\n${HELP}`)
  return 64
}

main(process.argv.slice(2)).then(code => { process.exitCode = code }, error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 64
})
