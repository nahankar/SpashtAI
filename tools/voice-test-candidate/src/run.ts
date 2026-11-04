import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { AppApi, AttributedError, BlockedError, type AdapterContext, type Check, type ExperienceAdapter } from './adapters/types.js'
import { InterviewAdapter } from './adapters/interview.js'
import { ElevateAdapter } from './adapters/elevate.js'
import { durationMs as pcmDuration } from './audio/pcm.js'
import { AudioBridge } from './browser/bridge.js'
import { browserArgs } from './browser/launch.js'
import { apiOriginGuard } from './browser/guard.js'
import { CandidateBrain } from './candidate/brain.js'
import { getProfile } from './candidate/profiles.js'
import { between, getScenario, seededRandom } from './candidate/scenarios.js'
import { streamReply } from './candidate/speech.js'
import { knownSecrets, type RunConfig } from './config.js'
import { ConversationEngine, type StopReason } from './engine/conversation.js'
import { createChat, createStt, createTts, probe } from './providers/index.js'
import { Evidence, newRunId } from './report/evidence.js'
import { classify, LIMITATIONS, renderMarkdown, stats, type FailureSource, type RunReport } from './report/report.js'
import { redactTraceArchive } from './report/trace.js'
import { safeUrl } from './redact.js'
import { inspectStack, type ComponentProvenance } from './provenance.js'

const TOOL_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string

function gitInfo(): { commit: string; dirty: boolean } {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
    const dirty = execFileSync('git', ['status', '--porcelain', '--', '.'], { encoding: 'utf8' }).trim().length > 0
    return { commit, dirty }
  } catch { return { commit: 'unknown', dirty: false } }
}

