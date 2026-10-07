import { describe, expect, it } from 'vitest'
import { fixture } from './test-fixtures'
import { elevateAdapter } from './adapters/elevate'
import { prepareAdapter } from './adapters/prepare'

describe('activity adapters', () => {
  it.each(['elevate', 'prepare'] as const)('%s methods work when detached from the adapter object', async kind => {
    const f = fixture()
    const config = { ...f.config, focusArea: 'clarity', preparationId: kind === 'prepare' ? 'journey' : undefined, stageId: kind === 'prepare' ? 'stage' : undefined }
    const adapter = kind === 'prepare' ? prepareAdapter(f.api, config) : elevateAdapter(f.api, config)
    const { createActivity, discard, cleanupFailedJoin, endBody } = adapter
    await createActivity('s1', '2026-10-07T00:00:00.000Z')
    expect(f.calls[0]).toMatchObject({ path: '/sessions', method: 'POST',
      body: { id: 's1', focusArea: 'clarity', preparationId: kind === 'prepare' ? 'journey' : null, stageId: kind === 'prepare' ? 'stage' : null } })
    await discard('s1')
    expect(f.calls[1]).toMatchObject(kind === 'prepare'
      ? { method: 'POST', path: '/api/preparations/journey/practices/s1/discard' }
      : { method: 'DELETE', path: '/sessions/s1' })
    await cleanupFailedJoin('s2', false)
    expect(f.calls[2]).toMatchObject({ method: 'DELETE', path: '/sessions/s2' })
    expect(endBody('t')).toEqual({ endedAt: 't', preparationId: kind === 'prepare' ? 'journey' : null })
  })

  it('keeps Prepare out of Pulse and Snapshot/booth out of tracking with a skip call', () => {
    const f = fixture()
    expect(prepareAdapter(f.api, { ...f.config, preparationId: 'journey' })).toMatchObject({ trackPulse: false, skipPulseCall: false })
    expect(elevateAdapter(f.api, { ...f.config, focusArea: 'snapshot' })).toMatchObject({ trackPulse: false, skipPulseCall: true })
    expect(elevateAdapter(f.api, { ...f.config, boothDemo: true })).toMatchObject({ trackPulse: false, skipPulseCall: true })
    expect(elevateAdapter(f.api, f.config)).toMatchObject({ trackPulse: true, skipPulseCall: false })
  })
})
