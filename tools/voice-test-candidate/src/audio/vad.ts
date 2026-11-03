/**
 * Streaming energy voice-activity detector for incoming application audio.
 *
 * Boundaries are defined on the audio timeline (sample indices), not wall-clock callback times:
 * - speech starts at the first frame of a run of `minSpeechMs` frames above `thresholdDb`;
 * - speech ends at the end of the last voiced frame once `endSilenceMs` of unvoiced frames follow it.
 * Short dips inside a sentence therefore do not split an utterance.
 */
export interface VadOptions {
  sampleRate: number
  frameMs?: number
  thresholdDb?: number
  minSpeechMs?: number
  endSilenceMs?: number
}

export type VadEvent =
  | { type: 'start'; startSample: number }
  | { type: 'end'; startSample: number; endSample: number }

export class EnergyVad {
  readonly frameSize: number
  private readonly threshold: number
  private readonly minSpeechFrames: number
  private readonly endSilenceFrames: number
  private pending = new Int16Array(0)
  private consumed = 0
  private voicedRun = 0
  private voicedRunStart = 0
  private silentRun = 0
  private inSpeech = false
  private speechStart = 0
  private lastVoicedEnd = 0

  constructor(private readonly opts: VadOptions) {
    const frameMs = opts.frameMs ?? 20
    this.frameSize = Math.round((frameMs / 1000) * opts.sampleRate)
    this.threshold = opts.thresholdDb ?? -48
    this.minSpeechFrames = Math.max(1, Math.round((opts.minSpeechMs ?? 120) / frameMs))
    this.endSilenceFrames = Math.max(1, Math.round((opts.endSilenceMs ?? 900) / frameMs))
  }

  get speaking(): boolean { return this.inSpeech }
  /** Sample index of the next unprocessed sample (i.e. total samples processed). */
  get position(): number { return this.consumed }

  push(samples: Int16Array): VadEvent[] {
    const events: VadEvent[] = []
    const buf = new Int16Array(this.pending.length + samples.length)
    buf.set(this.pending); buf.set(samples, this.pending.length)
    let i = 0
    for (; i + this.frameSize <= buf.length; i += this.frameSize) {
      const frameStart = this.consumed
      let sum = 0
      for (let j = i; j < i + this.frameSize; j++) { const v = buf[j] / 32768; sum += v * v }
      const db = sum > 0 ? 10 * Math.log10(sum / this.frameSize) : -Infinity
      const voiced = db > this.threshold
      this.consumed += this.frameSize
      if (voiced) {
        if (this.voicedRun === 0) this.voicedRunStart = frameStart
        this.voicedRun++
        this.silentRun = 0
        this.lastVoicedEnd = this.consumed
        if (!this.inSpeech && this.voicedRun >= this.minSpeechFrames) {
          this.inSpeech = true
          this.speechStart = this.voicedRunStart
          events.push({ type: 'start', startSample: this.speechStart })
        }
      } else {
        this.voicedRun = 0
        if (this.inSpeech) {
          this.silentRun++
          if (this.silentRun >= this.endSilenceFrames) {
            this.inSpeech = false
            events.push({ type: 'end', startSample: this.speechStart, endSample: this.lastVoicedEnd })
            this.silentRun = 0
          }
        }
      }
    }
    this.pending = buf.slice(i)
    return events
  }

  /** Closes an open utterance (e.g. the track ended mid-speech). */
  flush(): VadEvent[] {
    if (!this.inSpeech) return []
    this.inSpeech = false
    return [{ type: 'end', startSample: this.speechStart, endSample: this.lastVoicedEnd }]
  }
}
