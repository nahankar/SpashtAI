import { describe, expect, it } from 'vitest'
import { fallbackSpeechRegions, partialPlaybackEnd, verifiedPlaybackWords, verifiedWordRegions, nextSpeechTime } from './playback-regions'

describe('shared partially aligned Elevate and Interview playback', () => {
  const turns = [
    { role: 'assistant' },
    { role: 'user', audioStart: 5, audioEnd: 12 },
    { role: 'user', audioStart: null, audioEnd: null },
  ]
  it('keeps speech for an unaligned answer instead of skipping to aligned fragments only', () => {
    const waveform = [{ start: 30, end: 38 }, { start: 5, end: 12 }]
    expect(fallbackSpeechRegions(turns, waveform)).toEqual([{ start: 5, end: 12 }, { start: 30, end: 38 }])
    expect(waveform[0].start).toBe(30)
  })
  it('plays all audio when neither word alignment nor measured speech can cover every answer', () => {
    expect(fallbackSpeechRegions(turns, [])).toEqual([])
    expect(partialPlaybackEnd(60, 12, [])).toBe(60)
  })
  it('does not truncate later unaligned speech at the last aligned word', () => {
    expect(partialPlaybackEnd(60, 12, [{ start: 30, end: 38 }])).toBe(38)
    expect(partialPlaybackEnd(35, 12, [{ start: 30, end: 38 }])).toBe(35)
  })
  it('keeps word-based skipping for complete timing and ignores untimed interviewer messages', () => {
    expect(fallbackSpeechRegions(turns.slice(0, 2), [{ start: 5, end: 12 }])).toBeNull()
  })
  it('keeps and highlights verified words on both sides of a long pause', () => {
    const words = [
      { w: 'First', start: 15, end: 16, timingOrigin: 'forced_alignment' },
      { w: 'point', start: 16, end: 17, timingOrigin: 'forced_alignment' },
      { w: 'Next', start: 24, end: 25, timingOrigin: 'forced_alignment' },
    ]
    expect(verifiedPlaybackWords(words)).toHaveLength(3)
    expect(verifiedWordRegions(words)).toEqual([{ start: 15, end: 17 }, { start: 24, end: 25 }])
    expect(nextSpeechTime(18, true, verifiedWordRegions(words)!)).toBe(24)
    expect(nextSpeechTime(24.5, true, verifiedWordRegions(words)!)).toBeNull()
    expect(nextSpeechTime(18, false, verifiedWordRegions(words)!)).toBeNull()
    expect(nextSpeechTime(30, true, verifiedWordRegions(words)!)).toBe('stop')
    expect(verifiedPlaybackWords(words.map(word => ({ ...word, timingOrigin: 'synthetic' })))).toBeNull()
  })
})
