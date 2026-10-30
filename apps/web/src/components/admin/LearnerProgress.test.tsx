import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LearnerProgress, NoLearnerMatch, rangeDays } from './LearnerProgress'
import { learnerDetail } from './LearnerSelector'

const learner = { id: 'cmh1a2b3c4d5e6f7', name: 'Asha Rao', email: 'asha@example.invalid', city: 'Pune', state: 'Maharashtra', joinedAt: '2026-09-01T00:00:00Z', lastActiveAt: null }
const range = { days: 7, timeZone: 'Asia/Kolkata', firstDay: '2026-10-25', lastDay: '2026-10-31', since: '2026-10-24T18:30:00Z', until: '2026-10-31T06:30:00Z' }
const point = (score: number, day: string) => ({ score, day, at: `${day}T05:00:00Z`, source: 'elevate' })

describe('individual learner progress view', () => {
  it('tells same-name accounts apart by email, place and join date', () => {
    expect(learnerDetail(learner)).toBe('asha@example.invalid · Pune, Maharashtra · joined 1 Sept 2026')
  })

  it('separates entries from sessions, shows the IST range and does not invent change', () => {
    const html = renderToStaticMarkup(<LearnerProgress data={{ mode: 'individual', learner, range, match: { matches: true, excludedBy: [] }, report: {
      sources: ['elevate', 'replay'],
      summary: { scoreEntries: 3, sessionsRepresented: 2, entriesWithoutSession: 0, daysWithScores: 2, skillsMeasured: 2 },
      skills: [
        { skill: 'clarity', samples: 2, observations: 2, first: point(5, '2026-10-25'), latest: point(7, '2026-10-27'), change: 2, direction: 'improving' },
        { skill: 'confidence', samples: 1, observations: 1, first: point(8, '2026-10-27'), latest: point(8, '2026-10-27'), change: null, direction: null },
      ],
      daily: [],
      history: [],
      decisions: { counts: [{ source: 'elevate', sessions: 3, tracked: 2, skipped: 0, undecided: 1, open: 0 }], sessions: [] },
    } }} />)
    expect(html).toContain('Sessions represented')
    expect(html).toContain('IST (Asia/Kolkata)')
    expect(html).toContain('+2 (improving)')
    expect(html).toContain('Needs a second session')
    expect(html).toContain('Interviews never contribute to Progress Pulse')
    expect(html).not.toMatch(/Gender|Age band/)
  })

  it('explains a filter conflict instead of showing an empty report', () => {
    const html = renderToStaticMarkup(<NoLearnerMatch excludedBy={['gender']} onClearFilters={vi.fn()} />)
    expect(html).toContain('Excluded by the gender filter.')
  })

  it('puts every day of the range on the axis', () => {
    expect(rangeDays(range)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'])
  })
})
