import { describe, expect, it } from 'vitest'
import { ConversationEngine, type EngineOptions, type EnginePorts } from '../src/engine/conversation.js'
import type { Utterance } from '../src/browser/bridge.js'
import type { Decision } from '../src/candidate/brain.js'

/** Real timers with short durations: the engine's timing logic runs unmodified, tests stay fast. */
function harness(over: Partial<EngineOptions> = {}, behaviour: { micOpen?: () => boolean; decideMs?: number; playMs?: number; decide?: (h: string) => Decision; complete?: () => boolean } = {}) {
  const texts = new Map<string, string>()
  const log: Array<{ kind: string; data?: Record<string, unknown> }> = []
  const decided: string[] = []
  const played: string[] = []
  const stopped: string[] = []
  let appSpeaking = false
  let n = 0
  const ports: EnginePorts = {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason)
      const t = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
    }),
    transcribe: async u => texts.get(u.id) ?? '',
    decide: async (heard, signal) => {
      decided.push(heard)
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, behaviour.decideMs ?? 10)
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason) }, { once: true })
      })
      return behaviour.decide ? behaviour.decide(heard) : { action: 'answer', text: `answer to: ${heard}`, sessionComplete: false }
    },
    commit: () => undefined,
    synthesize: async () => ({ audio: (async function* () { yield Buffer.alloc(10) })(), meta: Promise.resolve({}) }),
    play: async id => {
      played.push(id)
      let finish!: (v: { stopped: boolean; epochMs: number }) => void
      const finished = new Promise<{ stopped: boolean; epochMs: number }>(r => { finish = r })
      const timer = setTimeout(() => finish({ stopped: false, epochMs: Date.now() }), behaviour.playMs ?? 30)
      active.set(id, () => { clearTimeout(timer); finish({ stopped: true, epochMs: Date.now() }) })
      return { startEpoch: Date.now(), micOpenAtStart: true, finished }
    },
    stop: async id => { stopped.push(id); active.get(id)?.() },
    micOpen: async () => behaviour.micOpen ? behaviour.micOpen() : true,
    appSpeaking: () => appSpeaking,
    completion: async () => ({ complete: behaviour.complete?.() ?? false }),
    log: (kind, data) => { log.push({ kind, data }) },
  }
  const active = new Map<string, () => void>()
  const opts: EngineOptions = { replyAfterSilenceMs: 40, thinkDelayMs: () => 5, micGateMs: 150, yieldAfterMs: 60, maxTurns: 10,
    maxDurationMs: 5000, appSilenceTimeoutMs: 400, silentTurns: [], silenceMs: 0, completionPollMs: 20, ...over }
  const engine = new ConversationEngine(ports, opts)
  /** Simulates SpashtAI speaking `text` for `ms`, emitting VAD start/end like the bridge does. */
  const say = async (text: string, ms = 30) => {
    const id = `app-${++n}`
    texts.set(id, text)
    const start = Date.now()
    appSpeaking = true
    engine.onSpeechStart(start)
    await new Promise(r => setTimeout(r, ms))
    appSpeaking = false
    const u: Utterance = { id, trackId: 't', startEpoch: start, endEpoch: Date.now(), pcm: { sampleRate: 16000, channels: 1, samples: new Int16Array(0) } }
    engine.onUtterance(u)
    return u
  }
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  return { engine, say, wait, log, decided, played, stopped, setSpeaking: (v: boolean) => { appSpeaking = v }, kinds: () => log.map(l => l.kind) }
}

