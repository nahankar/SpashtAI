import { concat, decodeWav, encodeWav, internalPauses, resample, silence, type Pcm } from '../audio/pcm.js'
import type { TextToSpeech } from '../providers/index.js'
import { between, type Scenario } from './scenarios.js'

export interface SynthesizedReply {
  wav: Buffer
  pcm: Pcm
  pieces: string[]
  /** Silence deliberately inserted at hesitation markers (ms). */
  insertedPausesMs: number[]
  /** Pauses measured in the final audio (ms, >= 400 ms), so reports describe what the audio really contains. */
  measuredPausesMs: number[]
}

/** Sentence-sized speech pieces, with deliberate pauses between hesitation segments when the scenario asks for them. */
export type PlanItem = { say: string } | { pause: true }

export function planSpeech(text: string, withPauses: boolean, minChars = 60): PlanItem[] {
  const segments = withPauses
    ? text.split(/\s*(?:\.{3,}|…)\s*/).map(p => p.trim()).filter(p => /[A-Za-z]/.test(p))
    : [text.replace(/\.{3,}|…/g, ',').trim()]
  const plan: PlanItem[] = []
  segments.forEach((segment, i) => {
    if (i > 0) plan.push({ pause: true })
    let current = ''
    for (const sentence of segment.split(/(?<=[.!?])\s+/)) {
      current = current ? `${current} ${sentence}` : sentence
      if (current.length >= minChars) { plan.push({ say: current }); current = '' }
    }
    if (current) plan.push({ say: current })
  })
  return plan
}

/** Hesitation segments only (no sentence chunking). */
export function splitPieces(text: string, withPauses: boolean): string[] {
  return planSpeech(text, withPauses, Number.MAX_SAFE_INTEGER).flatMap(p => ('say' in p ? [p.say] : []))
}

export interface SpeechStream {
  chunks: AsyncIterable<Buffer>
  /** The complete reply (for evidence), once every chunk has been synthesized. */
  done: Promise<SynthesizedReply>
}

/**
 * Synthesizes a reply sentence by sentence so playback can begin as soon as the first chunk exists. Chunks are
 * produced in order; deliberate hesitation pauses are real silence chunks.
 */
export function streamReply(tts: TextToSpeech, text: string, scenario: Scenario, rand: () => number, signal?: AbortSignal): SpeechStream {
  const plan = planSpeech(text, Boolean(scenario.pauseMs))
  const pieces = plan.flatMap(p => ('say' in p ? [p.say] : []))
  const parts: Int16Array[] = []
  const inserted: number[] = []
  let rate = 0
  let resolveDone!: (r: SynthesizedReply) => void
  let rejectDone!: (e: unknown) => void
  const done = new Promise<SynthesizedReply>((res, rej) => { resolveDone = res; rejectDone = rej })
  done.catch(() => undefined)
  async function* generate(): AsyncGenerator<Buffer> {
    try {
      for (const item of plan) {
        if (signal?.aborted) throw signal.reason
        let samples: Int16Array
        if ('pause' in item) {
          const ms = between(rand, scenario.pauseMs!)
          inserted.push(ms)
          samples = silence(ms, rate || 24_000)
        } else {
          const pcm = decodeWav(await tts.synthesize(item.say, signal), { mono: true })
          rate ||= pcm.sampleRate
          samples = resample(pcm.samples, pcm.sampleRate, rate)
        }
        parts.push(samples)
        yield encodeWav({ sampleRate: rate || 24_000, channels: 1, samples })
      }
      const pcm: Pcm = { sampleRate: rate || 24_000, channels: 1, samples: concat(parts) }
      resolveDone({ wav: encodeWav(pcm), pcm, pieces, insertedPausesMs: inserted, measuredPausesMs: internalPauses(pcm, { minPauseMs: 400 }) })
    } catch (error) {
      rejectDone(error)
      throw error
    }
  }
  return { chunks: generate(), done }
}
