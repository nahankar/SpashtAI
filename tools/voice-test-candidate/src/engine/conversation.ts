import type { Utterance } from '../browser/bridge.js'
import type { Decision } from '../candidate/brain.js'

export interface EnginePorts {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
  transcribe(u: Utterance, signal?: AbortSignal): Promise<string>
  decide(heard: string, signal?: AbortSignal): Promise<Decision>
  commit(heard: string, spoken: string | null): void
  /** Resolves once the first chunk of the reply is ready; the rest keeps synthesizing while it plays. */
  synthesize(text: string, turn: number, signal?: AbortSignal): Promise<{ audio: AsyncIterable<Buffer>; meta: Promise<Record<string, unknown>> }>
  play(id: string, audio: AsyncIterable<Buffer>): Promise<{ startEpoch: number; micOpenAtStart: boolean; finished: Promise<{ stopped: boolean; epochMs: number; underruns?: number }> }>
  stop(id: string): Promise<void>
  /** Whether the application currently has its microphone track enabled (the "listening" indicator). */
  micOpen(): Promise<boolean>
  appSpeaking(): boolean
  /** Adapter-level completion signal observed in the UI (e.g. "Practice time is up"). */
  completion(): Promise<{ complete: boolean; reason?: string } | null>
  log(kind: string, data?: Record<string, unknown>, epochMs?: number): void
}

export interface EngineOptions {
  /** Silence after SpashtAI's last utterance before the candidate treats the turn as finished. */
  replyAfterSilenceMs: number
  thinkDelayMs: () => number
  /** How long to wait for the app to open its microphone before giving up on a reply. */
  micGateMs: number
  /** SpashtAI speech overlapping candidate playback for this long makes the candidate stop (yield). */
  yieldAfterMs: number
  maxTurns: number
  maxDurationMs: number
  /** No SpashtAI speech for this long while the candidate is waiting ends the run as stalled. */
  appSilenceTimeoutMs: number
  silentTurns: number[]
  silenceMs: number
  completionPollMs: number
}

export type StopReason =
  | { kind: 'natural'; detail: string }
  | { kind: 'max_turns'; detail: string }
  | { kind: 'max_duration'; detail: string }
  | { kind: 'app_silent'; detail: string }
  | { kind: 'error'; detail: string }
  | { kind: 'cancelled'; detail: string }

export interface TurnRecord {
  turn: number
  heard: string
  heardUtterances: string[]
  appSpeechEndEpoch: number
  decision: Decision['action'] | 'error'
  sessionCompleteHint: boolean
  spoken: string | null
  suppressed?: string
  candidateStartEpoch?: number
  candidateEndEpoch?: number
  stoppedEarly?: boolean
  micOpenAtStart?: boolean
  responseGapMs?: number
  nextAppSpeechStartEpoch?: number
  appResponseLatencyMs?: number
  generationMs?: number
  /** Time until the first playable chunk of the reply was ready. */
  synthesisMs?: number
  deliberateSilenceMs?: number
  appSpokeDuringSilence?: boolean
  audioMeta?: Record<string, unknown>
}

interface Pending { u: Utterance; text: Promise<string>; settled: boolean; value: string }

class Cancelled extends Error {}

export class ConversationEngine {
  readonly turns: TurnRecord[] = []
  readonly transcripts: Array<{ id: string; startEpoch: number; endEpoch: number; text: string; error?: string }> = []
  private pending: Pending[] = []
  private seen = new Set<string>()
  private lastAppSpeechEnd = 0
  private lastAppSpeechStart = 0
  private lastActivity = 0
  private speechStarts = 0
  private turnAbort: AbortController | null = null
  private playingId: string | null = null
  private stopReason: StopReason | null = null
  private candidateTurns = 0
  private startedAt = 0
  private readonly runAbort = new AbortController()
  private readonly silenceDone = new Set<number>()
  private readonly late: Promise<string>[] = []
  candidateThinksComplete = false

  constructor(private readonly ports: EnginePorts, private readonly opts: EngineOptions) {}

  get spokenTurns(): number { return this.candidateTurns }

  onSpeechStart(epochMs: number): void {
    this.speechStarts++
    this.lastAppSpeechStart = epochMs
    this.lastActivity = Math.max(this.lastActivity, epochMs)
    const last = this.turns.at(-1)
    if (last?.candidateEndEpoch && !last.nextAppSpeechStartEpoch && epochMs >= last.candidateEndEpoch) {
      last.nextAppSpeechStartEpoch = epochMs
      last.appResponseLatencyMs = Math.round(epochMs - last.candidateEndEpoch)
    }
    // New speech invalidates a reply still being prepared for the previous turn.
    if (this.turnAbort && !this.playingId) this.turnAbort.abort(new Cancelled('app resumed speaking'))
  }

