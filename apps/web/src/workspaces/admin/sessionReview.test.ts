import { describe, expect, it } from 'vitest'
import {
  feedbackLines, filterSearch, filtersFromSearch, formatClock, formatDuration, formatWhen, learnerSessionsPath, reviewDetailPath, reviewListPath,
  reviewPagePath, reviewTicketPath, scoredSkills, speakerLabel,
} from './sessionReview'

describe('session review helpers', () => {
  it('keeps only supported filters from the page address and builds server queries from them', () => {
    const filters = filtersFromSearch(new URLSearchParams('learner=m1&product=replay&status=failed&from=2026-11-01&to=2026-11-03&extra=x'))
    expect(filters).toEqual({ learner: 'm1', product: 'replay', status: 'failed', from: '2026-11-01', to: '2026-11-03' })
    expect(filtersFromSearch(new URLSearchParams('product=prepare&status=deleted&from=yesterday'))).toEqual({})
    expect(reviewListPath({})).toBe('/api/workspaces/current/review/sessions')
    expect(reviewListPath({ learner: 'm1', product: 'elevate' }, 'cursor/1')).toBe('/api/workspaces/current/review/sessions?learner=m1&product=elevate&after=cursor%2F1')
    expect(filterSearch({ from: '2026-11-01' })).toBe('from=2026-11-01')
  })

  it('addresses review pages, details and playback tickets only under the current workspace', () => {
    expect(reviewDetailPath('interviews', 'a/b')).toBe('/api/workspaces/current/review/sessions/interviews/a%2Fb')
    expect(reviewTicketPath('elevate', 's1', 'r1')).toBe('/api/workspaces/current/review/sessions/elevate/s1/recordings/r1/ticket')
    expect(reviewPagePath('/w/kls', { product: 'replay', id: 'r1' })).toBe('/w/kls/admin/sessions/replay/r1')
    expect(learnerSessionsPath('/w/kls', 'member-1')).toBe('/w/kls/admin/sessions?learner=member-1')
  })

  it('formats durations, clock offsets and times in the organization time zone', () => {
    expect(formatDuration(null)).toBe('—'); expect(formatDuration(42)).toBe('42s'); expect(formatDuration(605)).toBe('10m 05s'); expect(formatDuration(3720)).toBe('1h 02m')
    expect(formatClock(65.4)).toBe('1:05'); expect(formatClock(null)).toBe('')
    expect(formatWhen('2026-11-02T20:00:00Z', 'Asia/Kolkata')).toMatch(/3 Nov 2026/)
    expect(formatWhen('2026-11-02T20:00:00Z', 'UTC')).toMatch(/2 Nov 2026/)
    expect(formatWhen(null, 'UTC')).toBe('—')
  })

  it('labels speakers per product and shows only plain feedback text and real scores', () => {
    expect(speakerLabel('user', 'elevate')).toBe('Learner'); expect(speakerLabel('assistant', 'interviews')).toBe('Interviewer'); expect(speakerLabel('assistant', 'elevate')).toBe('Coach')
    expect(feedbackLines(['Clear', '', { title: 'Pace', detail: 'Slow down', score: 3 }, 7, null])).toEqual(['Clear', 'Pace — Slow down'])
    expect(feedbackLines('not a list')).toEqual([])
    expect(scoredSkills({ clarity: 7.46, pacing: null, emotionalControl: 5 })).toEqual([{ key: 'clarity', label: 'Clarity', value: 7.5 }, { key: 'emotionalControl', label: 'Emotional control', value: 5 }])
  })
})
