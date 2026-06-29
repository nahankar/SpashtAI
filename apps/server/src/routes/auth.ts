import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import { prisma } from '../lib/prisma'
import { hashPassword, comparePassword } from '../lib/password'
import { signToken } from '../lib/jwt'
import { requireAuth } from '../middleware/auth'
import { authLimiter } from '../middleware/rate-limit'
import { sendEmail, buildPasswordResetEmail } from '../lib/email'
import { verifyGoogleIdToken } from '../lib/google-auth'
import { validateProfileFields, resolveProfileLocation, toAuthUser } from '../lib/profile'
import { areSignupsPaused, getSignupsPausedMessage } from '../lib/platformSettings'

const router = Router()

async function rejectIfSignupsPaused(res: Response): Promise<boolean> {
  if (!(await areSignupsPaused())) return false
  res.status(403).json({
    error: 'signups_paused',
    message: await getSignupsPausedMessage(),
  })
  return true
}

// POST /api/auth/register
router.post('/register', authLimiter, async (req: Request, res: Response) => {
  try {
    if (await rejectIfSignupsPaused(res)) return

    const {
      email,
      password,
      firstName,
      lastName,
      phone,
      dateOfBirth,
      gender,
      pincode,
      acceptedTerms,
    } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    if (!phone || !dateOfBirth || !gender || !pincode) {
      res.status(400).json({ error: 'Phone, date of birth, gender, and pincode are required' })
      return
    }

    if (!acceptedTerms) {
      res.status(400).json({ error: 'You must accept the Terms and Conditions and Privacy Policy' })
      return
    }

    const profile = validateProfileFields({ phone, dateOfBirth, gender, pincode })
    if (profile.error || !profile.data) {
      res.status(400).json({ error: profile.error })
      return
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' })
      return
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    const location = await resolveProfileLocation(profile.data.pincode)

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        firstName: firstName?.trim() || null,
        lastName: lastName?.trim() || null,
        phone: profile.data.phone,
        dateOfBirth: profile.data.dateOfBirth,
        gender: profile.data.gender,
        pincode: profile.data.pincode,
        city: location.city,
        state: location.state,
        country: location.country,
      },
    })

    const token = signToken({ userId: user.id, email: user.email, role: user.role })

    await prisma.userActivity.create({
      data: {
        userId: user.id,
        action: 'register',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })

    res.status(201).json({
      token,
      user: toAuthUser(user),
    })
  } catch (err) {
    console.error('Register error:', err)
    res.status(500).json({ error: 'Registration failed' })
  }
})

// POST /api/auth/login
router.post('/login', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      await comparePassword(password, '$2b$12$000000000000000000000uGsInbBqMUvMJIpIGnHsOHGSJxUXeJi')
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    if (!user.passwordHash) {
      res.status(401).json({ error: 'Please sign in with Google for this account' })
      return
    }

    const valid = await comparePassword(password, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' })
      return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        loginCount: { increment: 1 },
      },
    })

    const token = signToken({ userId: user.id, email: user.email, role: user.role })

    await prisma.userActivity.create({
      data: {
        userId: user.id,
        action: 'login',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })

    res.json({
      token,
      user: toAuthUser(user),
    })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /api/auth/google — verify Google ID token; create or sign in user
router.post('/google', authLimiter, async (req: Request, res: Response) => {
  try {
    const { credential } = req.body as { credential?: string }
    if (!credential) {
      res.status(400).json({ error: 'Google credential is required' })
      return
    }

    const googleUser = await verifyGoogleIdToken(credential)

    let user = await prisma.user.findFirst({
      where: {
        OR: [{ googleId: googleUser.googleId }, { email: googleUser.email }],
      },
    })

    if (user && user.googleId && user.googleId !== googleUser.googleId) {
      res.status(409).json({ error: 'Email already linked to another Google account' })
      return
    }

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
        res.status(403).json({
          error: 'signups_paused',
          message: await getSignupsPausedMessage(),
        })
        return
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
        },
      })

      await prisma.userActivity.create({
        data: {
          userId: user.id,
          action: 'register_google',
          ipAddress: req.ip || null,
          userAgent: req.headers['user-agent'] || null,
        },
      })
    }

    const token = signToken({ userId: user.id, email: user.email, role: user.role })

    await prisma.userActivity.create({
      data: {
        userId: user.id,
        action: 'login_google',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })

    res.json({ token, user: toAuthUser(user) })
  } catch (err) {
    console.error('Google auth error:', err)
    const message = err instanceof Error ? err.message : 'Google sign-in failed'
    res.status(401).json({ error: message })
  }
})