  onUtterance(u: Utterance): void {
    if (this.seen.has(u.id)) { this.ports.log('duplicate_utterance_ignored', { id: u.id }); return }
    this.seen.add(u.id)
    this.lastAppSpeechEnd = Math.max(this.lastAppSpeechEnd, u.endEpoch)
    this.lastActivity = Math.max(this.lastActivity, u.endEpoch)
    const entry: Pending = { u, settled: false, value: '', text: Promise.resolve('') }
    // Utterances after the stop (e.g. a closing remark) are still recognized for the evidence, not answered.
    const late = this.stopReason !== null
    entry.text = this.ports.transcribe(u, late ? undefined : this.runAbort.signal).then(text => {
      entry.settled = true; entry.value = text
      this.transcripts.push({ id: u.id, startEpoch: u.startEpoch, endEpoch: u.endEpoch, text })
      this.ports.log('app_utterance_recognized', { id: u.id, text, ...(late ? { afterConversationStopped: true } : {}) })
      return text
    }, error => {
      entry.settled = true; entry.value = ''
      const message = error instanceof Error ? error.message : String(error)
      this.transcripts.push({ id: u.id, startEpoch: u.startEpoch, endEpoch: u.endEpoch, text: '', error: message })
      this.ports.log('app_utterance_recognition_failed', { id: u.id, error: message })
      return ''
    })
    if (late) this.late.push(entry.text)
    else this.pending.push(entry)
  }

  /** Waits (bounded) for recognition of utterances that arrived after the conversation stopped. */
  async settleLate(timeoutMs: number): Promise<void> {
    await Promise.race([Promise.allSettled(this.late), new Promise(r => setTimeout(r, timeoutMs))])
  }

  stop(reason: StopReason): void {
    if (!this.stopReason) this.stopReason = reason
    this.turnAbort?.abort(new Cancelled(reason.kind))
    this.runAbort.abort(new Cancelled(reason.kind))
    if (this.playingId) void this.ports.stop(this.playingId)
  }

  async run(): Promise<StopReason> {
    this.startedAt = this.ports.now()
    this.lastActivity = this.startedAt
    let lastPoll = 0
    while (!this.stopReason) {
      const now = this.ports.now()
      if (now - this.startedAt >= this.opts.maxDurationMs) { this.stop({ kind: 'max_duration', detail: `reached ${Math.round(this.opts.maxDurationMs / 1000)} s limit` }); break }
      if (now - lastPoll >= this.opts.completionPollMs) {
        lastPoll = now
        const done = await this.ports.completion().catch(() => null)
        if (done?.complete) { this.stop({ kind: 'natural', detail: done.reason ?? 'application signalled completion' }); break }
      }
      if (this.candidateTurns >= this.opts.maxTurns) { this.stop({ kind: 'max_turns', detail: `candidate spoke ${this.candidateTurns} times (limit ${this.opts.maxTurns})` }); break }
      if (this.readyForTurn(now)) {
        try { await this.handleTurn() } catch (error) {
          if (!(error instanceof Cancelled) && !this.stopReason) {
            this.ports.log('turn_failed', { error: error instanceof Error ? error.message : String(error) })
            this.stop({ kind: 'error', detail: error instanceof Error ? error.message : String(error) })
          }
        }
        continue
      }
      if (!this.pending.length && !this.ports.appSpeaking() && now - this.lastActivity >= this.opts.appSilenceTimeoutMs) {
        this.stop({ kind: 'app_silent', detail: `no SpashtAI speech for ${Math.round(this.opts.appSilenceTimeoutMs / 1000)} s while waiting` })
        break
      }
      await this.ports.sleep(100).catch(() => undefined)
    }
    if (this.playingId) await this.ports.stop(this.playingId)
    return this.stopReason!
  }

  private readyForTurn(now: number): boolean {
    if (!this.pending.length || this.ports.appSpeaking()) return false
    if (now - this.lastAppSpeechEnd < this.opts.replyAfterSilenceMs) return false
    return this.pending.every(p => p.settled)
  }

