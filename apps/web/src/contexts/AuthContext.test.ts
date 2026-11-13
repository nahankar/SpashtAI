import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-client'
import { WorkspaceContextError } from '@/workspaces/activeWorkspace'
import { isGenuineIdentityRejection } from './AuthContext'

describe('identity hydration', () => {
  const store = new Map<string, string>()
  const fetchMock = vi.fn()
  const location = { pathname: '/w/klsvdit/elevate', href: '' }

  beforeEach(() => {
    store.clear()
    store.set('spashtai_token', 'identity')
    location.pathname = '/w/klsvdit/elevate'
    location.href = ''
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
    vi.unstubAllGlobals()
  })

  it('does not treat missing workspace context or a dropped connection as a sign-out', () => {
    expect(isGenuineIdentityRejection(new WorkspaceContextError())).toBe(false)
    expect(isGenuineIdentityRejection(new ApiError('Open the workspace again', 401, 'WORKSPACE_TOKEN_REQUIRED'))).toBe(false)
    expect(isGenuineIdentityRejection(new ApiError('Your workspace membership is no longer active', 403, 'MEMBERSHIP_INACTIVE'))).toBe(false)
    expect(isGenuineIdentityRejection(new TypeError('Failed to fetch'))).toBe(false)
    expect(isGenuineIdentityRejection(new ApiError('Server error', 500))).toBe(false)
  })

  it('signs out only for a genuine identity rejection', () => {
    expect(isGenuineIdentityRejection(new ApiError('Sign in again', 401, 'IDENTITY_REQUIRED'))).toBe(true)
    expect(isGenuineIdentityRejection(new ApiError('Invalid or expired token', 401))).toBe(true)
    expect(isGenuineIdentityRejection(new Error('Authentication required'))).toBe(true)
  })

  it('preserves structured signup errors so Google sign-in can open the required profile form', async () => {
    const { apiClient } = await import('@/lib/api-client')
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'PROFILE_REQUIRED', message: 'Complete your signup details.' }), { status: 400 }))
    await expect(apiClient('/api/auth/google', { method: 'POST', skipAuth: true })).rejects.toMatchObject({ status: 400, code: 'PROFILE_REQUIRED', message: 'Complete your signup details.' })
    expect(store.get('spashtai_token')).toBe('identity')
  })

  it('keeps the saved login after a transient /api/auth/me failure', async () => {
    const { apiClient } = await import('@/lib/api-client')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(apiClient('/api/auth/me', { identityOnly: true })).rejects.toThrow('Failed to fetch')
    expect(store.get('spashtai_token')).toBe('identity')
    expect(isGenuineIdentityRejection(new TypeError('Failed to fetch'))).toBe(false)
  })
})
