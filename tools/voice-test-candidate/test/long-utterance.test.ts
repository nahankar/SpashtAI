import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioBridge, type Utterance } from '../src/browser/bridge.js'
import { recognitionWindows, transcribeUtterance } from '../src/audio/recognition.js'
import { ConversationEngine } from '../src/engine/conversation.js'
import { Evidence } from '../src/report/evidence.js'
import type { Pcm } from '../src/audio/pcm.js'

/**
 * Regression for run 20261104-063150-035fe5 (Elevate, session_1793773911299_ddqcapklx).
 *
 * Observed: the coach's warm-up instruction ("… Here's your topic: blockchain technology. Let's see how you do.")
 * contained only 160–600 ms pauses, so the VAD correctly produced ONE 21.4 s utterance (21.68 s with padding).
 * The local recognizer, given that whole window, deterministically returned "… Here's your topic. Let's see." —
 * everything after ~19 s except two words was lost — while ≤ 12 s windows of the same audio returned every word.
 * The candidate, hearing no topic, waited; the coach waited for the learner; the run stalled.
 *
 * Fixture: 13 synthetic bursts on the observed timeline (speech/pause boundaries measured from the clip). Each
 * burst has a distinct amplitude so the fake recognizer can name the bursts a payload contains ("w0" … "w12").
 * The fake reproduces the observed model failure: for a payload longer than 20 s it omits bursts after 19 s.
 */
const SR = 48_000
const BURSTS: Array<[number, number]> = [
  [0.14, 0.84], [1.20, 1.62], [1.94, 3.36], [3.52, 6.24], [6.52, 8.44], [8.60, 9.70], [9.92, 11.52],
  [11.78, 14.12], [14.28, 16.44], [16.62, 17.02], [17.62, 18.46], [19.06, 20.34], [20.52, 21.53],
]
const amplitude = (i: number) => 2000 + 1400 * i
// w11 = "blockchain technology" (the topic), w12 = "Let's see how you do".
const TOPIC = 'w11'

function observedInstruction(): Int16Array {
  const out = new Int16Array(Math.round(22.0 * SR))
  BURSTS.forEach(([a, b], i) => {
    for (let n = Math.round(a * SR); n < Math.round(b * SR); n++) out[n] = Math.round(amplitude(i) * Math.sin((2 * Math.PI * 220 * n) / SR))
  })
  return out
}

/** Names the bursts present in a payload by their amplitude; drops late speech on long windows, as observed. */
function observedRecognizer(payloads: number[]) {
  return {
    async transcribe(pcm: Pcm): Promise<string> {
      const seconds = pcm.samples.length / pcm.sampleRate
      payloads.push(seconds)
      const frame = Math.round(0.02 * pcm.sampleRate)
      const regions: Array<{ start: number; sum: number; n: number; silent: number }> = []
      let open: (typeof regions)[number] | null = null
      for (let i = 0; i + frame <= pcm.samples.length; i += frame) {
        let sum = 0
        for (let j = i; j < i + frame; j++) sum += pcm.samples[j] * pcm.samples[j]
        const loud = Math.sqrt(sum / frame) > 500
        if (loud) {
          if (!open) { open = { start: i / pcm.sampleRate, sum: 0, n: 0, silent: 0 }; regions.push(open) }
          open.sum += sum; open.n += frame; open.silent = 0
        } else if (open && ++open.silent * 20 >= 100) open = null
      }
      return regions
        .filter(r => !(seconds > 20 && r.start >= 19))
        .map(r => `w${Math.round((Math.sqrt(r.sum / r.n) * Math.SQRT2 - 2000) / 1400)}`).join(' ')
    },
  }
}

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** Streams the fixture through the real capture path (48 kHz, 4096-frame callbacks) and returns VAD utterances. */
function captureObservedInstruction(): Utterance[] {
  const dir = mkdtempSync(join(tmpdir(), 'vtc-long-'))
  dirs.push(dir)
  const bridge = new AudioBridge(new Evidence(dir, 'r', [], 0, false), { endSilenceMs: 900, thresholdDb: -48, minSpeechMs: 120 })
  const utterances: Utterance[] = []
  bridge.on({ utterance: u => utterances.push(u) })
  const feed = (bridge as unknown as { onChunk: (c: unknown) => void }).onChunk.bind(bridge)
  const audio = observedInstruction()
  const tail = new Int16Array(2 * SR)
  const all = new Int16Array(audio.length + tail.length)
  all.set(audio)
  for (let i = 0, epoch = 1000; i < all.length; i += 4096) {
    const chunk = all.subarray(i, Math.min(all.length, i + 4096))
    epoch += (chunk.length / SR) * 1000
    feed({ kind: 'incoming', trackId: 't', sampleRate: SR, frames: chunk.length, epochMs: epoch, enabled: true,
      b64: Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('base64') })
  }
  return utterances
}

