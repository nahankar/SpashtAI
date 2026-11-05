import type { Request } from 'express'
import { Prisma, type User } from '@prisma/client'
import { prisma } from './prisma'
import type { GoogleUserInfo } from './google-auth'
import { areSignupsPaused, getSignupsPausedMessage } from './platformSettings'
import { isProfileComplete, type SignupProfile } from './profile'

/** Constructed only after verifying Google, a single-use emailed code, or a pending invitation under its row lock. */
export type VerifiedSignInIdentity = Omit<GoogleUserInfo, 'googleId'> & { googleId: string | null }

export type GoogleSignInResult =
  | { ok: true; user: User; created: boolean }
  | { ok: false; status: number; body: { error: string; message?: string } }

/** Signup controls read once, before any transaction, so nothing inside it borrows a second pool connection. */
export interface SignupPolicy { paused: boolean; message: string }
export async function loadSignupPolicy(): Promise<SignupPolicy> {
  const [paused, message] = await Promise.all([areSignupsPaused(), getSignupsPausedMessage()])
  return { paused, message }
}

export function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/**
 * Resolves a verified identity to a SpashtAI account inside the caller's transaction: an existing account
 * only gains missing Google/profile fields and login bookkeeping (never a role or permission change), and a new
 * account respects the signups-paused control unless an invitation allows it. A concurrent create of the same
 * account surfaces as a unique violation, which rolls the caller's transaction back for a clean retry.
 */
export async function resolveGoogleAccount(
  db: Prisma.TransactionClient,
  googleUser: VerifiedSignInIdentity,
  req: Request,
  opts: {
    /** Loaded by the caller outside the transaction (see loadSignupPolicy); only `db` is used in here. */
    policy: SignupPolicy
    /**
     * Only for accepting a valid invitation whose verified email matched: a new learner (USER) account may
     * be created while signups are paused. Every other signup path must leave this unset.
     */
    invitationBypassesSignupPause?: boolean
    /** Required to create an account. Existing accounts may sign in without it. */
    profile?: SignupProfile | null
  },
): Promise<GoogleSignInResult> {
  let user = await db.user.findFirst({
    where: {
      OR: [...(googleUser.googleId ? [{ googleId: googleUser.googleId }] : []), { email: googleUser.email }],
    },
  })

  if (googleUser.googleId && user && user.googleId && user.googleId !== googleUser.googleId) {
    return { ok: false, status: 409, body: { error: 'Email already linked to another Google account' } }
  }

  let created = false
  if (user) {
    const fillProfile = opts.profile && !isProfileComplete(user) ? {
      phone: opts.profile.phone,
      dateOfBirth: opts.profile.dateOfBirth,
      gender: opts.profile.gender,
      pincode: opts.profile.pincode,
      // Callers resolve location with attachSignupLocation (existing fields kept only when compatible).
      city: opts.profile.city,
      state: opts.profile.state,
      country: opts.profile.country,
    } : {}
    user = await db.user.update({
      where: { id: user.id },
      data: {
        googleId: user.googleId ?? googleUser.googleId,
        emailVerified: user.emailVerified || googleUser.emailVerified,
        firstName: user.firstName ?? googleUser.firstName,
        lastName: user.lastName ?? googleUser.lastName,
        avatar: user.avatar ?? googleUser.avatar,
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
        ...fillProfile,
      },
    })
  } else {
    if (!opts.profile) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'PROFILE_REQUIRED',
          message: 'Add your phone, date of birth, gender and pincode before creating an account.',
        },
      }
    }
    if (!opts.invitationBypassesSignupPause && opts.policy.paused) {
      return { ok: false, status: 403, body: { error: 'signups_paused', message: opts.policy.message } }
    }

    user = await db.user.create({
      data: {
        email: googleUser.email,
        googleId: googleUser.googleId,
        emailVerified: googleUser.emailVerified,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        avatar: googleUser.avatar,
        phone: opts.profile.phone,
        dateOfBirth: opts.profile.dateOfBirth,
        gender: opts.profile.gender,
        pincode: opts.profile.pincode,
        city: opts.profile.city,
        state: opts.profile.state,
        country: opts.profile.country,
        lastLoginAt: new Date(),
        loginCount: 1,
        enablePro: true,
        enableUltra: true,
        enableReprocess: false,
      },
    })
    created = true

    await db.userActivity.create({
      data: {
        userId: user.id,
        action: googleUser.googleId ? 'register_google' : 'register_email_code',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })
  }

  await db.userActivity.create({
    data: {
      userId: user.id,
      action: googleUser.googleId ? 'login_google' : 'login_email_code',
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  return { ok: true, user, created }
}

/** Runs `fn` in a transaction, retrying when a concurrent create of the same account wins a unique constraint. */
export async function withAccountRaceRetry<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(fn)
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= attempts) throw err
    }
  }
}

/** One transaction per attempt: Google and email signups racing for one address resolve to the same account. */
export async function signInWithVerifiedIdentity(
  googleUser: VerifiedSignInIdentity,
  req: Request,
  profile?: SignupProfile | null,
): Promise<GoogleSignInResult> {
  const policy = await loadSignupPolicy()
  return withAccountRaceRetry((tx) => resolveGoogleAccount(tx, googleUser, req, { policy, profile: profile ?? null }))
}

/** Keep the Google entry point explicit: email verification never fabricates or replaces a Google ID. */
export function signInWithGoogleUser(identity: GoogleUserInfo, req: Request, profile?: SignupProfile | null) {
  return signInWithVerifiedIdentity(identity, req, profile)
}
