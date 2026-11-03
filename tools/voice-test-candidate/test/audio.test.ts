import { describe, expect, it } from 'vitest'
import { decodeWav, encodeWav, internalPauses, resample, rmsDbfs, silence, concat } from '../src/audio/pcm.js'
import { EnergyVad } from '../src/audio/vad.js'
import { burstFixture } from '../src/diagnose.js'

const tone = (ms: number, sr: number, amp = 8000) => {
  const n = Math.round((ms / 1000) * sr)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.round(amp * Math.sin((2 * Math.PI * 300 * i) / sr))
  return out
}

describe('pcm', () => {
  it('round-trips WAV encoding', () => {
    const pcm = { sampleRate: 16000, channels: 1, samples: tone(100, 16000) }
    const back = decodeWav(encodeWav(pcm))
    expect(back.sampleRate).toBe(16000)
    expect(Array.from(back.samples)).toEqual(Array.from(pcm.samples))
  })

  it('tolerates an unknown data length (streamed WAV)', () => {
    const wav = encodeWav({ sampleRate: 24000, channels: 1, samples: tone(50, 24000) })
    wav.writeUInt32LE(0xffffffff, 40)
    expect(decodeWav(wav).samples.length).toBe(1200)
  })

  it('resamples by duration', () => {
    expect(resample(tone(1000, 48000), 48000, 16000).length).toBe(16000)
    expect(resample(tone(1000, 24000), 24000, 48000).length).toBe(48000)
  })

  it('measures inserted hesitation pauses in the audio itself', () => {
    const sr = 24000
    const pcm = { sampleRate: sr, channels: 1, samples: concat([tone(500, sr), silence(1200, sr), tone(500, sr), silence(300, sr), tone(500, sr)]) }
    const pauses = internalPauses(pcm, { minPauseMs: 400 })
    expect(pauses).toHaveLength(1)
    expect(pauses[0]).toBeGreaterThanOrEqual(1160)
    expect(pauses[0]).toBeLessThanOrEqual(1240)
  })

  it('reports digital silence as -Infinity dBFS', () => {
    expect(rmsDbfs(new Int16Array(100))).toBe(-Infinity)
  })
})

describe('EnergyVad', () => {
  const sr = 16000
  it('emits one utterance per burst when gaps exceed end-silence, with accurate boundaries', () => {
    const vad = new EnergyVad({ sampleRate: sr, endSilenceMs: 600 })
    const { pcm, bursts } = burstFixture({ sampleRate: sr })
    const events = [...vad.push(pcm.samples.subarray(0, 7000)), ...vad.push(pcm.samples.subarray(7000)), ...vad.push(silence(1000, sr))]
    const ends = events.filter(e => e.type === 'end') as Array<{ startSample: number; endSample: number }>
    expect(ends).toHaveLength(bursts.length)
    ends.forEach((e, i) => {
      expect(Math.abs((e.startSample / sr) * 1000 - bursts[i].startMs)).toBeLessThan(60)
      expect(Math.abs((e.endSample / sr) * 1000 - bursts[i].endMs)).toBeLessThan(60)
    })
  })

  it('does not split an utterance on a short dip', () => {
    const vad = new EnergyVad({ sampleRate: sr, endSilenceMs: 900 })
    const events = vad.push(concat([tone(800, sr), silence(500, sr), tone(800, sr), silence(1200, sr)]))
    expect(events.filter(e => e.type === 'start')).toHaveLength(1)
    expect(events.filter(e => e.type === 'end')).toHaveLength(1)
  })

  it('ignores clicks shorter than the minimum speech length', () => {
    const vad = new EnergyVad({ sampleRate: sr, minSpeechMs: 120 })
    expect(vad.push(concat([silence(200, sr), tone(40, sr), silence(1500, sr)]))).toHaveLength(0)
  })

  it('flushes an utterance that is still open', () => {
    const vad = new EnergyVad({ sampleRate: sr })
    vad.push(tone(500, sr))
    expect(vad.speaking).toBe(true)
    expect(vad.flush()).toHaveLength(1)
  })
})
