import { describe, expect, it } from 'vitest'
import { PRACTICE_DIFFICULTIES, STANDARD_DURATIONS, durationLabel } from './interview-practice'

describe('interview practice setup defaults', () => {
  it('starts with every supported difficulty selected', () => {
    expect(PRACTICE_DIFFICULTIES).toEqual(['Simple', 'Medium', 'Complex', 'Very Complex'])
  })
  it('names the plan beside 30 minutes and no time limit, and keeps shorter times plain', () => {
    expect(durationLabel(null)).toBe('No time limit · Ultra')
    expect(durationLabel(30)).toBe('30 minutes · Pro')
    expect([5, 10, 15].map(durationLabel)).toEqual(['5 minutes', '10 minutes', '15 minutes'])
    expect(STANDARD_DURATIONS).toEqual({ plan: 'standard', allowed: [5, 10, 15], default: 10 })
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createElement } from 'react'
import { recordingGate } from './interview-practice'
import { RecordingAcknowledgmentCard } from '@/features/interviews/RecordingAcknowledgmentCard'

describe('recording acknowledgment gate', () => {
  const current = { version: 'interview-recording-ai-1', scope: ['interview-audio-recording'], text: 'Interview practice records your microphone audio.' }
  it('keeps the per-practice checkbox until an acknowledgment for the current version is on record', () => {
    expect(recordingGate({ status: 'loading' })).toBe('loading')
    expect(recordingGate({ status: 'error' })).toBe('checkbox')
    expect(recordingGate({ status: 'ready', value: { current, accepted: null } })).toBe('acknowledge')
    expect(recordingGate({ status: 'ready', value: { current, accepted: { version: 'interview-recording-ai-0', acceptedAt: '2026-10-26T00:00:00Z' } } })).toBe('acknowledge')
    expect(recordingGate({ status: 'ready', value: { current, accepted: { version: current.version, acceptedAt: '2026-10-26T00:00:00Z' } } })).toBe('accepted')
  })
  it('shows the exact server text once; nothing is repeated near Start afterwards', () => {
    const card = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RecordingAcknowledgmentCard, { value: { current, accepted: null }, busy: false, error: '', onAccept: () => undefined })))
    expect(card).toContain(current.text); expect(card).toContain('I agree'); expect(card).toContain('href="/privacy"')
  })
})

import { recognitionNotice } from './interview-practice'
describe('speech recognition notices', () => {
  it('states repeated failure and untranscribed audio plainly, and clears failure on recovery', () => {
    const failing = recognitionNotice({ state: 'unavailable', attemptId: 'a1' }, null)
    expect(failing?.text).toContain('Speech recognition is not responding')
    expect(failing?.text).not.toMatch(/Amazon|Transcribe|AWS/)
    expect(recognitionNotice({ state: 'recovered', attemptId: 'a1' }, failing)).toBeNull()
    const gap = recognitionNotice({ state: 'gap', attemptId: 'a1', lostSeconds: 12.4 }, null)
    expect(gap?.text).toContain('about 12 seconds of this answer could not be transcribed')
    // A recovery does not hide a reported gap, which stays true for that answer.
    expect(recognitionNotice({ state: 'recovered', attemptId: 'a1' }, gap)).toBe(gap)
  })
})
