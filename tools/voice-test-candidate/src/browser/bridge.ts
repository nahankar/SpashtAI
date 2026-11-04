import type { BrowserContext, Page } from 'playwright'
import { encodeWav, int16FromBase64, resample, type Pcm } from '../audio/pcm.js'
import { EnergyVad, type VadOptions } from '../audio/vad.js'
import { instrumentPage, type InjectConfig } from './inject.js'
import type { Evidence } from '../report/evidence.js'

export const ANALYSIS_RATE = 16_000

export interface Utterance {
  id: string
  trackId: string
  startEpoch: number
  endEpoch: number
  pcm: Pcm
}

interface Stream {
  kind: 'incoming' | 'mic'
  trackId: string
  label: string
  /** Epoch of sample 0 of `chunks` at ANALYSIS_RATE. */
  anchorEpoch: number
  chunks: Int16Array[]
  length: number
  carry: Int16Array
  vad?: EnergyVad
  lastEnabled?: boolean
  realigned: number
}

export interface BridgeListener {
  speechStart?(info: { trackId: string; epochMs: number }): void
  utterance?(u: Utterance): void
}

export interface PlayResult { startEpoch: number; durationMs: number; ctxState: string; mic: Array<{ id: string; enabled: boolean; readyState: string; muted: boolean }> }

/** Serializes the instrumentation function; tsx/esbuild may reference a `__name` helper the page lacks. */
export function initScript(cfg: InjectConfig): string {
  return `var __name = (t) => t;\n(${instrumentPage.toString()})(${JSON.stringify(cfg)});`
}

/**
 * Node side of the audio transport. Receives browser PCM, keeps evidence streams on a shared epoch timeline,
 * runs voice-activity detection on SpashtAI's incoming audio, and plays candidate audio into the virtual mic.
 */
export class AudioBridge {
  private streams = new Map<string, Stream>()
  private listeners: BridgeListener[] = []
  private pendingPlays = new Map<string, (r: { stopped: boolean; epochMs: number; underruns: number }) => void>()
  private utteranceCount = 0
  /** Utterances stopped by the candidate (yield/cancel): their remaining chunks must never be sent. */
  private stopped = new Set<string>()
  page: Page | null = null
  readonly pageEvents: Array<Record<string, unknown>> = []

  constructor(private readonly evidence: Evidence, private readonly vadOptions: Omit<VadOptions, 'sampleRate'> = {}) {}

  on(listener: BridgeListener): () => void {
    this.listeners.push(listener)
    return () => { this.listeners = this.listeners.filter(l => l !== listener) }
  }

  async install(context: BrowserContext): Promise<void> {
    await context.exposeBinding('__vtcAudio', (_source, chunk) => this.onChunk(chunk))
    await context.exposeBinding('__vtcEvent', (_source, event) => this.onPageEvent(event))
    await context.addInitScript({ content: initScript({ sampleRate: 48_000, bufferSize: 4096 }) })
  }

  private onPageEvent(event: Record<string, unknown>) {
    this.pageEvents.push(event)
    const { type, epochMs, ...rest } = event as { type: string; epochMs: number; id?: string; stopped?: boolean }
    if (type === 'mic_play_end') {
      const resolve = this.pendingPlays.get(String(rest.id))
      this.pendingPlays.delete(String(rest.id))
      resolve?.({ stopped: Boolean(rest.stopped), epochMs, underruns: Number((rest as { underruns?: number }).underruns ?? 0) })
    }
    this.evidence.event('browser', type, rest, epochMs)
  }

  private onChunk(chunk: { kind: 'incoming' | 'mic'; trackId: string; sampleRate: number; frames: number; epochMs: number; enabled: boolean; b64: string }) {
    const key = `${chunk.kind}:${chunk.trackId}`
    let stream = this.streams.get(key)
    const raw = int16FromBase64(chunk.b64)
    const chunkStartEpoch = chunk.epochMs - (chunk.frames / chunk.sampleRate) * 1000
    if (!stream) {
      const index = [...this.streams.values()].filter(s => s.kind === chunk.kind).length + 1
      stream = { kind: chunk.kind, trackId: chunk.trackId, label: `${chunk.kind}-${index}`, anchorEpoch: chunkStartEpoch, chunks: [], length: 0,
        carry: new Int16Array(0), realigned: 0,
        ...(chunk.kind === 'incoming' ? { vad: new EnergyVad({ sampleRate: ANALYSIS_RATE, ...this.vadOptions }) } : {}) }
      this.streams.set(key, stream)
      this.evidence.event('audio', 'stream_started', { kind: chunk.kind, label: stream.label, sampleRate: chunk.sampleRate })
    }
    // Callback timing jitters by tens of ms; samples are counted continuously unless the audio graph stalled.
    const expectedEpoch = stream.anchorEpoch + (stream.length / ANALYSIS_RATE) * 1000
    const gapMs = chunkStartEpoch - expectedEpoch
    if (gapMs > 500) {
      const fill = new Int16Array(Math.round((gapMs / 1000) * ANALYSIS_RATE))
      const offset = stream.length
      this.append(stream, fill)
      // The VAD's sample counter must advance with the stream, or every later boundary shifts by the gap.
      if (stream.vad) this.runVad(stream, fill)
      stream.realigned++
      this.evidence.event('audio', 'stream_gap_filled', { label: stream.label, gapMs: Math.round(gapMs) })
    }
    if (chunk.kind === 'mic' && stream.lastEnabled !== chunk.enabled) {
      stream.lastEnabled = chunk.enabled
      this.evidence.event('audio', chunk.enabled ? 'app_mic_enabled' : 'app_mic_disabled', { label: stream.label }, chunkStartEpoch)
    }
    const ratio = chunk.sampleRate / ANALYSIS_RATE
    let down: Int16Array
    if (Number.isInteger(ratio)) {
      const joined = new Int16Array(stream.carry.length + raw.length)
      joined.set(stream.carry); joined.set(raw, stream.carry.length)
      const usable = joined.length - (joined.length % ratio)
      down = resample(joined.subarray(0, usable), chunk.sampleRate, ANALYSIS_RATE)
      stream.carry = joined.slice(usable)
    } else down = resample(raw, chunk.sampleRate, ANALYSIS_RATE)
    const offset = stream.length
    this.append(stream, down)
    if (stream.vad) this.runVad(stream, down)
  }