describe('ConversationEngine', () => {
  it('answers a question exactly once and ignores duplicate utterance events', async () => {
    const h = harness({ maxTurns: 1 })
    const run = h.engine.run()
    const u = await h.say('What is a flaky test?')
    h.engine.onUtterance(u)
    const stop = await run
    expect(stop.kind).toBe('max_turns')
    expect(h.decided).toEqual(['What is a flaky test?'])
    expect(h.played).toHaveLength(1)
    expect(h.kinds()).toContain('duplicate_utterance_ignored')
  })

  it('waits for the end-of-turn silence and merges utterances of one turn', async () => {
    const h = harness({ maxTurns: 1, replyAfterSilenceMs: 120 })
    const run = h.engine.run()
    await h.say('Thanks for that answer.')
    await h.wait(30)
    await h.say('Next, how do you test an API?')
    await run
    expect(h.decided).toEqual(['Thanks for that answer. Next, how do you test an API?'])
  })

  it('cancels a reply in preparation when SpashtAI resumes speaking, then answers the combined turn once', async () => {
    const h = harness({ maxTurns: 1 }, { decideMs: 150 })
    const run = h.engine.run()
    await h.say('Tell me about yourself.')
    await h.wait(90)
    await h.say('Focus on your testing experience.')
    await run
    expect(h.kinds()).toContain('reply_cancelled')
    expect(h.played).toHaveLength(1)
    expect(h.decided.at(-1)).toBe('Tell me about yourself. Focus on your testing experience.')
  })

  it('does not speak when the application keeps its microphone closed', async () => {
    const h = harness({ appSilenceTimeoutMs: 300 }, { micOpen: () => false })
    const run = h.engine.run()
    await h.say('Saving your answer.')
    const stop = await run
    expect(h.played).toHaveLength(0)
    expect(h.kinds()).toContain('reply_suppressed_mic_closed')
    expect(stop.kind).toBe('app_silent')
  })

  it('stays silent when the candidate decides no reply is expected', async () => {
    const h = harness({ appSilenceTimeoutMs: 200 }, { decide: () => ({ action: 'wait', text: '', sessionComplete: false }) })
    const run = h.engine.run()
    await h.say('One moment while I prepare the next question.')
    await run
    expect(h.played).toHaveLength(0)
    expect(h.engine.turns[0].decision).toBe('wait')
  })

  it('stops naturally when the adapter reports completion', async () => {
    let done = false
    const h = harness({}, { complete: () => done })
    const run = h.engine.run()
    await h.wait(50)
    done = true
    expect((await run).kind).toBe('natural')
  })

  it('enforces the maximum duration', async () => {
    const h = harness({ maxDurationMs: 150, appSilenceTimeoutMs: 10_000 })
    expect((await h.engine.run()).kind).toBe('max_duration')
  })

  it('stops candidate audio and resolves when cancelled mid-reply', async () => {
    const h = harness({}, { playMs: 2000 })
    const run = h.engine.run()
    await h.say('Describe your last project.')
    await h.wait(150)
    expect(h.played).toHaveLength(1)
    h.engine.stop({ kind: 'cancelled', detail: 'test' })
    const stop = await run
    expect(stop.kind).toBe('cancelled')
    expect(h.stopped).toContain(h.played[0])
  })

  it('yields when SpashtAI talks over the candidate', async () => {
    const h = harness({ maxTurns: 1 }, { playMs: 1500 })
    const run = h.engine.run()
    await h.say('Go ahead.')
    await h.wait(120)
    h.engine.onSpeechStart(Date.now())
    h.setSpeaking(true)
    await run
    h.setSpeaking(false)
    expect(h.kinds()).toContain('candidate_yielded_to_app')
    expect(h.engine.turns[0].stoppedEarly).toBe(true)
  })

  it('keeps a controlled silence before answering and records whether SpashtAI re-prompted', async () => {
    const h = harness({ maxTurns: 1, silentTurns: [1], silenceMs: 200 })
    const run = h.engine.run()
    const u = await h.say('First question: what is regression testing?')
    await run
    const turn = h.engine.turns[0]
    expect(turn.deliberateSilenceMs).toBe(200)
    expect(turn.appSpokeDuringSilence).toBe(false)
    expect(turn.candidateStartEpoch! - u.endEpoch).toBeGreaterThanOrEqual(200)
  })

  it('answers the re-prompt after SpashtAI speaks during a controlled silence, without a second silence', async () => {
    const h = harness({ maxTurns: 1, silentTurns: [1], silenceMs: 250 })
    const run = h.engine.run()
    await h.say('What is regression testing?')
    await h.wait(120)
    await h.say('Take your time. Are you still there?')
    await run
    expect(h.engine.turns[0].appSpokeDuringSilence).toBe(true)
    expect(h.engine.turns[0].spoken).toBeNull()
    expect(h.decided.at(-1)).toBe('Take your time. Are you still there?')
    expect(h.played).toHaveLength(1)
  })
})