  private async handleTurn(): Promise<void> {
    const segments = this.pending
    this.pending = []
    const heardParts = segments.map(s => s.value).filter(Boolean)
    const heard = heardParts.join(' ').trim()
    const appSpeechEnd = Math.max(...segments.map(s => s.u.endEpoch))
    const startsBefore = this.speechStarts
    if (!heard) { this.ports.log('turn_skipped_no_recognized_speech', { utterances: segments.map(s => s.u.id) }); return }
    const record: TurnRecord = { turn: this.turns.length + 1, heard, heardUtterances: segments.map(s => s.u.id), appSpeechEndEpoch: appSpeechEnd,
      decision: 'error', sessionCompleteHint: false, spoken: null }
    const abort = new AbortController()
    this.turnAbort = abort
    const signal = AbortSignal.any([abort.signal, this.runAbort.signal])
    const requeue = (why: string) => {
      // Keep what was heard: the next turn answers it together with whatever SpashtAI added.
      this.pending = [...segments, ...this.pending]
      this.ports.log('reply_cancelled', { turn: record.turn, why })
    }
    try {
      const g0 = this.ports.now()
      const decision = await this.ports.decide(heard, signal)
      record.generationMs = this.ports.now() - g0
      record.decision = decision.action
      record.sessionCompleteHint = decision.sessionComplete
      if (decision.sessionComplete) this.candidateThinksComplete = true
      this.ports.log('candidate_decision', { turn: record.turn, heard, action: decision.action, text: decision.text, sessionComplete: decision.sessionComplete, note: decision.note, generationMs: record.generationMs })
      if (decision.action === 'wait') { this.ports.commit(heard, null); this.turns.push(record); return }

      const nextTurn = this.candidateTurns + 1
      if (this.opts.silentTurns.includes(nextTurn) && this.opts.silenceMs > 0 && !this.silenceDone.has(nextTurn)) {
        this.silenceDone.add(nextTurn)
        const startsAtSilence = this.speechStarts
        this.ports.log('deliberate_silence_start', { turn: record.turn, ms: this.opts.silenceMs })
        await this.ports.sleep(this.opts.silenceMs, this.runAbort.signal)
        record.deliberateSilenceMs = this.opts.silenceMs
        record.appSpokeDuringSilence = this.speechStarts > startsAtSilence
        this.ports.log('deliberate_silence_end', { turn: record.turn, appSpokeDuringSilence: record.appSpokeDuringSilence })
        if (record.appSpokeDuringSilence) {
          // SpashtAI re-prompted or moved on; answer in the light of what it said.
          await this.waitForQuiet()
          this.ports.commit(heard, null)
          record.suppressed = 'app spoke during deliberate silence; reply regenerated with the new prompt'
          this.turns.push(record)
          return
        }
      }

      const s0 = this.ports.now()
      const audio = await this.ports.synthesize(decision.text, record.turn, signal)
      record.synthesisMs = this.ports.now() - s0
      const target = appSpeechEnd + this.opts.thinkDelayMs()
      const wait = target - this.ports.now()
      if (wait > 0) await this.ports.sleep(wait, signal)
      if (this.speechStarts !== startsBefore || this.ports.appSpeaking()) throw new Cancelled('app resumed speaking before the reply')

      const gateStart = this.ports.now()
      let open = await this.ports.micOpen()
      while (!open && this.ports.now() - gateStart < this.opts.micGateMs) {
        await this.ports.sleep(200, signal)
        if (this.speechStarts !== startsBefore) throw new Cancelled('app resumed speaking while the microphone was closed')
        open = await this.ports.micOpen()
      }
      if (!open) {
        record.suppressed = `application microphone stayed closed for ${this.opts.micGateMs} ms`
        this.ports.log('reply_suppressed_mic_closed', { turn: record.turn, waitedMs: this.opts.micGateMs })
        this.ports.commit(heard, null)
        this.turns.push(record)
        return
      }

      const id = `candidate-${String(nextTurn).padStart(3, '0')}`
      this.playingId = id
      this.candidateTurns = nextTurn
      const played = await this.ports.play(id, audio.audio)
      record.candidateStartEpoch = played.startEpoch
      record.micOpenAtStart = played.micOpenAtStart
      record.responseGapMs = Math.round(played.startEpoch - appSpeechEnd)
      record.spoken = decision.text
      this.turns.push(record)
      this.ports.log('candidate_speech_start', { turn: record.turn, id, text: decision.text, responseGapMs: record.responseGapMs, micOpenAtStart: played.micOpenAtStart }, played.startEpoch)
      const overlapStart = this.speechStarts
      const yieldWatch = (async () => {
        let overlapSince = 0
        while (this.playingId === id) {
          if (this.ports.appSpeaking() && this.speechStarts > overlapStart) {
            overlapSince ||= this.ports.now()
            if (this.ports.now() - overlapSince >= this.opts.yieldAfterMs) {
              this.ports.log('candidate_yielded_to_app', { turn: record.turn })
              await this.ports.stop(id)
              // Stop synthesizing the rest of the reply too.
              abort.abort(new Cancelled('yielded to SpashtAI'))
              return
            }
          } else overlapSince = 0
          await this.ports.sleep(100).catch(() => undefined)
        }
      })()
      const finished = await played.finished
      this.playingId = null
      await yieldWatch
      record.candidateEndEpoch = finished.epochMs
      record.stoppedEarly = finished.stopped
      record.audioMeta = { ...(await audio.meta.catch(() => ({}))), underruns: finished.underruns ?? 0 }
      this.lastActivity = Math.max(this.lastActivity, finished.epochMs)
      this.ports.log('candidate_speech_end', { turn: record.turn, id, stoppedEarly: finished.stopped }, finished.epochMs)
      this.ports.commit(heard, finished.stopped ? `${decision.text} [cut off]` : decision.text)
    } catch (error) {
      this.playingId = null
      if (error instanceof Cancelled || signal.aborted) {
        if (!this.stopReason) requeue(error instanceof Error ? error.message : 'cancelled')
        return
      }
      throw error
    } finally {
      if (this.turnAbort === abort) this.turnAbort = null
    }
  }

  private async waitForQuiet(): Promise<void> {
    while (!this.stopReason && (this.ports.appSpeaking() || this.ports.now() - this.lastAppSpeechEnd < this.opts.replyAfterSilenceMs)) {
      await this.ports.sleep(100).catch(() => undefined)
    }
  }
}
