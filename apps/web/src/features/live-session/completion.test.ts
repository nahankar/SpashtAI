import { describe, expect, it, vi } from 'vitest'
import { fixture, recorder } from './test-fixtures'
import { elevateAdapter } from './adapters/elevate'
import { prepareAdapter } from './adapters/prepare'
async function joined() { const f = fixture(); await f.controller.resume('existing'); f.calls.length = 0; return f }
describe('completion and discard characterization', () => {
  it.each(['ordinary', 'snapshot', 'booth', 'prepare', 'coach'])('preserves completion policy and request order: %s', async kind => {
    const f = await joined(); const capture = recorder()
    const config = { ...f.config, focusArea: kind === 'snapshot' ? 'snapshot' : '', boothDemo: kind === 'booth', preparationId: kind === 'prepare' ? 'journey' : undefined }
    const adapter = kind === 'prepare' ? prepareAdapter(f.api, config) : elevateAdapter(f.api, config)
    const order: string[] = []
    const original = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async (input, init) => {
      const path = String(input); order.push(path.split('/').at(-1)!)
      await original(input, init)
      return new Response(JSON.stringify({ totalPoints: 20, pulseEntriesCreated: 2 }))
    })
    vi.mocked(capture.finalize).mockImplementation(async () => { order.push('finalize'); return { ok: true, audioCapture: 'uploaded' } })
    vi.mocked(f.effects.clearMessages).mockImplementation(() => { order.push('clearMessages') })
    vi.mocked(f.effects.clearActiveSession).mockImplementation(() => { order.push('clearStorage') })
    vi.mocked(f.effects.rewardPoints).mockImplementation(() => { order.push('rewardPoints') })
    vi.mocked(f.effects.left).mockImplementation(() => { order.push('result') })
    await f.controller.leave(capture, adapter)
    const track = kind === 'ordinary' || kind === 'coach'
    expect(order).toEqual(['finalize', 'segment-1', 'clearMessages', 'clearStorage', 'end', 'rewardPoints', 'calculate-text-metrics', 'analyze', ...(['snapshot', 'booth'].includes(kind) ? ['skip'] : []), 'result'])
    expect(f.calls.find(c => c.path.endsWith('/analyze'))?.body).toEqual({ source: 'elevate', autoTrackPulse: track, audioCapture: 'uploaded' })
    expect(f.calls.find(c => c.path.endsWith('/end'))?.body).toEqual({ endedAt: '2026-10-07T00:00:00.000Z', preparationId: config.preparationId || null })
    expect(f.effects.left).toHaveBeenCalledWith('existing', track)
    expect(f.effects.log).toHaveBeenCalledWith('event', 'elevate.session_leave', { sessionId: 'existing' })
    expect(f.controller.getSnapshot()).toMatchObject({ token: null, sessionId: null, isLeaving: false })
  })
  it('maps thrown recorder finalization to failed analysis input', async () => {
    const f = await joined(); const capture = recorder(); vi.mocked(capture.finalize).mockRejectedValue(new Error('capture failure'))
    await f.controller.leave(capture, elevateAdapter(f.api, f.config))
    expect(f.calls[0].body.audioStatus).toBe('failed')
    expect(f.calls.find(c => c.path.endsWith('/analyze'))?.body.audioCapture).toBe('failed')
  })
  it.each(['http', 'network'])('preserves existing analysis-failure feedback (%s)', async mode => {
    const f = await joined(); const original = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async (input, init) => {
      if (String(input).endsWith('/analyze')) { if (mode === 'network') throw new Error('offline'); return new Response('{}', { status: 500 }) }
      return original(input, init)
    })
    await f.controller.leave(recorder(), elevateAdapter(f.api, f.config))
    expect(f.effects.toast).toHaveBeenCalledWith('success', mode === 'network' ? 'Session saved' : 'Session tracked in Progress Pulse')
    expect(f.effects.left).toHaveBeenCalledOnce()
  })
  it.each(['elevate', 'prepare'])('accepts %s discard before stopping the recorder', async kind => {
    const f = await joined(); const capture = recorder(); const order: string[] = []
    const adapter = kind === 'prepare' ? prepareAdapter(f.api, { ...f.config, preparationId: 'journey' }) : elevateAdapter(f.api, f.config)
    vi.mocked(f.effects.discarded).mockImplementation(() => { order.push('accepted') })
    vi.mocked(capture.discard).mockImplementation(async () => { order.push('recorder') })
    vi.mocked(f.effects.clearActiveSession).mockImplementation(() => { order.push('storage') })
    await f.controller.discard(capture, adapter)
    expect(order).toEqual(['accepted', 'recorder', 'storage'])
    expect(f.calls[0].method).toBe(kind === 'prepare' ? 'POST' : 'DELETE')
    expect(f.effects.discardFinished).toHaveBeenCalledOnce()
  })
  it('keeps the live room and recorder when discard is rejected', async () => {
    const f = await joined(); const capture = recorder(); const before = f.controller.getSnapshot()
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Completed journey practice cannot be discarded' }), { status: 409 }))
    await f.controller.discard(capture, prepareAdapter(f.api, { ...f.config, preparationId: 'journey' }))
    expect(f.controller.getSnapshot()).toEqual(before)
    expect(capture.discard).not.toHaveBeenCalled(); expect(f.effects.clearActiveSession).not.toHaveBeenCalled()
    expect(f.effects.toast).toHaveBeenCalledWith('error', 'Completed journey practice cannot be discarded')
  })
  it('can discard a viewed standalone result without a live connection', async () => {
    const f = fixture()
    await f.controller.discard(null, elevateAdapter(f.api, f.config), 'viewed')
    expect(f.calls[0]).toMatchObject({ path: '/sessions/viewed', method: 'DELETE' })
    expect(f.effects.discarded).toHaveBeenCalledWith('viewed')
  })
  it('guards a second Leave while recording settlement is pending', async () => {
    const f = await joined(); const capture = recorder(); let resolve!: (value: { ok: boolean; audioCapture: 'uploaded' }) => void
    vi.mocked(capture.finalize).mockReturnValue(new Promise(r => { resolve = r }))
    const first = f.controller.leave(capture, elevateAdapter(f.api, f.config))
    await f.controller.leave(capture, elevateAdapter(f.api, f.config))
    expect(capture.finalize).toHaveBeenCalledOnce()
    resolve({ ok: true, audioCapture: 'uploaded' }); await first
    expect(f.calls.filter(c => c.path.endsWith('/end'))).toHaveLength(1)
  })
})
