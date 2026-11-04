import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { AppApi, BlockedError, type AdapterContext, type Check, type ExperienceAdapter } from './adapters/types.js'
import { InterviewAdapter } from './adapters/interview.js'
import { ElevateAdapter } from './adapters/elevate.js'
import { durationMs as pcmDuration } from './audio/pcm.js'
import { AudioBridge } from './browser/bridge.js'
import { browserArgs } from './browser/launch.js'
import { CandidateBrain } from './candidate/brain.js'
import { getProfile } from './candidate/profiles.js'
import { between, getScenario, seededRandom } from './candidate/scenarios.js'
import { streamReply } from './candidate/speech.js'
import { classifyTarget, knownSecrets, type RunConfig } from './config.js'
import { ConversationEngine, type StopReason } from './engine/conversation.js'
import { createChat, createStt, createTts, probe } from './providers/index.js'
import { Evidence, newRunId } from './report/evidence.js'
import { classify, LIMITATIONS, renderMarkdown, stats, type RunReport } from './report/report.js'
import { redactTraceArchive } from './report/trace.js'
import { safeUrl } from './redact.js'

const TOOL_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string

function gitInfo(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().length > 0
    return { commit, dirty }
  } catch { return { commit: 'unknown', dirty: false } }
}

export function createAdapter(experience: RunConfig['experience']): ExperienceAdapter {
  return experience === 'interview' ? new InterviewAdapter() : new ElevateAdapter()
}

