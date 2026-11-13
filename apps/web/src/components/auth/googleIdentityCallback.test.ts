import { afterEach, describe, expect, it, vi } from 'vitest'
import { activateGoogleButton, dispatchGoogleCredential } from './googleIdentityCallback'
const handlers = () => ({ onCredential: vi.fn<(credential: string) => Promise<void>>(async () => {}), onError: vi.fn(), setBusy: vi.fn() })
let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.(); cleanup = undefined })
describe('Google callback across signup and sign-in navigation', () => {
  it('delivers credentials to the current page instead of the first initialized button', async () => {
    const landing = handlers(), signup = handlers()
    const unmountLanding = activateGoogleButton(landing)
    await dispatchGoogleCredential({ credential: 'first-test-credential' })
    unmountLanding(); cleanup = activateGoogleButton(signup)
    await dispatchGoogleCredential({ credential: 'signup-test-credential' })
    expect(landing.onCredential).toHaveBeenCalledExactlyOnceWith('first-test-credential')
    expect(signup.onCredential).toHaveBeenCalledExactlyOnceWith('signup-test-credential')
  })
  it('does not let a previous page cleanup unregister the current button', async () => {
    const previous = handlers(), current = handlers(), unmountPrevious = activateGoogleButton(previous)
    cleanup = activateGoogleButton(current); unmountPrevious()
    await dispatchGoogleCredential({ credential: 'test-credential' })
    expect(previous.onCredential).not.toHaveBeenCalled(); expect(current.onCredential).toHaveBeenCalledOnce()
    cleanup(); await dispatchGoogleCredential({ credential: 'after-unmount' })
    expect(current.onCredential).toHaveBeenCalledOnce()
  })
  it('routes errors to the current page and clears its busy state for a retry', async () => {
    const current = handlers(); current.onCredential.mockRejectedValueOnce(new Error('Temporary error'))
    cleanup = activateGoogleButton(current)
    await dispatchGoogleCredential({ credential: 'first-attempt' })
    expect(current.onError).toHaveBeenCalledWith('Temporary error'); expect(current.setBusy.mock.calls).toEqual([[true], [false]])
    await dispatchGoogleCredential({ credential: 'retry' })
    expect(current.onCredential).toHaveBeenCalledTimes(2); expect(current.setBusy).toHaveBeenLastCalledWith(false)
  })
  it('does not submit an empty Google result', async () => {
    const current = handlers(); cleanup = activateGoogleButton(current)
    await dispatchGoogleCredential({ credential: '' })
    expect(current.onCredential).not.toHaveBeenCalled(); expect(current.onError).toHaveBeenCalledWith('Google sign-in was cancelled')
  })
})
