import { describe, expect, it, vi } from 'vitest'
import { createLiveSessionApi } from './api'
function fixture() {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    if (init?.method === 'POST' && String(url).endsWith('/segments')) {
      return new Response(JSON.stringify({ segment: { id: 'segment-id', roomName: 'lk_server_room' } }), { status: 201 })
    }
    return new Response(JSON.stringify({ token: 'token', url: 'wss://room' }), { status: 200 })
  })
  let auth = 'first'
  const api = createLiveSessionApi({ baseUrl: 'http://api', fetch: fetcher as typeof fetch,
    headers: () => ({ Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }),
    now: () => new Date('2026-10-07T00:00:00Z'), randomId: () => 'segment-id' })
  return { api, calls, fetcher, changeAuth: () => { auth = 'second' } }
}
describe('live transport characterization', () => {
  it('preserves segment requests and resolves current auth for every call', async () => {
    const { api, calls, changeAuth } = fixture()
    expect(await api.createSessionSegment('session')).toEqual({ segmentId: 'segment-id', roomName: 'lk_server_room' })
    changeAuth()
    await api.closeSessionSegment('session', 'segment-id', 'available')
    expect(calls.map(c => [c.url, c.init?.method, JSON.parse(String(c.init?.body))])).toEqual([
      ['http://api/sessions/session/segments', 'POST', { segmentId: 'segment-id', startedAt: '2026-10-07T00:00:00.000Z' }],
      ['http://api/sessions/session/segments/segment-id', 'PATCH', { endedAt: '2026-10-07T00:00:00.000Z', audioStatus: 'available' }],
    ])
    expect(calls[1].init?.headers).toMatchObject({ Authorization: 'Bearer second' })
  })
  it('uses only the room name the server assigned, and fails rather than inventing one', async () => {
    const { api, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ segment: { id: 'segment-id' } }), { status: 201 }))
    await expect(api.createSessionSegment('session')).rejects.toThrow('Failed to start session segment')
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ segment: { id: 'someone-else', roomName: 'lk_other' } }), { status: 201 }))
    await expect(api.createSessionSegment('session')).rejects.toThrow('Failed to start session segment')
  })
  it('preserves completion saves in metrics then transcript order', async () => {
    const { api, calls } = fixture()
    await api.saveSessionData('session', { wpm: 120 }, { text: 'answer' })
    expect(calls.map(c => c.url)).toEqual(['http://api/sessions/session/metrics', 'http://api/sessions/session/transcript'])
  })
  it('does not write transcript after failed metrics save', async () => {
    const { api, calls, fetcher } = fixture()
    fetcher.mockResolvedValueOnce(new Response('', { status: 500 }))
    await api.saveSessionData('session', {}, {})
    expect(calls).toHaveLength(0)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('carries abort and auth on token requests and identifiers on dispatch', async () => {
    const { api, calls } = fixture(); const abort = new AbortController()
    await api.fetchLiveToken({ room: 'r', sessionId: 's', segmentId: 'seg' }, abort.signal)
    await api.requestAgentDispatch('r', 's', 'seg')
    expect(calls[0].url).toBe('http://api/livekit/token?room=r&sessionId=s&segmentId=seg')
    expect(calls[0].init?.signal).toBe(abort.signal)
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'Bearer first' })
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({ room: 'r', sessionId: 's', segmentId: 'seg' })
  })
})
