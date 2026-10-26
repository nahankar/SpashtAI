import { describe, expect, it } from 'vitest'
import { PRACTICE_DIFFICULTIES, STANDARD_DURATIONS, durationLabel } from './interview-practice'

describe('interview practice setup defaults', () => {
  it('starts with every supported difficulty selected', () => {
    expect(PRACTICE_DIFFICULTIES).toEqual(['Simple', 'Medium', 'Complex', 'Very Complex'])
  })
  it('labels no time limit without implying unlimited questions', () => {
    expect(durationLabel(null, 8)).toBe('No time limit (up to 8 questions)')
    expect(durationLabel(30, 8)).toBe('30 minutes')
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
