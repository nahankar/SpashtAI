import { describe, expect, it } from 'vitest'
import { detectFormatAndParse, parsePlainText, parseSRT, parseVTT, suggestReplaySessionName } from '../src/lib/transcript-parser'

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

  it('suggests an editable title from metadata, filename, then transcript content', () => {
    expect(suggestReplaySessionName('Title: Q3 Customer Review\nAlice: Hello')).toBe('Q3 Customer Review')
    expect(suggestReplaySessionName('# Meeting: (4) Calendar | Vedanta - Digital as a Service\n# Date: 2026-08-06')).toBe(
      'Vedanta - Digital as a Service',
    )
    expect(suggestReplaySessionName('# Meeting: Calendar\n# Date: 2026-08-21', '2026-08-21_1457_Calendar.txt')).toBe(
      'Replay – 2026-08-21',
    )
    expect(suggestReplaySessionName('', '2026-09-27_Project-Retrospective_recording.vtt')).toBe('Project Retrospective')
    expect(suggestReplaySessionName('Alice: We should review the invoice automation rollout tomorrow.')).toBe(
      'We should review the invoice automation rollout tomorrow.',
    )
  })

  it('parses timestamp-prefixed Teams captions without treating metadata as speech', () => {
    const parsed = detectFormatAndParse([
      '# Meeting: Calendar | Vedanta - Digital as a Service',
      '# Date: 2026-08-06',
      '# Participants: Vasant Mugada, Neelesh Ahankari',
      '',
      '[00:01] Vasant Mugada: We should establish a singular framework.',
      '[00:49] Neelesh Ahankari: What systems are they using today?',
      '[61:02] Neelesh Ahankari: I will summarize the next steps.',
      '[61:10] LC987, EXT-ID (096-Extern): This structured label contains IDs and punctuation.',
      '[61:20] Klaire.Sohns1@gep.com [B2B User]: This structured label contains an email.',
      '[61:30] Unknown user: This is still a distinct transcript speaker label.',
    ].join('\n'), 'text/plain', 'meeting.txt')
    expect(parsed.segments).toEqual([
      { speaker: 'Vasant Mugada', text: 'We should establish a singular framework.', startTime: 1 },
      { speaker: 'Neelesh Ahankari', text: 'What systems are they using today? I will summarize the next steps.', startTime: 49 },
      { speaker: 'LC987, EXT-ID (096-Extern)', text: 'This structured label contains IDs and punctuation.', startTime: 3670 },
      { speaker: 'Klaire.Sohns1@gep.com [B2B User]', text: 'This structured label contains an email.', startTime: 3680 },
      { speaker: 'Unknown user', text: 'This is still a distinct transcript speaker label.', startTime: 3690 },
    ])
    expect(parsed.fullText).not.toContain('# Meeting')
    expect(parsed.speakerCount).toBe(5)
  })
})
