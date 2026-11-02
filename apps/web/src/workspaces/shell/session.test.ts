import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { getActiveWorkspace, reportWorkspaceFailure, setActiveWorkspace } from '../activeWorkspace'
import type { Entry, Snapshot } from '../client'
import { createWorkspaceSession, REFRESH_MS, RETRY_MS, type WorkspaceSessionState } from './session'

const workspace = { id: 'ws-1', slug: 'klsvdit', name: 'KLS VDIT', kind: 'ORGANIZATION' as const, state: 'ACTIVE' as const, logoDataUrl: null, accentColor: '#123456', timeZone: 'Asia/Kolkata', isolationStage: 'PRODUCT_PLANE', limits: { maxMembers: 10, dailyEvaluations: 5, concurrentVoice: 2 } }
const entry = (token: string | null, state: 'ACTIVE' | 'INVITED' = 'ACTIVE'): Entry => ({ workspace, membership: { id: 'm-1', role: 'LEARNER', state }, accessToken: token, notice: 'Private' })
const snapshot: Snapshot = { workspace, membership: { id: 'm-1', role: 'LEARNER', state: 'ACTIVE' }, notice: 'Private', counts: null, features: [] }

function harness(responses: Array<() => Promise<unknown>>) {
  const states: WorkspaceSessionState[] = []
  const request = vi.fn(() => (responses.shift() ?? (() => Promise.reject(new Error('unexpected'))))())
  const session = createWorkspaceSession('klsvdit', { request: request as <T>() => Promise<T>, identity: () => 'identity', onState: s => states.push(s) })
  return { session, states, request }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); setActiveWorkspace(null) })

describe('workspace session', () => {
  it('opens the workspace with its token and clears it when the tab leaves', async () => {
    const { session, states } = harness([async () => entry('t1'), async () => snapshot])
    session.start(); await flush()
    expect(states.at(-1)?.status).toBe('ready')
    expect(getActiveWorkspace()).toMatchObject({ workspaceId: 'ws-1', token: 't1', slug: 'klsvdit' })
    session.stop()
    expect(getActiveWorkspace()).toBeNull()
  })

  it('renews the token before it expires and when a request reports it ended', async () => {
    const { session, request } = harness([async () => entry('t1'), async () => snapshot, async () => entry('t2'), async () => snapshot, async () => entry('t3'), async () => snapshot])
    session.start(); await flush()
    await vi.advanceTimersByTimeAsync(REFRESH_MS)
    expect(getActiveWorkspace()?.token).toBe('t2')
    reportWorkspaceFailure('WORKSPACE_TOKEN_REQUIRED'); await flush()
    expect(getActiveWorkspace()?.token).toBe('t3')
    expect(request).toHaveBeenCalledTimes(6)
    session.stop()
  })

  it('a response that arrives after leaving never reopens the workspace', async () => {
    let release!: (value: unknown) => void
    const { session } = harness([() => new Promise(resolve => { release = resolve }), async () => snapshot])
    session.start()
    session.stop()
    release(entry('late')); await flush()
    expect(getActiveWorkspace()).toBeNull()
  })

  it('closes the workspace when the server ends access, instead of continuing as Personal', async () => {
    const { session, states } = harness([async () => entry('t1'), async () => snapshot, async () => { throw new ApiError('Your workspace membership is no longer active', 403, 'MEMBERSHIP_INACTIVE') }])
    session.start(); await flush()
    await vi.advanceTimersByTimeAsync(REFRESH_MS)
    expect(getActiveWorkspace()).toBeNull()
    expect(states.at(-1)).toMatchObject({ status: 'ended', signIn: false })
    session.stop()
  })

  it('keeps an open workspace through a dropped connection and retries', async () => {
    const { session, states } = harness([async () => entry('t1'), async () => snapshot, async () => { throw new TypeError('Failed to fetch') }, async () => entry('t2'), async () => snapshot])
    session.start(); await flush()
    await vi.advanceTimersByTimeAsync(REFRESH_MS)
    expect(getActiveWorkspace()?.token).toBe('t1')
    expect(states.at(-1)?.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(RETRY_MS)
    expect(getActiveWorkspace()?.token).toBe('t2')
    session.stop()
  })

  it('asks a signed-in invitee to accept before any workspace context exists', async () => {
    const { session, states } = harness([async () => entry(null, 'INVITED'), async () => ({ accepted: true }), async () => entry('t1'), async () => snapshot])
    session.start(); await flush()
    expect(states.at(-1)?.status).toBe('invited')
    expect(getActiveWorkspace()).toBeNull()
    await session.accept()
    expect(getActiveWorkspace()?.token).toBe('t1')
    session.stop()
  })

  it('asks to sign in again when the identity is rejected', async () => {
    const { session, states } = harness([async () => { throw new ApiError('Sign in again', 401, 'IDENTITY_REQUIRED') }])
    session.start(); await flush()
    expect(states.at(-1)).toMatchObject({ status: 'ended', signIn: true })
    session.stop()
  })
})