export function createAdapter(experience: RunConfig['experience'], scenario?: string): ExperienceAdapter {
  return experience === 'interview' ? new InterviewAdapter(scenario) : new ElevateAdapter()
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
  const adapter = createAdapter(cfg.experience, cfg.scenario)
  const stt = createStt(cfg.providers.stt)
  const tts = createTts(cfg.providers.tts)
  const chat = cfg.providers.llm.provider === 'scripted' ? null : createChat(cfg.providers.llm)
  const brain = new CandidateBrain(profile, scenario, chat)
  const providers: Record<string, string> = {
    'Speech recognition (listening)': cfg.providers.stt.provider === 'none' ? 'disabled' : `${cfg.providers.stt.model} via ${cfg.providers.stt.baseUrl}`,
    'Response generation': chat ? chat.description : 'scripted profile answers (provider-free)',
    'Speech synthesis': tts.description,
  }
  // Inspected once at the start: the application revision is independent of the tool revision.
  let application: ComponentProvenance[] = []
  try { application = inspectStack({ targetUrl: cfg.targetUrl, apiUrl: cfg.apiUrl, livekitUrl: cfg.livekitUrl, declaredSource: cfg.appSource }) }
  catch (error) { application = [{ component: 'web', status: 'unknown', basis: `inspection failed: ${error instanceof Error ? error.message : error}` }] }
  if (cfg.appSource) for (const a of application) if (a.status === 'unknown' && !a.sourceDir) { a.sourceDir = cfg.appSource; a.basis += '; source directory declared by the operator, not verified' }
  evidence.writeJson('manifest.json', {
    runId, startedAt, target: safeUrl(cfg.targetUrl), targetKind: cfg.targetKind, workspace: cfg.workspace ?? 'Personal', experience: cfg.experience, scenario: scenario.id,
    profile: profile.id, tool: { version: TOOL_VERSION, ...gitInfo(), note: 'test tool revision only; see application' }, application, providers, seed: cfg.seed,
    limits: { maxDurationMs: cfg.maxDurationMs, maxTurns: cfg.maxTurns, verifyTimeoutMs: cfg.verifyTimeoutMs,
      requests: { stt: cfg.providers.stt.maxRequests, llm: cfg.providers.llm.maxRequests, tts: cfg.providers.tts.maxRequests } },
    candidateSystemPrompt: brain.systemPrompt(),
  })
  evidence.event('tool', 'run_started', { runId, experience: cfg.experience, scenario: scenario.id, profile: profile.id, target: safeUrl(cfg.targetUrl) })

  let blocked: string | undefined
  let blockedSource: FailureSource = 'setup'
  let stopSource: FailureSource | undefined
  let originViolation: string | null = null
  let atStop: Record<string, unknown> | undefined
  let stop: StopReason | null = null
  let finish: RunReport['finish'] = null
  let browser: Browser | null = null
  let context: BrowserContext | null = null
  let page: Page | null = null
  let engine: ConversationEngine | null = null
  let interrupt: ((reason: StopReason) => void) | null = null
  const onInterrupt = (reason: StopReason) => {
    if (interrupt) { interrupt(reason); return }
    evidence.event('tool', reason.kind === 'timeout' ? 'whole_run_timeout' : 'interrupted_by_operator', { detail: reason.detail })
    stop ??= reason
    void browser?.close().catch(() => undefined)
  }
  const onSignal = () => onInterrupt({ kind: 'cancelled', detail: 'operator interrupted the run (SIGINT/SIGTERM)' })
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal)
  const watchdog = setTimeout(() => onInterrupt({ kind: 'timeout', detail: `whole run exceeded ${Math.round(cfg.runTimeoutMs / 60_000)} min (setup, conversation, ending and verification)` }), cfg.runTimeoutMs)
  const bridge = new AudioBridge(evidence, { endSilenceMs: 900, thresholdDb: -48, minSpeechMs: 120 })

  const report = (): RunReport => {
    const verdict = classify({ blocked: blocked ?? originViolation ?? undefined, blockedSource, stop, stopSource, finish, checks })
    const turns = engine?.turns ?? []
    return {
      runId, outcome: verdict.outcome, outcomeReasons: verdict.reasons, failureSources: verdict.sources, application,
      interviewMode: adapter.mode?.(), atStop, startedAt, endedAt: new Date().toISOString(),
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
    await context.route('**/*', apiOriginGuard(cfg, origin => {
      // A local frontend bound to another (possibly production) API invalidates the run: block, never continue.
      originViolation ??= `frontend sent an app request to ${origin}${cfg.apiUrl ? ` instead of ${new URL(cfg.apiUrl).origin}` : ' (non-local API from a local target)'}; request refused. Fix the frontend API binding (VITE_API_BASE_URL).`
      errors.push(`Refused app request to unexpected API origin ${origin}`)
      engine?.stop({ kind: 'error', detail: 'API origin violation' })
    }))
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
      transcribe: pcm => stt.transcribe(pcm),
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
      ...(adapter.scriptedReply ? { scriptedReply: (turn: number) => adapter.scriptedReply!(turn) } : {}),
      ...(adapter.afterCandidateTurn ? { afterSpeech: (turn: number) => adapter.afterCandidateTurn!(ctx, turn) } : {}),
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
    interrupt = (reason: StopReason) => {
      evidence.event('tool', reason.kind === 'timeout' ? 'whole_run_timeout' : 'interrupted_by_operator', { detail: reason.detail })
      if (!stop || stop.kind === 'natural' || stop.kind === 'plan_complete') stop = reason
      eng.stop(reason)
      // Pending browser steps (setup, ending, verification) cannot hang past the bound: closing rejects them.
      if (reason.kind === 'timeout') void browser?.close().catch(() => undefined)
    }
    bridge.on({ speechStart: s => eng.onSpeechStart(s.epochMs), utterance: u => eng.onUtterance(u) })

    try {
      await adapter.prepare(ctx)
      evidence.event('tool', 'conversation_started')
      stop = await eng.run()
      evidence.event('tool', 'conversation_stopped', { ...stop, candidateTurns: eng.spokenTurns, candidateThinksComplete: eng.candidateThinksComplete })
      try { await ctx.page.locator('body').innerText().then(t => evidence.writeText('browser/page-text-at-stop.txt', t)) } catch { /* diagnostic only */ }
      finish = await adapter.finish(ctx, stop, eng)
      evidence.event('tool', 'session_finish', finish)
    } finally { /* signal handlers and the watchdog cover the whole run (installed below) */ }

    for (const t of eng.turns) if (t.candidateStartEpoch && t.candidateEndEpoch) t.micTrackVoicedMs = bridge.voicedMs('mic', t.candidateStartEpoch, t.candidateEndEpoch + 300)
    atStop = stopState(eng, bridge, evidence, await bridge.micState())
    stopSource = attributeStop(stop, eng, originViolation)
    for (const c of liveAudioChecks(eng, bridge.incomingStreamCount(), stop)) checks.push(c)
    if (stop?.kind !== 'natural' && stop?.kind !== 'plan_complete') missing.push('The session did not reach its natural (or, for manual scenarios, planned) end before the tool stopped; completion-dependent evidence may be partial.')

    for (const c of await adapter.verify(ctx, eng)) checks.push(c)
  } catch (error) {
    if (error instanceof BlockedError) blocked = error.message
    else if (stop?.kind === 'timeout' || stop?.kind === 'cancelled') {
      missing.push(`steps after the ${stop.kind === 'timeout' ? 'whole-run timeout' : 'interruption'} did not complete: ${evidence.sanitize(error instanceof Error ? error.message : String(error))}`)
    } else {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(evidence.sanitize(`run: ${message}`))
      stop ??= { kind: 'error', detail: message }
      checks.push({ name: 'run_completed_without_exception', status: 'failed', required: true, basis: 'tool', detail: evidence.sanitize(message),
        attribution: error instanceof AttributedError ? error.source : 'tool' })
      if (error instanceof AttributedError) stopSource = error.source
    }
    evidence.event('tool', blocked ? 'blocked' : 'run_error', { message: blocked ?? (error instanceof Error ? error.message : String(error)) })
    if (page) await page.screenshot({ path: evidence.path('screenshots/99-failure.png'), fullPage: true }).catch(() => undefined)
  } finally {
    clearTimeout(watchdog)
    process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal)
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
  evidence.lockDown()
  try { chmodSync(cfg.authFile, 0o600) } catch { /* best effort */ }
  return final
}

