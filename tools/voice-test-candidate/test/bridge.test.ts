import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AudioBridge, type Utterance } from '../src/browser/bridge.js'
import { Evidence } from '../src/report/evidence.js'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function chunk(samples: Int16Array, epochMsAtEnd: number) {
  const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  return { kind: 'incoming' as const, trackId: 't1', sampleRate: 48_000, frames: samples.length, epochMs: epochMsAtEnd, enabled: true, b64: bytes.toString('base64') }
}
const silence = (ms: number) => new Int16Array(48 * ms)
const tone = (ms: number) => { const s = new Int16Array(48 * ms); for (let i = 0; i < s.length; i++) s[i] = Math.round(8000 * Math.sin((2 * Math.PI * 300 * i) / 48_000)); return s }

describe('AudioBridge timeline', () => {
  it('keeps utterance boundaries aligned after a capture gap is filled', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vtc-bridge-'))
    dirs.push(dir)
    const evidence = new Evidence(dir, 'r', [], 0, false)
    const bridge = new AudioBridge(evidence, { endSilenceMs: 300 })
    const heard: Utterance[] = []
    bridge.on({ utterance: u => heard.push(u) })
    const feed = (bridge as unknown as { onChunk: (c: ReturnType<typeof chunk>) => void }).onChunk.bind(bridge)
    feed(chunk(silence(500), 1000))        // samples cover epoch 500–1000
    feed(chunk(silence(500), 3500))        // 2 s callback gap: covers 3000–3500
    feed(chunk(tone(1000), 4500))          // tone 3500–4500
    feed(chunk(silence(600), 5100))
    expect(heard).toHaveLength(1)
    expect(Math.abs(heard[0].startEpoch - 3500)).toBeLessThan(40)
    expect(Math.abs(heard[0].endEpoch - 4500)).toBeLessThan(40)
  })
})
