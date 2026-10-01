import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoCompleteNotice, RetainCheckbox } from '@/components/session/SessionRetain'
import { applyRetainResult, setSessionRetained } from './sessionRetain'

describe('session retain', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('applies the server result without touching unrelated retained sessions', () => {
    const items = [
      { id: 'a', retainedAt: '2026-10-01T00:00:00Z' },
      { id: 'b', retainedAt: null },
      { id: 'other-user', retainedAt: '2026-10-01T00:00:00Z' },
    ]
    const next = applyRetainResult(items, {
      sessionId: 'b', retainedAt: '2026-10-01T01:00:00Z', releasedSessionIds: ['a'],
    })
    expect(next.map((item) => item.retainedAt)).toEqual([null, '2026-10-01T01:00:00Z', '2026-10-01T00:00:00Z'])
  })

  it('sends the retain flag and surfaces server errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: 's1', retainedAt: 'x', releasedSessionIds: [] }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Completed sessions cannot be retained' }) })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('localStorage', { getItem: () => null })
    await expect(setSessionRetained('s1', true)).resolves.toMatchObject({ retainedAt: 'x' })
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/sessions\/s1\/retain$/)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ retain: true }) })
    await expect(setSessionRetained('s1', true)).rejects.toThrow('Completed sessions cannot be retained')
  })

  it('renders the 24-hour notice only when sessions are in progress', () => {
    expect(renderToStaticMarkup(<AutoCompleteNotice scope="elevate" count={0} />)).toBe('')
    const html = renderToStaticMarkup(<AutoCompleteNotice scope="elevate" count={2} />)
    expect(html).toContain('2 sessions are in progress')
    expect(html).toContain('24 hours')
    expect(html).toContain('one Elevate session at a time')
    expect(renderToStaticMarkup(<AutoCompleteNotice scope="interview" count={1} />))
      .toContain('one interview practice at a time')
  })

  it('renders a labelled Retain checkbox', () => {
    const html = renderToStaticMarkup(<RetainCheckbox sessionId="s1" retained onChange={() => {}} />)
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('checked=""')
    expect(html).toContain('Retain')
  })
})