/** Observable state when the conversation stopped: what a person debugging the session would ask first. */
function stopState(eng: ConversationEngine, bridge: AudioBridge, evidence: Evidence, mic: Array<{ enabled: boolean; readyState: string }>): Record<string, unknown> {
  const now = Date.now()
  const at = (epoch: number | null | undefined) => (epoch ? `${(evidence.rel(epoch) / 1000).toFixed(1)} s into the run (${((now - epoch) / 1000).toFixed(1)} s before the stop)` : 'none')
  const lastWords = [...eng.transcripts].filter(t => t.text).sort((a, b) => a.endEpoch - b.endEpoch).at(-1)
  const lastSpoken = eng.turns.filter(t => t.spoken).at(-1)
  return {
    'last SpashtAI speech received (audio)': at(bridge.lastVoicedEpoch('incoming')),
    'last recognized SpashtAI words': lastWords ? `"${lastWords.text.slice(0, 200)}" (ended ${at(lastWords.endEpoch)})` : 'none',
    'last candidate speech on the app microphone track': at(bridge.lastVoicedEpoch('mic')),
    'last candidate reply': lastSpoken ? `turn ${lastSpoken.turn}, ${lastSpoken.micTrackVoicedMs ?? 0} ms voiced on the app microphone track; ended ${at(lastSpoken.candidateEndEpoch)}` : 'none',
    'app microphone track at stop': mic.length ? mic.map(m => `${m.enabled ? 'enabled' : 'disabled'} (${m.readyState})`).join(', ') : 'no microphone track',
    'candidate heard a closing': eng.candidateThinksComplete,
  }
}

