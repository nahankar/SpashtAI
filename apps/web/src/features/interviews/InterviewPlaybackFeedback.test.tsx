import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ConversationPanel } from '@/features/live-session/components/ConversationPanel'
import type { ChatMessage } from '@/features/live-session/types'
import { applyRetain, filterPractices, practiceCounts } from '@/lib/interview-history'
import type { InterviewHistory } from '@/lib/interview-practice'
import { InterviewFeedbackDisclosure, InterviewFeedbackPlaceholder } from './InterviewFeedbackDisclosure'
import { feedbackSummary } from './feedback-summary'
import { InterviewHistoryList } from './InterviewHistoryList'
import type { LearnerFinding } from './useInterviewFindings'

const criteria = (['ACCURACY', 'REASONING', 'DEPTH'] as const).map(criterion => ({ criterion, finding: 'NOT_ASSESSED', explanation: '', evidence: [] }))
const finding = (attemptId: string, index: number, over: Partial<LearnerFinding> = {}): LearnerFinding => ({ attemptId, index, question: `Q${index}`, status: 'COMPLETED',
  errorCode: null, assistance: 'NONE', afterExample: false, result: { classification: 'PARTIAL', criteria, strengths: [`strength ${index}`], gaps: [`gap ${index}`],
    misconceptions: [], guidance: `guidance ${index}`, uncertainty: [] }, ...over })
const at = (n: number) => `2026-10-25T10:00:${String(n).padStart(2, '0')}Z`

describe('interview playback feedback', () => {
  // q2 was skipped (no answer), and the evaluations completed out of order (a3 before a1).
  const messages: ChatMessage[] = [
    { id: 'interview_question_a1', attemptId: 'a1', role: 'assistant', content: 'Question one?', timestamp: at(1) },
    { id: 'interview_answer_a1', attemptId: 'a1', role: 'user', content: 'Answer one', timestamp: at(2) },
    { id: 'interview_question_a2', attemptId: 'a2', role: 'assistant', content: 'Question two?', timestamp: at(3), attemptStatus: 'SKIPPED' },
    { id: 'interview_question_a3', attemptId: 'a3', role: 'assistant', content: 'Question three?', timestamp: at(4) },
    { id: 'interview_answer_a3', attemptId: 'a3', role: 'user', content: 'Answer three', timestamp: at(5) },
  ]
  const findings = new Map([finding('a3', 3), finding('a2', 2, { status: 'SKIPPED', result: null }), finding('a1', 1, { status: 'RUNNING', result: null })].map(f => [f.attemptId, f]))
  const html = renderToStaticMarkup(<ConversationPanel messages={messages} stitchAdjacentUserMessages={false} autoScroll={false}
    renderAfterMessage={m => m.role === 'user' && m.attemptId ? <InterviewFeedbackDisclosure finding={findings.get(m.attemptId)} /> : null} />)

  it('places each answer\'s feedback directly below that answer by attempt id, not position', () => {
    const order = [...html.matchAll(/Answer one|Answer three|data-attempt-id="(a\d)"|Question two\?/g)].map(m => m[1] ?? m[0])
    expect(order).toEqual(['Answer one', 'a1', 'Question two?', 'Answer three', 'a3'])
    expect(html).toContain('Technical feedback · Evaluating…')
    expect(html).toContain('Technical feedback · Partially correct')
    expect(html).toMatch(/strength 3/); expect(html).not.toMatch(/strength 1/)
  })
  it('reserves the same one-line space while loading and when evaluation is not enabled', () => {
    const line = (html: string) => /<span class="([^"]+)">/.exec(html)?.[1]
    const loading = renderToStaticMarkup(<InterviewFeedbackPlaceholder />)
    const notEnabled = renderToStaticMarkup(<InterviewFeedbackDisclosure finding={finding('z', 1, { status: 'NOT_ENABLED', result: null })} />)
    expect(loading).toContain('Technical feedback · Loading…'); expect(notEnabled).toContain('Not enabled for this practice')
    expect(line(loading)).toBe(line(notEnabled))
    expect(loading).toContain('aria-hidden="true"')
  })
  it('keeps a skipped question in place with its badge and no grade', () => {
    expect(html).toContain('Skipped'); expect(html).not.toContain('data-attempt-id="a2"')
  })
  it('is collapsed by default and shows the required sections when expanded', () => {
    expect(html).not.toMatch(/<details[^>]*open/)
    for (const title of ['What was correct', 'Missing core concepts', 'How to improve']) expect(html).toContain(title)
  })
  it('distinguishes request-only, did-not-know, incomplete and unavailable answers honestly', () => {
    const base = finding('x', 1)
    const request = { ...base, result: { ...base.result!, classification: 'NOT_ANSWERED', strengths: [], gaps: [], responseKind: 'REQUEST_ONLY' as const, guidance: 'Use the buttons.' } }
    expect(feedbackSummary(request)).toBe('Technical feedback · Request only · no answer to assess')
    expect(renderToStaticMarkup(<InterviewFeedbackDisclosure finding={request} />)).toContain('says nothing about your knowledge')
    expect(feedbackSummary({ ...request, result: { ...request.result, responseKind: 'DONT_KNOW' } })).toBe('Technical feedback · Did not know')
    expect(feedbackSummary({ ...base, result: { ...base.result!, classification: 'NOT_ANSWERED' } })).toBe('Technical feedback · No technical answer')
    expect(feedbackSummary({ ...base, status: 'INCOMPLETE', result: null })).toBe('Incomplete answer · not evaluated')
    expect(renderToStaticMarkup(<InterviewFeedbackDisclosure finding={{ ...base, status: 'FAILED', result: null }} />)).toContain('No grade was invented')
    expect(feedbackSummary({ ...base, status: 'NOT_ENABLED', result: null })).toBe('Technical feedback · Not enabled for this practice')
    expect(feedbackSummary({ ...base, status: 'SKIPPED', result: null })).toBe('Skipped · not evaluated')
    expect(feedbackSummary(undefined)).toBeNull()
  })
})