  private append(stream: Stream, samples: Int16Array) {
    stream.chunks.push(samples)
    stream.length += samples.length
  }

  private sampleEpoch(stream: Stream, sample: number) { return stream.anchorEpoch + (sample / ANALYSIS_RATE) * 1000 }

  private runVad(stream: Stream, samples: Int16Array) {
    for (const ev of stream.vad!.push(samples)) {
      if (ev.type === 'start') {
        const epochMs = this.sampleEpoch(stream, ev.startSample)
        this.evidence.event('audio', 'app_speech_start', { label: stream.label }, epochMs)
        for (const l of this.listeners) l.speechStart?.({ trackId: stream.trackId, epochMs })
      } else this.emitUtterance(stream, ev.startSample, ev.endSample)
    }
  }

  private emitUtterance(stream: Stream, startSample: number, endSample: number) {
    const all = this.samples(stream)
    const pad = Math.round(0.15 * ANALYSIS_RATE)
    const pcm: Pcm = { sampleRate: ANALYSIS_RATE, channels: 1, samples: all.slice(Math.max(0, startSample - pad), Math.min(all.length, endSample + pad)) }
    const u: Utterance = { id: `app-${++this.utteranceCount}`, trackId: stream.trackId,
      startEpoch: this.sampleEpoch(stream, startSample), endEpoch: this.sampleEpoch(stream, endSample), pcm }
    this.evidence.writeBinary(`audio/app-utterance-${String(this.utteranceCount).padStart(3, '0')}.wav`, encodeWav(pcm))
    this.evidence.event('audio', 'app_speech_end', { label: stream.label, utterance: u.id, durationMs: Math.round(u.endEpoch - u.startEpoch) }, u.endEpoch)
    for (const l of this.listeners) l.utterance?.(u)
  }

  private samples(stream: Stream): Int16Array {
    if (stream.chunks.length > 1) {
      const joined = new Int16Array(stream.length)
      let o = 0
      for (const c of stream.chunks) { joined.set(c, o); o += c.length }
      stream.chunks = [joined]
    }
    return stream.chunks[0] ?? new Int16Array(0)
  }

  /** True while incoming application audio is currently classified as speech. */
  appSpeaking(): boolean {
    return [...this.streams.values()].some(s => s.vad?.speaking)
  }

  /**
   * Milliseconds of voiced audio (20 ms frames above -48 dBFS) captured on streams of `kind` between two epochs.
   * For `mic` this is what the application's own microphone track carried — silence while the app disabled it.
   */
  voicedMs(kind: 'incoming' | 'mic', startEpoch: number, endEpoch: number, thresholdDb = -48): number {
    const frame = Math.round(0.02 * ANALYSIS_RATE)
    const threshold = Math.pow(10, thresholdDb / 10) * frame
    let voiced = 0
    for (const stream of this.streams.values()) {
      if (stream.kind !== kind) continue
      const samples = this.samples(stream)
      const from = Math.max(0, Math.floor(((startEpoch - stream.anchorEpoch) / 1000) * ANALYSIS_RATE))
      const to = Math.min(samples.length, Math.ceil(((endEpoch - stream.anchorEpoch) / 1000) * ANALYSIS_RATE))
      for (let i = from; i + frame <= to; i += frame) {
        let sum = 0
        for (let j = i; j < i + frame; j++) { const v = samples[j] / 32768; sum += v * v }
        if (sum > threshold) voiced += 20
      }
    }
    return voiced
  }

