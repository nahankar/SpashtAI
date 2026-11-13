import { ApiError } from './api-client'

// Provider credentials stay in this tab's memory, never browser storage or URLs.
const MAX_AGE_MS = 10 * 60 * 1000
let pending: { credential: string; expiresAt: number } | null = null

export function clearPendingGoogleSignup() { pending = null }
export function pendingGoogleSignupCredential(): string | null {
  if (pending && pending.expiresAt <= Date.now()) pending = null
  return pending?.credential ?? null
}

export async function withGoogleSignupContinuation<T>(
  credential: string, workspaceSlug: string | undefined, request: () => Promise<T>,
): Promise<T> {
  // A fresh choice of account replaces any earlier unfinished signup.
  if (pending?.credential !== credential) clearPendingGoogleSignup()
  try {
    const result = await request()
    clearPendingGoogleSignup()
    return result
  } catch (error) {
    if (!workspaceSlug && error instanceof ApiError && error.code === 'PROFILE_REQUIRED') {
      pending = { credential, expiresAt: Date.now() + MAX_AGE_MS }
    } else if (error instanceof ApiError && [401, 403, 409].includes(error.status)) {
      clearPendingGoogleSignup()
    }
    throw error
  }
}
