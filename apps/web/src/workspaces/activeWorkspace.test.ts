import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeSessionKey, apiClient, getAuthHeaders, getSessionRecordingUrl } from '@/lib/api-client'
import {
  appPath, onWorkspaceFailure, productPathname, scopedStorageKey, setActiveWorkspace, workspaceHeadersFor,
  type ActiveWorkspace,
} from './activeWorkspace'

const alpha: ActiveWorkspace = { slug: 'klsvdit', workspaceId: 'ws-alpha', membershipId: 'm-a', role: 'LEARNER', token: 'alpha-1' }
const beta: ActiveWorkspace = { slug: 'beta', workspaceId: 'ws-beta', membershipId: 'm-b', role: 'LEARNER', token: 'beta-1' }
const store = new Map<string, string>()
const fetchMock = vi.fn()
const location = { pathname: '/w/klsvdit/elevate', href: '' }

beforeEach(() => {
  store.clear(); store.set('spashtai_token', 'identity')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
  vi.stubGlobal('window', { location })
})

afterEach(() => {
  setActiveWorkspace(null)
  vi.unstubAllGlobals()
})

describe('active workspace', () => {
  it('keeps Personal paths, keys and headers unchanged when no workspace is open', () => {
    expect(appPath('/elevate?session=1')).toBe('/elevate?session=1')
    expect(scopedStorageKey('spashtai_active_session')).toBe('spashtai_active_session')
    expect(getAuthHeaders()).not.toHaveProperty('x-spasht-workspace')
  })

  it('scopes links, storage and requests to the open workspace', () => {
    setActiveWorkspace(alpha)
    expect(appPath('/replay/abc')).toBe('/w/klsvdit/replay/abc')
    expect(appPath('/')).toBe('/w/klsvdit')
    expect(activeSessionKey()).toBe('spashtai_active_session:workspace:ws-alpha')
    expect(getAuthHeaders()).toMatchObject({ Authorization: 'Bearer identity', 'x-spasht-workspace': 'alpha-1' })
    expect(productPathname('/w/klsvdit/interviews/history')).toBe('/interviews/history')
    expect(productPathname('/interviews')).toBe('/interviews')
  })

  it('uploads started in one workspace never move to another after a switch', () => {
    setActiveWorkspace(alpha)
    const origin = alpha
    setActiveWorkspace({ ...alpha, token: 'alpha-2' })
    expect(workspaceHeadersFor(origin)).toEqual({ 'x-spasht-workspace': 'alpha-2' })
    setActiveWorkspace(beta)
    expect(workspaceHeadersFor(origin)).toEqual({ 'x-spasht-workspace': 'alpha-1' })
    expect(workspaceHeadersFor(null)).toEqual({})
  })

  it('asks for the workspace to be reopened instead of signing out on a workspace failure', async () => {
    setActiveWorkspace(alpha)
    const failures: string[] = []
    const stop = onWorkspaceFailure(code => failures.push(code))
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Open the workspace again', code: 'WORKSPACE_TOKEN_REQUIRED' }), { status: 401 }))
    await expect(apiClient('/api/replay/sessions')).rejects.toMatchObject({ code: 'WORKSPACE_TOKEN_REQUIRED' })
    expect(failures).toEqual(['WORKSPACE_TOKEN_REQUIRED'])
    expect(store.get('spashtai_token')).toBe('identity')
    expect(location.href).toBe('')
    stop()
  })

  it('still signs out when the identity itself is rejected', async () => {
    setActiveWorkspace(alpha)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Sign in again', code: 'IDENTITY_REQUIRED' }), { status: 401 }))
    await expect(apiClient('/api/replay/sessions')).rejects.toThrow('Authentication required')
    expect(store.has('spashtai_token')).toBe(false)
  })

  it('streams organization recordings through a session-bound ticket, not the workspace token', async () => {
    expect(await getSessionRecordingUrl('s1')).toContain('/sessions/s1/recording/stream?access_token=identity')
    expect(fetchMock).not.toHaveBeenCalled()
    setActiveWorkspace(alpha)
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ticket: 'media-ticket' }), { status: 200 }))
    const url = new URL((await getSessionRecordingUrl('s1'))!)
    expect(url.pathname).toBe('/sessions/s1/recording/stream')
    expect(url.searchParams.get('workspace_media')).toBe('media-ticket')
    expect(url.search).not.toContain('alpha-1')
    const [ticketUrl, init] = fetchMock.mock.calls[0]
    expect(ticketUrl).toContain('/sessions/s1/recording/ticket')
    expect(init).toMatchObject({ method: 'POST', headers: { 'x-spasht-workspace': 'alpha-1' } })
  })
})
