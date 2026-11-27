import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InterviewHistoryList } from './InterviewHistoryList'

describe('workspace interview history', () => {
  it('opens another learner’s unfinished practice as playback without mutation controls', () => {
    const html = renderToStaticMarkup(<MemoryRouter><InterviewHistoryList runs={[{ id: 'run-1', sessionId: 'session-1', track: 'General', experienceBand: '2-5', startingDifficulty: 'Medium', startedAt: '2026-11-28', endedAt: null, retainedAt: null, questionCount: 1, readOnly: true, user: { id: 'learner', firstName: 'Asha', lastName: 'Rao', email: 'asha@example.invalid' } }]} onRetain={() => {}} selected={new Set()} onToggle={() => {}} onDelete={() => {}} /></MemoryRouter>)
    expect(html).toContain('Asha Rao')
    expect(html).toContain('/interviews/playback/session-1')
    expect(html).toContain('View Results')
    expect(html).not.toContain('Resume')
    expect(html).not.toContain('checkbox')
    expect(html).not.toContain('Delete')
  })
})
