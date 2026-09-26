import { describe, expect, it } from 'vitest'
import { parsePlainText, parseSRT, parseVTT } from '../src/lib/transcript-parser'

describe('Replay transcript speaker parsing', () => {
  it('does not treat timestamp prefixes as speaker labels', () => {
    const plain = parsePlainText('00: This should remain transcript text.')
    expect(plain.segments[0]).toMatchObject({ speaker: 'Speaker', text: '00: This should remain transcript text.' })

    const srt = parseSRT([
      '1',
      '00:00:01,000 --> 00:00:03,000',
      '00: This should not become a speaker',
    ].join('\n'))
    expect(srt.segments[0]).toMatchObject({ speaker: 'Speaker', text: '00: This should not become a speaker' })
  })

  it('does not treat metadata labels as speakers in VTT/plain text', () => {
    const vtt = parseVTT([
      'WEBVTT',
      '',
      '00:00:00.000 --> 00:00:02.000',
      'Meeting: Kickoff started now',
    ].join('\n'))
    expect(vtt.segments[0]).toMatchObject({ speaker: 'Speaker', text: 'Meeting: Kickoff started now' })

    const plain = parsePlainText('Meeting: Kickoff started now')
    expect(plain.segments[0]).toMatchObject({ speaker: 'Speaker', text: 'Meeting: Kickoff started now' })
  })

  it('does not treat a one-off heading as a speaker', () => {
    const plain = parsePlainText('Agenda: We should discuss the implementation timeline and ownership today.')
    expect(plain.segments[0]).toMatchObject({
      speaker: 'Speaker',
      text: 'Agenda: We should discuss the implementation timeline and ownership today.',
    })
    const srt = parseSRT([
      '1',
      '00:00:01,000 --> 00:00:04,000',
      'Agenda: We should discuss the implementation timeline and ownership today.',
    ].join('\n'))
    expect(srt.segments[0].speaker).toBe('Speaker')
  })

  it('accepts repeated names, dialogue, and diarization tags', () => {
    const repeated = parsePlainText('Alice: I will send the notes.\nAlice: I can also own the follow-up.')
    expect(repeated.segments).toEqual([{ speaker: 'Alice', text: 'I will send the notes. I can also own the follow-up.' }])
    const dialogue = parsePlainText('Alice: I will send the notes.\nBob: I can own the follow-up.')
    expect(dialogue.segments.map(segment => segment.speaker)).toEqual(['Alice', 'Bob'])
    const diarized = parsePlainText('Speaker 1: I will send the notes after this call.')
    expect(diarized.segments[0].speaker).toBe('Speaker 1')
  })
})
