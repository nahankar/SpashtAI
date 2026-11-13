import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './api-client'
import { clearPendingGoogleSignup, pendingGoogleSignupCredential, withGoogleSignupContinuation } from './pending-google-signup'
const required = () => Promise.reject(new ApiError('Complete your details', 400, 'PROFILE_REQUIRED'))
afterEach(() => { clearPendingGoogleSignup(); vi.useRealTimers() })
describe('Google signup continuation', () => {
  it('retains only a server-verified public signup and clears it after completion', async () => {
    await expect(withGoogleSignupContinuation('verified', undefined, required)).rejects.toThrow()
    expect(pendingGoogleSignupCredential()).toBe('verified')
    await withGoogleSignupContinuation('verified', undefined, () => Promise.resolve('account'))
    expect(pendingGoogleSignupCredential()).toBeNull()
  })
  it('does not retain workspace credentials or failed Google verification', async () => {
    await expect(withGoogleSignupContinuation('tenant', 'klsvdit', required)).rejects.toThrow()
    expect(pendingGoogleSignupCredential()).toBeNull()
    await expect(withGoogleSignupContinuation('invalid', undefined, () => Promise.reject(new ApiError('Invalid credential', 401)))).rejects.toThrow()
    expect(pendingGoogleSignupCredential()).toBeNull()
  })
  it('expires verification after ten minutes', async () => {
    vi.useFakeTimers()
    await expect(withGoogleSignupContinuation('verified', undefined, required)).rejects.toThrow()
    vi.advanceTimersByTime(600001)
    expect(pendingGoogleSignupCredential()).toBeNull()
  })
  it('retains verification for profile corrections and transient retries, but clears policy rejection', async () => {
    await expect(withGoogleSignupContinuation('verified', undefined, required)).rejects.toThrow()
    for (const status of [400, 503]) {
      await expect(withGoogleSignupContinuation('verified', undefined, () => Promise.reject(new ApiError('Try again', status)))).rejects.toThrow()
      expect(pendingGoogleSignupCredential()).toBe('verified')
    }
    await expect(withGoogleSignupContinuation('verified', undefined, () => Promise.reject(new ApiError('Disabled', 403)))).rejects.toThrow()
    expect(pendingGoogleSignupCredential()).toBeNull()
  })
  it('replaces a previous identity when a different account is chosen', async () => {
    await expect(withGoogleSignupContinuation('first', undefined, required)).rejects.toThrow()
    await expect(withGoogleSignupContinuation('second', undefined, () => Promise.reject(new TypeError('Network')))).rejects.toThrow()
    expect(pendingGoogleSignupCredential()).toBeNull()
  })
})