// POST /api/auth/complete-profile — required after Google sign-up
router.post('/complete-profile', requireAuth, async (req: Request, res: Response) => {
  try {
    const { phone, dateOfBirth, gender, pincode } = req.body

    const profile = validateProfileFields({ phone, dateOfBirth, gender, pincode })
    if (profile.error || !profile.data) {
      res.status(400).json({ error: profile.error })
      return
    }

    const location = await resolveProfileLocation(profile.data.pincode)

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        phone: profile.data.phone,
        dateOfBirth: profile.data.dateOfBirth,
        gender: profile.data.gender,
        pincode: profile.data.pincode,
        city: location.city,
        state: location.state,
        country: location.country,
      },
    })

    res.json({ user: toAuthUser(user) })
  } catch (err) {
    console.error('Complete profile error:', err)
    res.status(500).json({ error: 'Failed to save profile' })
  }
})

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const { email } = req.body
    if (!email) {
      res.status(400).json({ error: 'Email is required' })
      return
    }

    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      // Don't reveal whether email exists
      res.json({ message: 'If that email is registered, a reset link has been sent' })
      return
    }

    const resetToken = crypto.randomBytes(32).toString('hex')
    const expiry = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await prisma.user.update({
      where: { id: user.id },
      data: { resetPasswordToken: resetToken, resetPasswordExpiry: expiry },
    })

    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
    const resetUrl = `${frontendUrl}/auth/reset-password?token=${resetToken}`
    const { subject, text } = buildPasswordResetEmail(resetUrl)
    const emailResult = await sendEmail({ to: user.email, subject, text })

    if (!emailResult.sent) {
      console.log(`🔑 Password reset token for ${email}: ${resetToken}`)
      console.log(`   Reset URL: ${resetUrl}`)
    }

    const payload: Record<string, string> = {
      message: 'If that email is registered, a reset link has been sent',
    }
    if (
      !emailResult.sent &&
      process.env.NODE_ENV !== 'production' &&
      process.env.EXPOSE_DEV_RESET_URL === 'true'
    ) {
      payload.devResetUrl = resetUrl
    }

    res.json(payload)
  } catch (err) {
    console.error('Forgot password error:', err)
    res.status(500).json({ error: 'Failed to process request' })
  }
})

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body
    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' })
      return
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' })
      return
    }

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpiry: { gt: new Date() },
      },
    })

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' })
      return
    }

    const passwordHash = await hashPassword(password)
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      },
    })

    res.json({ message: 'Password reset successfully' })
  } catch (err) {
    console.error('Reset password error:', err)
    res.status(500).json({ error: 'Failed to reset password' })
  }
})

// GET /api/auth/me (authenticated)
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        emailVerified: true,
        lastLoginAt: true,
        createdAt: true,
        rewardPoints: true,
        googleId: true,
        phone: true,
        dateOfBirth: true,
        gender: true,
        pincode: true,
        hideTranscriptText: true,
        hideTranscriptJsonExport: true,
        hideAudioDownload: true,
        enableTxtExport: true,
        enableJsonExport: true,
        enableAudioExport: true,
        enableReprocess: true,
        enablePro: true,
        enableUltra: true,
      },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    })

    res.json({ user: toAuthUser(user) })
  } catch (err) {
    console.error('Get me error:', err)
    res.status(500).json({ error: 'Failed to fetch user' })
  }
})

// PUT /api/auth/me (authenticated)
router.put('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, avatar } = req.body

    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(avatar !== undefined && { avatar }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
      },
    })

    res.json({ user })
  } catch (err) {
    console.error('Update profile error:', err)
    res.status(500).json({ error: 'Failed to update profile' })
  }
})

// PUT /api/auth/change-password (authenticated)
router.put('/change-password', requireAuth, async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body
    if (!currentPassword || !newPassword) {
      res.status(400).json({ error: 'Current and new passwords are required' })
      return
    }

    if (newPassword.length < 6) {
      res.status(400).json({ error: 'New password must be at least 6 characters' })
      return
    }

    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    if (!user.passwordHash) {
      res.status(400).json({ error: 'Set a password via forgot-password flow for Google-only accounts' })
      return
    }

    const valid = await comparePassword(currentPassword, user.passwordHash)
    if (!valid) {
      res.status(401).json({ error: 'Current password is incorrect' })
      return
    }

    const passwordHash = await hashPassword(newPassword)
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    })

    res.json({ message: 'Password changed successfully' })
  } catch (err) {
    console.error('Change password error:', err)
    res.status(500).json({ error: 'Failed to change password' })
  }
})

// POST /api/auth/logout (authenticated)
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.userActivity.create({
      data: {
        userId: req.user!.userId,
        action: 'logout',
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
      },
    })

    res.json({ message: 'Logged out successfully' })
  } catch (err) {
    console.error('Logout error:', err)
    res.status(500).json({ error: 'Logout failed' })
  }
})

export default router
