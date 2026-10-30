import type { Request } from 'express'
import type { User } from '@prisma/client'
import { prisma } from './prisma'
import type { GoogleUserInfo } from './google-auth'
import { areSignupsPaused, getSignupsPausedMessage } from './platformSettings'

export type GoogleSignInResult =
  | { ok: true; user: User; created: boolean }
  | { ok: false; status: number; body: { error: string; message?: string } }

/**
 * Resolves a verified Google identity to a SpashtAI account, exactly as `POST /api/auth/google` does:
 * an existing account only gains missing Google/profile fields and login bookkeeping (never a role or
 * permission change), and a new account respects the signups-paused control.
 */
export async function signInWithGoogleUser(googleUser: GoogleUserInfo, req: Request): Promise<GoogleSignInResult> {
  let user = await prisma.user.findFirst({
    where: {
      OR: [{ googleId: googleUser.googleId }, { email: googleUser.email }],
    },
  })

  if (user && user.googleId && user.googleId !== googleUser.googleId) {
    return { ok: false, status: 409, body: { error: 'Email already linked to another Google account' } }
  }

  let created = false
  if (user) {
    user = await prisma.user.update({
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
    if (await areSignupsPaused()) {
      return {
        ok: false,
        status: 403,
        body: { error: 'signups_paused', message: await getSignupsPausedMessage() },
      }
    }

    user = await prisma.user.create({
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

    await prisma.userActivity.create({
      data: {
        userId: user.id,
        action: 'register_google',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })
  }

  await prisma.userActivity.create({
    data: {
      userId: user.id,
      action: 'login_google',
      ipAddress: req.ip || null,
      userAgent: req.headers['user-agent'] || null,
    },
  })

  return { ok: true, user, created }
}
