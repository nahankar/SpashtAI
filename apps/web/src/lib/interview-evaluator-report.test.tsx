import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InterviewEvaluationFeedback } from '../components/admin/InterviewEvaluationFeedback'
import type { Assessment } from './interview-evaluator'
const result: NonNullable<Assessment['result']> = { classification: 'INCORRECT',
  criteria: [{ criterion: 'ACCURACY', finding: 'NOT_MET', explanation: 'This claim contradicts the concept.', evidence: ['<script>alert("x")</script>'] }],
  strengths: [], gaps: ['Missing isolation'], misconceptions: ['Shared state is always safe'], guidance: 'Use independent fixtures.', uncertainty: ['Rubric needs domain review'],
  next: { action: 'SIMPLIFY', source: 'GENERATED', questionText: 'What is an independent fixture?', topic: 'Isolation', needsReview: true } }
describe('interview evaluation feedback display', () => {
  it('escapes candidate evidence while showing gaps, misconceptions and uncertainty', () => {
    const html = renderToStaticMarkup(<InterviewEvaluationFeedback result={result} />)
    expect(html).not.toContain('<script>'); expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('Missing isolation'); expect(html).toContain('Shared state is always safe'); expect(html).toContain('Uncertainties to review')
    expect(html).toContain('Technical accuracy'); expect(html).not.toContain('100'); expect(html).not.toContain('Communication score')
  })
  it('labels generated follow-up proposals as requiring review', () => {
    const html = renderToStaticMarkup(<InterviewEvaluationFeedback result={result} />)
    expect(html).toContain('AI-generated follow-up proposal'); expect(html).toContain('What is an independent fixture?')
  })
  it('shows an honest unavailable-topic fallback with no invented question', () => {
    const html = renderToStaticMarkup(<InterviewEvaluationFeedback result={{ ...result, next: { action: 'SWITCH_TOPIC', source: 'NONE_AVAILABLE', questionText: null, topic: null, needsReview: false } }} />)
    expect(html).toContain('No active question from a different topic'); expect(html).not.toContain('What is an independent fixture?')
  })
})
