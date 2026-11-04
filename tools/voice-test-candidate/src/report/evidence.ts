import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { redact, redactValue } from '../redact.js'

export interface TimelineEvent {
  /** Wall-clock epoch milliseconds: the shared reference for browser, audio and Node events on this machine. */
  epochMs: number
  /** Milliseconds since the run started. */
  tMs: number
  source: 'tool' | 'browser' | 'audio' | 'candidate' | 'app' | 'verify'
  kind: string
  data?: Record<string, unknown>
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')
  return `${stamp}-${randomBytes(3).toString('hex')}`
}

/** Owns one run's evidence directory. Everything written through it is redacted. */
export class Evidence {
  readonly dir: string
  readonly t0: number
  readonly events: TimelineEvent[] = []
  private readonly timelineFile: string

  constructor(root: string, readonly runId: string, private readonly secrets: string[] = [], t0 = Date.now(), private readonly echo = true) {
    this.dir = join(root, runId)
    this.t0 = t0
    for (const sub of ['audio', 'screenshots', 'browser']) mkdirSync(join(this.dir, sub), { recursive: true, mode: 0o700 })
    this.timelineFile = join(this.dir, 'timeline.jsonl')
    writeFileSync(this.timelineFile, '', { mode: 0o600 })
  }

  rel(epochMs: number): number { return Math.round(epochMs - this.t0) }

  event(source: TimelineEvent['source'], kind: string, data?: Record<string, unknown>, epochMs = Date.now()): TimelineEvent {
    const entry: TimelineEvent = { epochMs, tMs: this.rel(epochMs), source, kind, ...(data ? { data: redactValue(data, this.secrets) } : {}) }
    this.events.push(entry)
    appendFileSync(this.timelineFile, JSON.stringify(entry) + '\n')
    if (this.echo) {
      const summary = data ? ' ' + JSON.stringify(entry.data).slice(0, 220) : ''
      process.stdout.write(`[${(entry.tMs / 1000).toFixed(1).padStart(7)}s] ${source}:${kind}${summary}\n`)
    }
    return entry
  }

  path(...parts: string[]): string { return join(this.dir, ...parts) }

  writeJson(name: string, value: unknown): string {
    const file = this.path(name)
    writeFileSync(file, redact(JSON.stringify(value, null, 2), this.secrets) + '\n')
    return file
  }

  writeText(name: string, text: string): string {
    const file = this.path(name)
    writeFileSync(file, redact(text, this.secrets))
    return file
  }

  writeBinary(name: string, data: Buffer): string {
    const file = this.path(name)
    writeFileSync(file, data)
    return file
  }

  sanitize(text: string): string { return redact(text, this.secrets) }
}
