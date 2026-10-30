import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { IndividualResults, LearnerChoice, individualChips } from './IndividualExplorer'
import type { IndividualAnalyticsPlan, IndividualResult } from './types'

const learner = { id: 'cmh1a2b3c4d5e6f7', name: 'Asha Rao', email: 'asha@example.invalid', city: 'Pune', state: 'Maharashtra', joinedAt: '2026-09-01T00:00:00Z', lastActiveAt: null }
const range = { days: 30, timeZone: 'Asia/Kolkata', firstDay: '2026-10-02', lastDay: '2026-10-31', since: '2026-10-01T18:30:00Z', until: '2026-10-31T06:30:00Z' }
const plan: IndividualAnalyticsPlan = { version: 2, title: 'Learner progress', report: 'learner_progress', learnerId: learner.id, days: 30, sources: ['elevate'], skills: [], feature: null, explanation: 'x' }

describe('AI Analytics individual answers', () => {
  it('summarises the plan scope without identity text', () => {
    expect(individualChips(plan)).toEqual(['Learner progress', 'One learner', 'Last 30 days (IST)', 'Pulse: Elevate'])
  })

  it('shows range, timezone, sample size and missing-data notes', () => {
    const result: IndividualResult = {
      kind: 'individual', report: 'learner_progress', status: 'ok', planHash: 'h', executedAt: '2026-10-31T06:30:00Z', privacyThreshold: 5, range, learner,
      sampleSize: { scoreEntries: 7, sessions: 4, days: 4 },
      missingData: ['No change is reported for confidence: a change needs scores from two different sessions.'],
      progress: { sources: ['elevate'], summary: { scoreEntries: 7, sessionsRepresented: 4, entriesWithoutSession: 0, daysWithScores: 4, skillsMeasured: 1 },
        skills: [], daily: [], history: [], decisions: { counts: [], sessions: [] } },
    }
    const html = renderToStaticMarkup(<IndividualResults title="Learner progress" result={result} refreshing={false} />)
    expect(html).toContain('2026-10-02 to 2026-10-31')
    expect(html).toContain('IST (Asia/Kolkata)')
    expect(html).toContain('7 score entries · 4 sessions · 4 days')
    expect(html).toContain('two different sessions')
    expect(html).toContain('asha@example.invalid')
  })

  it('reports a learner who no longer exists instead of stale figures', () => {
    const html = renderToStaticMarkup(<IndividualResults title="t" refreshing={false} result={{ kind: 'individual', report: 'learner_progress', status: 'no_match',
      planHash: 'h', executedAt: '2026-10-31T06:30:00Z', privacyThreshold: 5, range, learner: null, sampleSize: null, missingData: ['The learner account no longer exists or is not a learner account.'] }} />)
    expect(html).toContain('no longer exists')
  })

  it('lets the admin choose between same-name learners', () => {
    const html = renderToStaticMarkup(<LearnerChoice reason="2 learners share that name." candidates={[learner, { ...learner, id: 'cmh9z8y7x6w5v4u3', email: 'asha.two@example.invalid', city: 'Mysuru' }]} onChoose={vi.fn()} />)
    expect(html).toContain('asha.two@example.invalid')
    expect(html).toContain('Mysuru')
    expect(html).toContain('Search by name or email')
  })
})
