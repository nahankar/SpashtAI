import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DailyActivityTable, activityScopeLabel, type DailyActivityReport } from './DailyActivity'

const measures = { pageViews: null, actions: 2, starts: 1, completions: 0, activeMs: 60_000 }
const report = (mode: 'aggregate' | 'individual'): DailyActivityReport & { suppressed: false } => ({
  mode,
  scope: {
    timeZone: 'Asia/Kolkata',
    activity: { features: ['replay'], note: 'Feature filter applies to activity measures only.' },
    pulse: { sources: ['elevate'], skills: [], note: 'Source and skill filters apply to Pulse evidence only.' },
    learners: mode === 'individual' ? 'one learner' : 'all learners',
    excludes: 'Admin accounts.',
  },
  threshold: 5,
  recordedSince: { replay: { pageViews: '2026-10-27', actions: '2026-10-01', starts: '2026-10-01', completions: '2026-10-01', activeMs: '2026-10-01' } },
  definitions: { measures: {}, features: { replay: { actions: ['session_create'], start: 'Replay upload created', completion: 'Replay analysis completed' } } },
  suppressed: false,
  days: [{ day: '2026-10-20', activeLearners: 1, ...measures, notRecorded: { pageViews: ['replay'], actions: [], starts: [], completions: [], activeMs: [] },
    pulseEntries: 3, pulseSessions: 1, features: [{ feature: 'replay', activeLearners: 1, ...measures }] }],
  totals: { activeLearners: 1, byFeature: [], ...measures, pulseEntries: 3, pulseSessions: 1, pulseLearners: 1 },
})

describe('day-wise activity', () => {
  it('labels unrecorded days instead of showing zero, and links Pulse entries', () => {
    const html = renderToStaticMarkup(<DailyActivityTable report={report('aggregate')} pulseHref="#pulse-summary" />)
    expect(html).toContain('Not recorded')
    expect(html).toContain('href="#pulse-summary"')
    expect(html).toContain('3 in 1 session')
    expect(html).toContain('Active learners')
  })

  it('shows active as yes/no for one learner', () => {
    const html = renderToStaticMarkup(<DailyActivityTable report={report('individual')} pulseHref="#score-history" />)
    expect(html).toContain('>Active<')
    expect(html).toContain('>Yes<')
  })

  it('states each section scope separately so source and feature filters are not linked', () => {
    expect(activityScopeLabel(report('aggregate'))).toEqual({ activity: 'Activity: Replay · all learners', pulse: 'Pulse entries: Elevate, all skills' })
  })
})
