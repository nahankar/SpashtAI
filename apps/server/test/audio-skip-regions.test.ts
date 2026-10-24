import { describe, expect, it } from 'vitest'
import { buildSkipIntervalsFromTurnWords } from '../src/lib/audioAlignment'

describe('verified recording skip regions', () => {
  it('retains every spoken phrase around a long silence', () => {
    const words = [
      { start: 15, end: 16, timingOrigin: 'forced_alignment' },
      { start: 16, end: 17, timingOrigin: 'forced_alignment' },
      { start: 24, end: 25, timingOrigin: 'forced_alignment' },
    ]
    expect(buildSkipIntervalsFromTurnWords([{ role: 'user', words }]))
      .toEqual([{ start: 15, end: 17 }, { start: 24, end: 25 }])
  })
})
