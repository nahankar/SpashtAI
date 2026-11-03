import { comparePassword } from './password'

/** Fictional local walkthrough identities only. Never a real domain. */
export const WALKTHROUGH_EMAIL = /^[a-z0-9._%+-]+@walkthrough\.test$/
const DUMMY_HASH = '$2b$12$000000000000000000000uGsInbBqMUvMJIpIGnHsOHGSJxUXeJi'

/** Password sign-in for the walkthrough. Production always refuses, even if this route is called directly. */
export function developmentLoginEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_LOGIN === 'true'
}

export function isWalkthroughAccount(email: string) {
  return WALKTHROUGH_EMAIL.test(email)
}

export async function verifyDevelopmentPassword(password: string, passwordHash: string | null) {
  if (!passwordHash) {
    await comparePassword(password, DUMMY_HASH)
    return false
  }
  return comparePassword(password, passwordHash)
}