describe('long SpashtAI utterances are heard completely (run 20261104-063150-035fe5)', () => {
  it('keeps the observed instruction as one utterance — segmentation is not the defect', () => {
    const utterances = captureObservedInstruction()
    expect(utterances).toHaveLength(1)
    expect(utterances[0].endEpoch - utterances[0].startEpoch).toBeGreaterThan(21_000)
  })

  it('recognizes the topic at the end of a 21 s instruction', async () => {
    const [utterance] = captureObservedInstruction()
    const payloads: number[] = []
    const { text } = await transcribeUtterance(observedRecognizer(payloads), utterance.pcm)
    expect(text.split(' ')).toEqual(Array.from({ length: 13 }, (_, i) => `w${i}`))
    expect(text).toContain(TOPIC)
    expect(Math.max(...payloads)).toBeLessThanOrEqual(12.5)
  })

  it('therefore answers instead of waiting, through the conversation engine', async () => {
    const [utterance] = captureObservedInstruction()
    const decided: string[] = []
    const played: string[] = []
    const engine = new ConversationEngine({
      now: () => Date.now(),
      sleep: ms => new Promise(r => setTimeout(r, Math.min(ms, 20))),
      transcribe: async u => (await transcribeUtterance(observedRecognizer([]), u.pcm)).text,
      // As in the failed run: no topic heard → the candidate waits; topic heard → it answers.
      decide: async heard => { decided.push(heard); return heard.includes(TOPIC) ? { action: 'answer', text: 'explanation', sessionComplete: false } : { action: 'wait', text: '', sessionComplete: false } },
      commit: () => undefined,
      synthesize: async () => ({ audio: (async function* () { yield Buffer.alloc(4) })(), meta: Promise.resolve({}) }),
      play: async id => { played.push(id); return { startEpoch: Date.now(), micOpenAtStart: true, finished: Promise.resolve({ stopped: false, epochMs: Date.now() }) } },
      stop: async () => undefined,
      micOpen: async () => true,
      appSpeaking: () => false,
      completion: async () => ({ complete: false }),
      log: () => undefined,
    }, { replyAfterSilenceMs: 0, thinkDelayMs: () => 0, micGateMs: 100, yieldAfterMs: 1000, maxTurns: 1, maxDurationMs: 5000,
      appSilenceTimeoutMs: 2000, silentTurns: [], silenceMs: 0, completionPollMs: 50 })
    const run = engine.run()
    engine.onUtterance({ ...utterance, endEpoch: Date.now() - 2000, startEpoch: Date.now() - 23_000 })
    const stop = await run
    expect(decided[0]).toContain(TOPIC)
    expect(played).toHaveLength(1)
    expect(stop.kind).toBe('max_turns')
  })
})

describe('recognition windows', () => {
  const tone = (sec: number, sr = 16_000) => { const s = new Int16Array(Math.round(sec * sr)); for (let i = 0; i < s.length; i++) s[i] = Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / sr)); return s }
  const pcm = (parts: Int16Array[]): Pcm => { const n = parts.reduce((a, p) => a + p.length, 0); const out = new Int16Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length } return { sampleRate: 16_000, channels: 1, samples: out } }
  it('sends ordinary utterances whole (normal turn-taking unchanged)', async () => {
    const short = pcm([tone(9.5)])
    expect(recognitionWindows(short)).toEqual([{ startMs: 0, endMs: 9500 }])
    const calls: number[] = []
    await transcribeUtterance({ transcribe: async p => { calls.push(p.samples.length); return 'x' } }, short)
    expect(calls).toEqual([short.samples.length])
  })
  it('splits long speech only inside pauses and bounds every window', () => {
    const p = pcm([tone(7), new Int16Array(0.4 * 16_000), tone(6), new Int16Array(0.3 * 16_000), tone(9)])
    const w = recognitionWindows(p)
    expect(w.length).toBeGreaterThan(1)
    for (const x of w) expect(x.endMs - x.startMs).toBeLessThanOrEqual(12_000)
    expect(w[0].endMs).toBeGreaterThan(7000); expect(w[0].endMs).toBeLessThan(7400)
    expect(w.at(-1)!.endMs).toBe(Math.round((p.samples.length / 16_000) * 1000))
    for (let i = 1; i < w.length; i++) expect(w[i].startMs).toBe(w[i - 1].endMs)
  })
  it('still bounds continuous speech with no pause', () => {
    const w = recognitionWindows(pcm([tone(30)]))
    for (const x of w) expect(x.endMs - x.startMs).toBeLessThanOrEqual(12_000)
    expect(w.at(-1)!.endMs).toBe(30_000)
  })
})