  /** Epoch of the last voiced frame captured on streams of `kind` (or null). */
  lastVoicedEpoch(kind: 'incoming' | 'mic', thresholdDb = -48): number | null {
    const frame = Math.round(0.02 * ANALYSIS_RATE)
    const threshold = Math.pow(10, thresholdDb / 10) * frame
    let last: number | null = null
    for (const stream of this.streams.values()) {
      if (stream.kind !== kind) continue
      const samples = this.samples(stream)
      for (let i = samples.length - frame; i >= 0; i -= frame) {
        let sum = 0
        for (let j = i; j < i + frame; j++) { const v = samples[j] / 32768; sum += v * v }
        if (sum > threshold) { const at = this.sampleEpoch(stream, i + frame); last = Math.max(last ?? 0, at); break }
      }
    }
    return last
  }

  incomingStreamCount(): number { return [...this.streams.values()].filter(s => s.kind === 'incoming').length }
  micStreamCount(): number { return [...this.streams.values()].filter(s => s.kind === 'mic').length }

  /**
   * Plays one candidate utterance supplied as consecutive WAV chunks: the first chunk starts playback, later
   * chunks are scheduled gap-free behind it (an underrun is counted if synthesis falls behind playback).
   */
  async play(id: string, chunks: AsyncIterable<Buffer> | Buffer): Promise<{ started: PlayResult; finished: Promise<{ stopped: boolean; epochMs: number; underruns: number }> }> {
    if (!this.page) throw new Error('No page attached to the audio bridge')
    const page = this.page
    const finished = new Promise<{ stopped: boolean; epochMs: number; underruns: number }>(resolve => this.pendingPlays.set(id, resolve))
    const iterator = (async function* () { if (Buffer.isBuffer(chunks)) yield chunks; else yield* chunks })()
    const send = (wav: Buffer, last: boolean) =>
      page.evaluate(([pid, b64, isLast]) => (window as any).__vtc.play(pid, b64, isLast), [id, wav.toString('base64'), last] as const) as Promise<PlayResult>
    const first = await iterator.next()
    if (first.done) throw new Error('No audio to play')
    const started = await send(first.value, false)
    void (async () => {
      try {
        for (let next = await iterator.next(); !next.done && !this.stopped.has(id); next = await iterator.next()) await send(next.value, false)
      } finally {
        await iterator.return?.(undefined).catch(() => undefined)
        await page.evaluate(pid => (window as any).__vtc?.close(pid), id).catch(() => undefined)
      }
    })().catch(error => this.evidence.event('tool', 'candidate_audio_stream_error', { id, error: error instanceof Error ? error.message : String(error) }))
    return { started, finished }
  }

  async stop(id?: string): Promise<void> {
    if (id) this.stopped.add(id)
    if (!this.page) return
    await this.page.evaluate(pid => (window as any).__vtc?.stop(pid), id).catch(() => undefined)
  }

  async micState(): Promise<PlayResult['mic']> {
    if (!this.page) return []
    return await this.page.evaluate(() => (window as any).__vtc?.state().mic ?? []).catch(() => [])
  }

  async state(): Promise<unknown> {
    if (!this.page) return null
    return await this.page.evaluate(() => (window as any).__vtc?.state() ?? null).catch(() => null)
  }

  /** Closes open utterances (end of run). */
  flush(): void {
    for (const stream of this.streams.values()) {
      if (!stream.vad) continue
      for (const ev of stream.vad.flush()) if (ev.type === 'end') this.emitUtterance(stream, ev.startSample, ev.endSample)
    }
  }

  /**
   * Writes per-track WAVs and a speaker-labelled stereo file aligned to the run start:
   * left = SpashtAI audio as received by the browser, right = the app's microphone track (candidate).
   */
  writeEvidence(): { files: Array<{ file: string; label: string; kind: string; durationMs: number }>; stereo?: string } {
    const files: Array<{ file: string; label: string; kind: string; durationMs: number }> = []
    const t0 = this.evidence.t0
    let end = 0
    for (const stream of this.streams.values()) {
      const samples = this.samples(stream)
      const name = `audio/${stream.label}.wav`
      this.evidence.writeBinary(name, encodeWav({ sampleRate: ANALYSIS_RATE, channels: 1, samples }))
      files.push({ file: name, label: stream.label, kind: stream.kind, durationMs: Math.round((samples.length / ANALYSIS_RATE) * 1000) })
      end = Math.max(end, Math.round(((stream.anchorEpoch - t0) / 1000) * ANALYSIS_RATE) + samples.length)
    }
    if (!this.streams.size) return { files }
    const stereo = new Int16Array(end * 2)
    for (const stream of this.streams.values()) {
      const samples = this.samples(stream)
      const offset = Math.round(((stream.anchorEpoch - t0) / 1000) * ANALYSIS_RATE)
      const channel = stream.kind === 'incoming' ? 0 : 1
      for (let i = 0; i < samples.length; i++) {
        const at = offset + i
        if (at < 0 || at >= end) continue
        const idx = at * 2 + channel
        stereo[idx] = Math.max(-32768, Math.min(32767, stereo[idx] + samples[i]))
      }
    }
    const stereoFile = 'audio/conversation-stereo-L_spashtai-R_candidate-mic.wav'
    this.evidence.writeBinary(stereoFile, encodeWav({ sampleRate: ANALYSIS_RATE, channels: 2, samples: stereo }))
    return { files, stereo: stereoFile }
  }
}
