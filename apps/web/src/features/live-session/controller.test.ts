import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture } from './test-fixtures'
import { elevateAdapter } from './adapters/elevate'
import { prepareAdapter } from './adapters/prepare'
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
describe('live controller start and resume characterization', () => {
  beforeEach(() => vi.restoreAllMocks())
  it.each([
    {}, { focusArea: 'engagement', focusContext: 'Past practice', sessionName: 'Practice engagement' },
    { focusArea: 'snapshot', boothDemo: true }, { preparationId: 'journey' }, { preparationId: 'journey', stageId: 'stage' },
  ])('starts with the original session → segment → token contract: %j', async overrides => {
    const f = fixture(); const config = { ...f.config, ...overrides }
    const adapter = config.preparationId ? prepareAdapter(f.api, config) : elevateAdapter(f.api, config)
    await f.controller.start(config, adapter)
    expect(f.calls.map(c => c.method)).toEqual(['POST', 'POST', 'GET'])
    expect(f.calls[0].body).toMatchObject({ module: 'elevate', sessionName: config.sessionName || null,
      focusArea: config.focusArea || null, focusContext: config.focusContext || null, preparationId: config.preparationId || null, stageId: config.stageId || null })
    expect(f.calls[1].path).toMatch(/\/segments$/)
    expect([...new URL(`http://api${f.calls[2].path}`).searchParams.keys()]).toEqual(['room', 'sessionId', 'segmentId'])
    expect(f.controller.getSnapshot().token).toBeTruthy()
    expect(f.effects.log).toHaveBeenCalledWith('event', 'elevate.session_join', expect.objectContaining({ focusArea: config.focusArea || null }))
  })
  it.each([['elevate', 0], ['elevate', 1], ['elevate', 2], ['prepare', 0], ['prepare', 1], ['prepare', 2]] as const)('cleans up a failed %s start at request %i', async (kind, failedStep) => {
    const f = fixture(); let step = 0
    const original = f.fetcher.getMockImplementation()!
    f.fetcher.mockImplementation(async (...args) => { if (step++ === failedStep) return new Response(JSON.stringify({ error: 'denied' }), { status: 500 }); return original(...args) })
    const config = { ...f.config, preparationId: kind === 'prepare' ? 'journey' : undefined }
    await f.controller.start(config, kind === 'prepare' ? prepareAdapter(f.api, config) : elevateAdapter(f.api, config))
    expect(f.controller.getSnapshot().token).toBeNull()
    expect(f.controller.getSnapshot().isJoining).toBe(false)
    expect(f.calls.at(-1)?.method).toBe(kind === 'prepare' && failedStep > 0 ? 'POST' : 'DELETE')
    if (kind === 'prepare' && failedStep > 0) expect(f.calls.at(-1)?.path).toMatch(/\/discard$/)
    if (failedStep === 2) expect(f.calls.at(-2)?.body.audioStatus).toBe('unavailable')
    expect(f.effects.log).toHaveBeenCalledWith('error', 'elevate.session_join_failed', expect.any(Error))
  })
  it('uses journey discard only after linked creation succeeded', async () => {
    const f = fixture(); const config = { ...f.config, preparationId: 'journey' }
    f.fetcher.mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('segment failed'))
    await f.controller.start(config, prepareAdapter(f.api, config))
    expect(f.calls.at(-1)?.path).toMatch(/\/api\/preparations\/journey\/practices\/.+\/discard$/)
  })
  it('does not create an activity while the journey is unresolved', async () => {
    const f = fixture(); await f.controller.start({ ...f.config, preparationPending: true }, elevateAdapter(f.api, f.config))
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.effects.toast).toHaveBeenCalledWith('error', 'Interview journey is still loading')
  })
  it('guards a double start and double manual resume', async () => {
    const f = fixture(); const pending = deferred<Response>()
    f.fetcher.mockReturnValueOnce(pending.promise)
    const start = f.controller.start(f.config, elevateAdapter(f.api, f.config))
    await f.controller.start(f.config, elevateAdapter(f.api, f.config))
    expect(f.fetcher).toHaveBeenCalledOnce(); pending.resolve(new Response('{}')); await start
    const segment = deferred<Response>(); f.fetcher.mockReturnValueOnce(segment.promise)
    const resume = f.controller.resume('session')
    await f.controller.resume('session')
    segment.resolve(new Response('{}')); await resume
    expect(f.calls.filter(c => c.path.includes('/token?'))).toHaveLength(2)
  })
  it('closes a new segment when resume token fails', async () => {
    const f = fixture(); f.fetcher.mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('token failed'))
    await expect(f.controller.resume('existing')).rejects.toThrow('token failed')
    expect(f.calls.at(-1)?.body.audioStatus).toBe('unavailable')
    expect(f.calls.some(c => c.method === 'DELETE')).toBe(false)
  })
  it('cleans an aborted Strict Mode attempt without clobbering its replacement', async () => {
    const f = fixture(); const pending = deferred<Response>(); const abort = new AbortController()
    f.fetcher.mockReturnValueOnce(pending.promise)
    const first = f.controller.resume('existing', abort.signal, true)
    abort.abort()
    await f.controller.resume('existing', new AbortController().signal, true)
    const replacement = f.controller.getSnapshot()
    pending.resolve(new Response('{}')); await first
    expect(f.controller.getSnapshot()).toEqual(replacement)
    expect(f.calls.filter(c => c.body?.audioStatus === 'unavailable')).toHaveLength(1)
  })
  it('ignores a late token after cancellation and seals its segment', async () => {
    const f = fixture(); const token = deferred<Response>(); const abort = new AbortController()
    f.fetcher.mockResolvedValueOnce(new Response('{}')).mockReturnValueOnce(token.promise)
    const resume = f.controller.resume('existing', abort.signal, true)
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(2))
    abort.abort(); token.resolve(new Response(JSON.stringify({ token: 'late', url: 'wss://late' }))); await resume
    expect(f.controller.getSnapshot().token).toBeNull()
    expect(f.calls.at(-1)?.body.audioStatus).toBe('unavailable')
  })
  it('keeps room-prefixed user turn IDs distinct across resume and drops paused messages', async () => {
    const f = fixture(); await f.controller.resume('existing')
    f.controller.handleMessage({ role: 'user', id: 'user_turn_1', content: 'First answer', partial: true })
    const first = vi.mocked(f.effects.upsertStreamingMessage).mock.calls[0][2]
    f.controller.patch({ isSessionPaused: true })
    f.controller.handleMessage({ role: 'user', id: 'user_turn_1', content: 'Dropped' })
    expect(f.effects.addMessage).not.toHaveBeenCalled()
    await f.controller.resume('existing')
    f.controller.handleMessage({ role: 'user', id: 'user_turn_1', content: 'Second answer' })
    expect(vi.mocked(f.effects.addMessage).mock.calls[0][2]).not.toBe(first)
    expect(f.effects.addMessage).toHaveBeenCalledWith('user', 'Second answer', expect.stringMatching(/::user_turn_1$/), false)
  })
  it('does not create a segment for an already aborted history effect', async () => {
    const f = fixture(); const abort = new AbortController(); abort.abort()
    await f.controller.resume('existing', abort.signal, true)
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(f.controller.getSnapshot().isResuming).toBe(false)
  })
  it('keeps assistant feedback UI-only, strips thinking, and suppresses identical final messages', async () => {
    const f = fixture(); await f.controller.resume('existing')
    const room = f.controller.getSnapshot().roomName
    f.controller.handleMessage({ role: 'assistant', id: 'answer', content: '<thinking>private</thinking>Useful feedback', partial: true })
    expect(f.effects.upsertStreamingMessage).toHaveBeenCalledWith('assistant', 'Useful feedback', `${room}::answer`)
    f.controller.handleMessage({ role: 'assistant', id: 'answer', content: 'Useful feedback' })
    expect(f.effects.addMessage).toHaveBeenCalledWith('assistant', 'Useful feedback', `${room}::answer`, false)
    vi.mocked(f.effects.messages).mockReturnValue([{ id: `${room}::answer`, role: 'assistant', content: 'Useful feedback' }])
    f.controller.handleMessage({ role: 'assistant', id: 'answer', content: 'Useful feedback' })
    expect(f.effects.addMessage).toHaveBeenCalledOnce()
  })

  it('delegates launch transport to the adapter without hardcoding the creation endpoint', async () => {
    const f = fixture(); const adapter = elevateAdapter(f.api, f.config)
    adapter.createActivity = async (id, startedAt) => {
      await f.api.request('/custom-activity-launch', { method: 'POST', body: JSON.stringify({ id, startedAt }) })
    }
    await f.controller.start(f.config, adapter)
    expect(f.calls[0].path).toBe('/custom-activity-launch')
    expect(f.calls[1].path).toBe(`/sessions/${f.calls[0].body.id}/segments`)
    expect(f.controller.getSnapshot().sessionId).toBe(f.calls[0].body.id)
    expect(f.controller.getSnapshot().token).not.toBeNull()
  })

})