export async function runSession(cfg: RunConfig): Promise<RunReport> {
  const secrets = knownSecrets()
  const runId = newRunId()
  const evidence = new Evidence(cfg.outputDir, runId, secrets)
  const startedAt = new Date(evidence.t0).toISOString()
  const scenario = getScenario(cfg.scenario)
  const profile = getProfile(cfg.profile)
  const rand = seededRandom(cfg.seed)
  const errors: string[] = []
  const missing: string[] = []
  const artifacts: RunReport['artifacts'] = []
  const checks: Check[] = []
  const adapter = createAdapter(cfg.experience)
  const stt = createStt(cfg.providers.stt)
  const tts = createTts(cfg.providers.tts)
  const chat = cfg.providers.llm.provider === 'scripted' ? null : createChat(cfg.providers.llm)
  const brain = new CandidateBrain(profile, scenario, chat)
  const providers: Record<string, string> = {
    'Speech recognition (listening)': cfg.providers.stt.provider === 'none' ? 'disabled' : `${cfg.providers.stt.model} via ${cfg.providers.stt.baseUrl}`,
    'Response generation': chat ? chat.description : 'scripted profile answers (provider-free)',
    'Speech synthesis': tts.description,
  }
  evidence.writeJson('manifest.json', {
    runId, startedAt, target: safeUrl(cfg.targetUrl), targetKind: cfg.targetKind, workspace: cfg.workspace ?? 'Personal', experience: cfg.experience, scenario: scenario.id,
    profile: profile.id, tool: { version: TOOL_VERSION, ...gitInfo() }, providers, seed: cfg.seed,
    limits: { maxDurationMs: cfg.maxDurationMs, maxTurns: cfg.maxTurns, verifyTimeoutMs: cfg.verifyTimeoutMs,
      requests: { stt: cfg.providers.stt.maxRequests, llm: cfg.providers.llm.maxRequests, tts: cfg.providers.tts.maxRequests } },
    candidateSystemPrompt: brain.systemPrompt(),
  })
  evidence.event('tool', 'run_started', { runId, experience: cfg.experience, scenario: scenario.id, profile: profile.id, target: safeUrl(cfg.targetUrl) })

  let blocked: string | undefined
  let stop: StopReason | null = null
  let finish: RunReport['finish'] = null
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  let engine: ConversationEngine | null = null
  const bridge = new AudioBridge(evidence, { endSilenceMs: 900, thresholdDb: -48, minSpeechMs: 120 })

  const report = (): RunReport => {
    const verdict = classify({ blocked, stop, finish, checks })
    const turns = engine?.turns ?? []
    return {
      runId, outcome: verdict.outcome, outcomeReasons: verdict.reasons, startedAt, endedAt: new Date().toISOString(),
      durationMs: Date.now() - evidence.t0, target: safeUrl(cfg.targetUrl), targetKind: cfg.targetKind, workspace: cfg.workspace ?? 'Personal', experience: cfg.experience,
      scenario: scenario.id, profile: profile.id, tool: { version: TOOL_VERSION, ...gitInfo() }, providers, identifiers: adapter.identifiers(),
      stop, finish, checks, turns,
      independentTranscript: (engine?.transcripts ?? []).sort((a, b) => a.startEpoch - b.startEpoch).map(t => ({ id: t.id, tMs: evidence.rel(t.startEpoch), text: t.text, ...(t.error ? { error: t.error } : {}) })),
      timings: {
        'SpashtAI speech end → candidate audio start': stats(turns.map(t => t.responseGapMs)),
        'Candidate audio end → next SpashtAI speech start': stats(turns.map(t => t.appResponseLatencyMs)),
        'Candidate reply generation': stats(turns.map(t => t.generationMs)),
        'Candidate speech synthesis': stats(turns.map(t => t.synthesisMs)),
      },
      providerRequests: { 'speech recognition': stt.budget.count, 'response generation': chat?.budget.count ?? 0, 'speech synthesis': tts.budget.count },
      artifacts, missingEvidence: missing, errors, limitations: LIMITATIONS,
    }
  }

  try {
    if (!existsSync(cfg.authFile)) throw new BlockedError(`No browser session file at ${cfg.authFile}. Run the login command first.`)
    for (const [name, base, key, enabled] of [
      ['speech recognition', cfg.providers.stt.baseUrl, cfg.providers.stt.apiKey, cfg.providers.stt.provider === 'openai-compatible'],
      ['response generation', cfg.providers.llm.baseUrl, cfg.providers.llm.apiKey, cfg.providers.llm.provider === 'openai-compatible'],
      ['speech synthesis', cfg.providers.tts.baseUrl, cfg.providers.tts.apiKey, cfg.providers.tts.provider === 'openai-compatible'],
    ] as const) {
      if (!enabled) continue
      const p = await probe(base, key)
      evidence.event('tool', 'provider_probe', { provider: name, ok: p.ok, detail: p.detail })
      if (!p.ok) throw new BlockedError(`${name} provider at ${base} is unreachable (${p.detail})`)
    }

    browser = await chromium.launch({ headless: !cfg.headed, channel: cfg.browserChannel, args: browserArgs({ muteSpeakers: cfg.muteSpeakers }) })
    context = await browser.newContext({
      storageState: cfg.authFile, viewport: { width: 1360, height: 900 },
      ...(cfg.video ? { recordVideo: { dir: evidence.path('browser'), size: { width: 1360, height: 900 } } } : {}),
    })
    await context.route('**/*', async route => {
      const url = new URL(route.request().url())
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sessions')) {
        const wrongApi = cfg.apiUrl && url.origin !== new URL(cfg.apiUrl).origin
        const remoteFromLocal = cfg.targetKind === 'local' && classifyTarget(url.toString()) !== 'local'
        if (wrongApi || remoteFromLocal) {
          errors.push('Refused app request to an unexpected API origin')
          return route.abort()
        }
      }
      return route.continue()
    })
    await context.grantPermissions(['microphone'], { origin: new URL(cfg.targetUrl).origin })
    if (cfg.trace) await context.tracing.start({ screenshots: cfg.traceFull, snapshots: cfg.traceFull, sources: false })
    await bridge.install(context)
    page = await context.newPage()
    bridge.page = page
    page.on('console', msg => { if (msg.type() === 'error') errors.push(evidence.sanitize(`console: ${msg.text()}`)) })
    page.on('pageerror', err => errors.push(evidence.sanitize(`pageerror: ${err.message}`)))
    page.on('requestfailed', req => { if (!/livekit|rtc/.test(req.url())) errors.push(evidence.sanitize(`requestfailed: ${req.method()} ${safeUrl(req.url())} ${req.failure()?.errorText ?? ''}`)) })
    page.on('response', res => { if (res.status() >= 500) errors.push(evidence.sanitize(`HTTP ${res.status()} ${res.request().method()} ${safeUrl(res.url())}`)) })
    let shot = 0
    const ctx: AdapterContext = {
      page, context, evidence, bridge, cfg, api: new AppApi(page, context, cfg.workspace),
      screenshot: async name => {
        const file = `screenshots/${String(++shot).padStart(2, '0')}-${name}.png`
        await page!.screenshot({ path: evidence.path(file), fullPage: true }).then(() => evidence.event('browser', 'screenshot', { file }), () => undefined)
      },
    }

    engine = new ConversationEngine({
      now: () => Date.now(),
      sleep: (ms, signal) => new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason)
        const timer = setTimeout(resolve, ms)
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
      }),
      transcribe: (u, signal) => stt.transcribe(u.pcm, signal),
      decide: (heard, signal) => brain.decide(heard, signal),
      commit: (heard, spoken) => brain.commit(heard, spoken),
      synthesize: async (text, turn, signal) => {
        const stream = streamReply(tts, text, scenario, rand, signal)
        const iterator = stream.chunks[Symbol.asyncIterator]()
        const first = await iterator.next()
        if (first.done) throw new Error('Speech synthesis produced no audio')
        const audio = (async function* () {
          yield first.value
          for (let next = await iterator.next(); !next.done; next = await iterator.next()) yield next.value
        })()
        const meta = stream.done.then(reply => {
          const file = `audio/candidate-${String(turn).padStart(3, '0')}.wav`
          evidence.writeBinary(file, reply.wav)
          return { file, durationMs: Math.round(pcmDuration(reply.pcm)), chunks: reply.pieces.length, insertedPausesMs: reply.insertedPausesMs, measuredPausesMs: reply.measuredPausesMs }
        })
        return { audio, meta }
      },
      play: async (id, audio) => {
        const { started, finished } = await bridge.play(id, audio)
        return { startEpoch: started.startEpoch, micOpenAtStart: started.mic.some(m => m.enabled && m.readyState === 'live'), finished }
      },
      stop: id => bridge.stop(id),
      micOpen: async () => (await bridge.micState()).some(m => m.enabled && m.readyState === 'live'),
      appSpeaking: () => bridge.appSpeaking(),
      completion: () => adapter.completion(ctx),
      log: (kind, data, epochMs) => { evidence.event('candidate', kind, data, epochMs) },
    }, {
      replyAfterSilenceMs: 1400,
      thinkDelayMs: () => between(rand, scenario.thinkDelayMs),
      micGateMs: 8000,
      yieldAfterMs: 1200,
      maxTurns: cfg.maxTurns,
      maxDurationMs: cfg.maxDurationMs,
      appSilenceTimeoutMs: 90_000,
      silentTurns: scenario.silentTurns ?? [],
      silenceMs: scenario.silenceMs ?? 0,
      completionPollMs: 1000,
    })
    const eng = engine
    adapter.attach?.(eng)
    bridge.on({ speechStart: s => eng.onSpeechStart(s.epochMs), utterance: u => eng.onUtterance(u) })

    const onSignal = () => { evidence.event('tool', 'interrupted_by_operator'); eng.stop({ kind: 'cancelled', detail: 'operator interrupted the run (SIGINT/SIGTERM)' }) }
    process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
    try {
      await adapter.prepare(ctx)
      evidence.event('tool', 'conversation_started')
      stop = await eng.run()
      evidence.event('tool', 'conversation_stopped', { ...stop, candidateTurns: eng.spokenTurns, candidateThinksComplete: eng.candidateThinksComplete })
      try { await ctx.page.locator('body').innerText().then(t => evidence.writeText('browser/page-text-at-stop.txt', t)) } catch { /* diagnostic only */ }
      finish = await adapter.finish(ctx, stop, eng)
      evidence.event('tool', 'session_finish', finish)
    } finally {
      process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal)
    }

    checks.push({ name: 'spashtai_audio_received', status: bridge.incomingStreamCount() && eng.transcripts.length ? 'passed' : 'failed', required: true, basis: 'audio',
      detail: `${bridge.incomingStreamCount()} incoming track(s), ${eng.transcripts.length} SpashtAI utterance(s) detected` })
    const recognized = eng.transcripts.filter(t => t.text).length
    checks.push({ name: 'spashtai_speech_recognized', status: recognized ? 'passed' : 'failed', required: true, basis: 'audio', detail: `${recognized}/${eng.transcripts.length} utterances independently recognized` })
    const spokenOpen = eng.turns.filter(t => t.spoken && t.micOpenAtStart).length
    checks.push({ name: 'candidate_spoke_into_open_mic', status: spokenOpen ? 'passed' : 'failed', required: true, basis: 'audio',
      detail: `${spokenOpen} candidate utterance(s) started while the app's microphone track was enabled (${eng.turns.filter(t => t.spoken).length} spoken in total)` })
    checks.push({ name: 'natural_completion', status: stop?.kind === 'natural' ? 'passed' : 'failed', required: false, basis: 'browser',
      detail: stop ? `${stop.kind}: ${stop.detail}` : 'conversation did not run' })
    if (stop?.kind !== 'natural') missing.push('The application did not signal completion before the tool stopped; completion-dependent evidence may be partial.')

    for (const c of await adapter.verify(ctx, eng)) checks.push(c)
  } catch (error) {
    if (error instanceof BlockedError) blocked = error.message
    else {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(evidence.sanitize(`run: ${message}`))
      stop ??= { kind: 'error', detail: message }
      checks.push({ name: 'run_completed_without_exception', status: 'failed', required: true, basis: 'tool', detail: evidence.sanitize(message) })
    }
    evidence.event('tool', blocked ? 'blocked' : 'run_error', { message: blocked ?? (error instanceof Error ? error.message : String(error)) })
    if (page) await page.screenshot({ path: evidence.path('screenshots/99-failure.png'), fullPage: true }).catch(() => undefined)
  } finally {
    engine?.stop({ kind: 'cancelled', detail: 'run finished' })
    bridge.flush()
    await engine?.settleLate(20_000)
    if (page) {
      const state = await bridge.state()
      if (state) evidence.writeJson('browser/audio-state.json', state)
      await page.evaluate(() => (window as any).__vtc?.release()).catch(() => undefined)
    }
    const audio = bridge.writeEvidence()
    for (const f of audio.files) artifacts.push({ file: f.file, description: f.kind === 'incoming' ? `SpashtAI audio as received by the browser (${f.label}, 16 kHz mono, ${(f.durationMs / 1000).toFixed(1)} s)` : `the app's microphone track as the app captured it — candidate speech, silent while the app disabled it (${f.label}, 16 kHz mono)` })
    if (audio.stereo) artifacts.push({ file: audio.stereo, description: 'combined conversation aligned to run start: left = SpashtAI (received), right = candidate (app mic track), 16 kHz' })
    else missing.push('No audio streams were captured.')
    artifacts.push({ file: 'audio/candidate-NNN.wav', description: 'synthesized candidate utterances exactly as sent to the virtual microphone' })
    artifacts.push({ file: 'audio/app-utterance-NNN.wav', description: 'each detected SpashtAI utterance, as sent to speech recognition' })
    try {
      if (context && cfg.trace) {
        const tracePath = evidence.path('browser/trace.zip')
        try {
          await context.tracing.stop({ path: tracePath })
          const changed = redactTraceArchive(tracePath, secrets)
          evidence.event('tool', 'trace_redacted', { entriesChanged: changed })
          artifacts.push({ file: 'browser/trace.zip', description: `Playwright trace (actions and network${cfg.traceFull ? ', screencast, DOM snapshots' : ''}) with tokens redacted; open with \`npx playwright show-trace\`` })
        } catch (e) {
          // An unredacted trace contains live tokens: never keep it.
          rmSync(tracePath, { force: true })
          missing.push(`trace discarded (could not be saved and redacted: ${e instanceof Error ? e.message : e})`)
        }
      }
    } finally {
      await context?.close().catch(() => undefined)
      await browser?.close().catch(() => undefined)
    }
    if (cfg.video) artifacts.push({ file: 'browser/*.webm', description: 'browser video — contains NO audio' })
  }

  const final = report()
  evidence.writeJson('conversation.json', { turns: final.turns, independentTranscript: final.independentTranscript, candidateHistory: brain.transcript })
  evidence.writeJson('errors.json', errors)
  evidence.writeJson('report.json', final)
  evidence.writeText('report.md', renderMarkdown(final, evidence.t0))
  evidence.event('tool', 'run_finished', { outcome: final.outcome, reasons: final.outcomeReasons, dir: evidence.dir })
  try { chmodSync(cfg.authFile, 0o600) } catch { /* best effort */ }
  return final
}