/** Points the conversation stop at the application only when the candidate's speech demonstrably reached it. */
export function attributeStop(stop: StopReason | null, eng: ConversationEngine, originViolation: string | null): FailureSource | undefined {
  if (!stop) return undefined
  if (stop.source) return stop.source
  if (originViolation) return 'setup'
  if (stop.kind === 'app_silent') {
    const last = eng.turns.filter(t => t.spoken).at(-1)
    if (!last) return eng.transcripts.length ? 'unknown' : 'application'
    return (last.micTrackVoicedMs ?? 0) >= 500 ? 'application' : 'tool'
  }
  if (stop.kind === 'error') return 'tool'
  if (stop.kind === 'timeout') return 'unknown'
  return undefined
}

/** Live-audio checks: what was exchanged during the session, as captured in the test browser. */
export function liveAudioChecks(eng: Pick<ConversationEngine, 'turns' | 'transcripts'>, incomingTracks: number, stop: StopReason | null): Check[] {
  const checks: Check[] = []
  const utterances = eng.transcripts.length
  checks.push({ name: 'spashtai_audio_received', status: incomingTracks && utterances ? 'passed' : 'failed', required: true, basis: 'audio', area: 'live-audio',
    attribution: incomingTracks ? 'application' : 'setup',
    detail: `${incomingTracks} incoming track(s), ${utterances} SpashtAI utterance(s) detected${incomingTracks ? '' : ' — no agent audio track arrived (agent worker, dispatch or LiveKit targeting)'}` })
  const recognized = eng.transcripts.filter(t => t.text).length
  checks.push({ name: 'spashtai_speech_recognized', status: recognized ? 'passed' : 'failed', required: true, basis: 'audio', area: 'live-audio', attribution: 'tool',
    detail: `${recognized}/${utterances} utterances independently recognized` })
  const spoken = eng.turns.filter(t => t.spoken)
  const spokenOpen = spoken.filter(t => t.micOpenAtStart).length
  const suppressed = eng.turns.filter(t => t.suppressed?.includes('microphone stayed closed')).length
  checks.push({ name: 'candidate_spoke_into_open_mic', status: spokenOpen ? 'passed' : 'failed', required: true, basis: 'audio', area: 'live-audio',
    attribution: !spokenOpen && suppressed ? 'application' : 'tool',
    detail: `${spokenOpen} candidate utterance(s) started while the app's microphone track was enabled (${spoken.length} spoken; ${suppressed} withheld because the app kept its microphone closed)` })
  // The reply must actually be on the app's own track, not only played into the virtual device.
  const short = spoken.filter(t => (t.micTrackVoicedMs ?? 0) < Math.min(1000, 0.3 * Number((t.audioMeta as { durationMs?: number } | undefined)?.durationMs ?? 3000)))
  checks.push({ name: 'candidate_speech_on_app_mic_track', status: spoken.length && !short.length ? 'passed' : 'failed', required: true, basis: 'audio', area: 'live-audio',
    attribution: short.some(t => t.micOpenAtStart) ? 'application' : 'tool',
    detail: spoken.length ? spoken.map(t => `turn ${t.turn}: ${((t.micTrackVoicedMs ?? 0) / 1000).toFixed(1)} s voiced`).join('; ') + (short.length ? ` — turn(s) ${short.map(t => t.turn).join(', ')} barely reached the app track` : '') : 'no candidate speech' })
  checks.push({ name: 'natural_completion', status: stop?.kind === 'natural' || stop?.kind === 'plan_complete' ? 'passed' : 'failed', required: false, basis: 'browser', area: 'live-audio',
    detail: stop ? `${stop.kind}: ${stop.detail}` : 'conversation did not run' })
  return checks
}
