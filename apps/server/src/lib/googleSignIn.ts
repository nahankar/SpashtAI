import type { Request } from 'express'
import { Prisma, type User } from '@prisma/client'
import { prisma } from './prisma'
import type { GoogleUserInfo } from './google-auth'
import { areSignupsPaused, getSignupsPausedMessage } from './platformSettings'

export type GoogleSignInResult =
  | { ok: true; user: User; created: boolean }
  | { ok: false; status: number; body: { error: string; message?: string } }

export function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

/**
 * Resolves a verified Google identity to a SpashtAI account inside the caller's transaction: an existing account
 * only gains missing Google/profile fields and login bookkeeping (never a role or permission change), and a new
 * account respects the signups-paused control unless an invitation allows it. A concurrent create of the same
 * account surfaces as a unique violation, which rolls the caller's transaction back for a clean retry.
 */
export async function resolveGoogleAccount(
  db: Prisma.TransactionClient,
  googleUser: GoogleUserInfo,
  req: Request,
  /**
   * Only for accepting a valid invitation whose verified Google email matched: a new learner (USER) account may
   * be created while signups are paused. Every other signup path must leave this unset.
   */
  opts: { invitationBypassesSignupPause?: boolean } = {},
): Promise<GoogleSignInResult> {
  let user = await db.user.findFirst({
    where: {
      OR: [{ googleId: googleUser.googleId }, { email: googleUser.email }],
    },
  })

  if (user && user.googleId && user.googleId !== googleUser.googleId) {
    return { ok: false, status: 409, body: { error: 'Email already linked to another Google account' } }
  }

  let created = false
  if (user) {
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
      },
    })
  } else {
    if (!opts.invitationBypassesSignupPause && (await areSignupsPaused())) {
      return {
        ok: false,
        status: 403,
        body: { error: 'signups_paused', message: await getSignupsPausedMessage() },
      }
    }

    user = await db.user.create({
      data: {
        email: googleUser.email,
        googleId: googleUser.googleId,
        emailVerified: googleUser.emailVerified,
        firstName: googleUser.firstName,
        lastName: googleUser.lastName,
        avatar: googleUser.avatar,
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
        action: 'register_google',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })
  }

  await db.userActivity.create({
    data: {
      userId: user.id,
      action: 'login_google',
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

/** `POST /api/auth/google`: one transaction per attempt, so a racing signup of the same address never duplicates. */
export function signInWithGoogleUser(googleUser: GoogleUserInfo, req: Request): Promise<GoogleSignInResult> {
  return withAccountRaceRetry((tx) => resolveGoogleAccount(tx, googleUser, req))
}