describe('interview history', () => {
  const run = (id: string, over: Partial<InterviewHistory> = {}): InterviewHistory => ({ id, sessionId: `s-${id}`, track: 'Automation Testing', experienceBand: '2-5',
    startingDifficulty: 'Simple', startedAt: at(10), endedAt: null, retainedAt: null, questionCount: 3, answeredCount: 2, skippedCount: 1, ...over })
  const runs = [run('a', { endedAt: at(30), startedAt: at(1) }), run('b', { track: 'Web Development|Automation Testing', startedAt: at(20) }), run('c', { endedAt: at(40), startedAt: at(5), track: 'Python' })]
  it('searches, filters by status and sorts like the other history screens', () => {
    expect(filterPractices(runs, '', 'all', 'date', 'desc').map(r => r.id)).toEqual(['b', 'c', 'a'])
    expect(filterPractices(runs, '', 'ended', 'date', 'asc').map(r => r.id)).toEqual(['a', 'c'])
    expect(filterPractices(runs, 'web', 'all', 'date', 'desc').map(r => r.id)).toEqual(['b'])
    expect(filterPractices(runs, 'python', 'active', 'date', 'desc')).toEqual([])
    expect(filterPractices(runs, '', 'all', 'name', 'asc').map(r => r.id)).toEqual(['a', 'c', 'b'])
  })
  it('shows answered and skipped counts, Resume for unfinished and Review straight to playback', () => {
    expect(practiceCounts(run('x', { incompleteCount: 1 }))).toBe('2 answered · 1 skipped · 1 incomplete')
    const html = renderToStaticMarkup(<MemoryRouter><InterviewHistoryList runs={runs} onRetain={() => undefined} /></MemoryRouter>)
    expect(html).toContain('href="/interviews?run=b"'); expect(html).toContain('>Resume<')
    expect(html).toContain('href="/interviews/playback/s-a"'); expect(html).toContain('>Review<')
    expect(html).toContain('Web Development, Automation Testing')
  })
  it('retaining one practice releases the others', () => {
    const next = applyRetain(runs.map(r => ({ ...r, retainedAt: r.id === 'b' ? at(50) : null })), runs[2], { sessionId: 's-c', retainedAt: at(60), releasedSessionIds: ['s-b'] })
    expect(next.map(r => r.retainedAt)).toEqual([null, null, at(60)])
  })
})
