import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ReviewFilterBar, SessionReviewTable, SessionReviewView } from './SessionsPage'
import type { ReviewDetail } from './sessionReview'

const learner = { memberId: 'm1', name: 'Asha Rao', email: 'asha@example.invalid' }
const render = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)

describe('workspace session review pages', () => {
  it('lists sessions with a read-only review link and an empty state', () => {
    const html = render(<SessionReviewTable base="/w/kls" timeZone="Asia/Kolkata" items={[{ id: 's1', product: 'interviews', name: 'Backend practice', learner,
      startedAt: '2026-11-02T06:00:00Z', endedAt: '2026-11-02T06:20:00Z', durationSeconds: 1200, status: 'completed' }]} />)
    expect(html).toContain('Asha Rao'); expect(html).toContain('Interviews'); expect(html).toContain('20m 00s'); expect(html).toContain('Completed')
    expect(html).toContain('href="/w/kls/admin/sessions/interviews/s1"')
    expect(html).not.toMatch(/Delete|Edit|Export|Reprocess|Download/)
    expect(render(<SessionReviewTable base="/w/kls" timeZone="UTC" items={[]} />)).toContain('No sessions match these filters')
  })

  it('offers learner, product, status and date filters in the organization calendar', () => {
    const html = render(<ReviewFilterBar filters={{ from: '2026-11-01' }} onChange={() => {}} timeZone="Asia/Kolkata" />)
    for (const label of ['Product', 'Status', 'From', 'To', 'Dates are days in Asia/Kolkata']) expect(html).toContain(label)
  })

  it('shows Interviews answers, technical feedback, transcript and recordings without any write action', () => {
    const data: ReviewDetail = {
      product: 'interviews', readOnly: true,
      session: { id: 's1', name: 'Backend practice', learner, startedAt: '2026-11-02T06:00:00Z', endedAt: '2026-11-02T06:20:00Z', durationSeconds: 1200, status: 'completed' },
      recordings: [{ id: 'r1', kind: 'user', mimeType: 'audio/webm', durationSeconds: 300, segmentIndex: 0, available: true }],
      transcript: [{ id: 't1', role: 'assistant', text: 'Tell me about caching.', audioStart: 0, audioEnd: 2, score: null, coachNote: null },
        { id: 't2', role: 'user', text: 'I would use a TTL.', audioStart: 65, audioEnd: 70, score: { stars: 4, tags: ['clear'] }, coachNote: 'Lead with the outcome.' }],
      results: null,
      interview: { track: 'backend', experienceBand: '2-5', startingDifficulty: 'Medium', durationMinutes: 10, evaluationEnabled: true, attempts: [{
        id: 'a1', index: 1, status: 'ANSWERED', completionReason: null, assistance: 'NONE', capturedText: 'I would use a TTL.',
        question: { text: 'How would you design a cache?', track: 'backend', category: 'design', topic: 'caching', difficulty: 'Medium' },
        answer: { text: 'I would use a TTL.', source: 'AGENT_COMMITTED_TURNS', revision: 1 },
        feedback: { status: 'COMPLETED', errorCode: null, result: { classification: 'PARTIAL', criteria: [{ criterion: 'ACCURACY', finding: 'PARTIAL', evidence: [], explanation: 'Mostly right.' }],
          strengths: ['Named TTL'], gaps: ['No invalidation'], misconceptions: [], guidance: 'Discuss invalidation.', uncertainty: [], responseKind: null } } }] },
    }
    const html = render(<SessionReviewView data={data} timeZone="Asia/Kolkata" />)
    for (const text of ['Backend practice', 'Asha Rao', 'Read-only review', 'audit log', 'Load recording', 'Question 1: How would you design a cache?',
      'I would use a TTL.', 'Partly correct', 'Accuracy: Partly met', 'No invalidation', 'Discuss invalidation.', 'Interviewer', 'Learner', '1:05', 'Coach note: Lead with the outcome.']) {
      expect(html).toContain(text)
    }
    expect(html).not.toMatch(/>(Delete|Edit|Export|Reprocess|Download)</)
  })

  it('shows Replay transcript and results and explains recordings outside the plan', () => {
    const data: ReviewDetail = {
      product: 'replay', readOnly: true,
      session: { id: 'r1', name: 'Standup', learner, startedAt: '2026-11-01T06:00:00Z', endedAt: null, durationSeconds: null, status: 'completed' },
      recordings: [{ id: 'u1', kind: 'video', mimeType: 'video/mp4', durationSeconds: null, segmentIndex: null, available: false }],
      replay: { transcriptText: 'Roadmap text', structuredTranscript: [{ speaker: 'Asha', text: 'Roadmap text', startTime: 3, endTime: 5 }],
        metrics: { wordsPerMinute: 130, paceStatus: 'measured' }, scores: { overall: 7.2, clarity: null }, skillScores: { clarity: 7 },
        feedback: { strengths: ['Clear agenda'], improvements: [], recommendations: [], contextSpecificFeedback: [], keyMoments: [], scope: 'Text-based assessment.' },
        coachingInsights: null },
    }
    const html = render(<SessionReviewView data={data} timeZone="UTC" />)
    for (const text of ['Roadmap text', 'Asha', 'Words per minute', '130', 'Clear agenda', 'Text-based assessment.', 'not included in your organization']) expect(html).toContain(text)
    expect(html).not.toContain('Load recording')
  })
})
