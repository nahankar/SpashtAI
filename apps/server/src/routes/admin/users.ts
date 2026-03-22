import { Router, Request, Response } from 'express'
import { prisma } from '../../lib/prisma'
import { hashPassword } from '../../lib/password'
const router = Router()

// GET /api/admin/users
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20))
    const search = (req.query.search as string) || ''
    const role = req.query.role as string | undefined

    const where: any = {}
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ]
    }
    if (role) {
      where.role = role
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          emailVerified: true,
          lastLoginAt: true,
          lastActiveAt: true,
          loginCount: true,
          createdAt: true,
          _count: { select: { sessions: true, replaySessions: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.user.count({ where }),
    ])

    res.json({
      users,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('List users error:', err)
    res.status(500).json({ error: 'Failed to list users' })
  }
})

// GET /api/admin/users/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatar: true,
        role: true,
        emailVerified: true,
        lastLoginAt: true,
        lastActiveAt: true,
        loginCount: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { sessions: true, replaySessions: true, featureUsage: true } },
      },
    })

    if (!user) {
      res.status(404).json({ error: 'User not found' })
      return
    }

    res.json({ user })
  } catch (err) {
    console.error('Get user error:', err)
    res.status(500).json({ error: 'Failed to get user' })
  }
})

// POST /api/admin/users
router.post('/', async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName, role } = req.body

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' })
      return
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        firstName: firstName || null,
        lastName: lastName || null,
        role: role || 'USER',
        emailVerified: true,
      },
    })

    await prisma.adminAction.create({
      data: {
        adminId: req.user!.userId,
        action: 'user_created',
        targetUserId: user.id,
      },
    })

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
    })
  } catch (err) {
    console.error('Create user error:', err)
    res.status(500).json({ error: 'Failed to create user' })
  }
})

// PUT /api/admin/users/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, role, emailVerified } = req.body

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(role !== undefined && { role }),
        ...(emailVerified !== undefined && { emailVerified }),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        emailVerified: true,
      },
    })

    await prisma.adminAction.create({
      data: {
        adminId: req.user!.userId,
        action: 'user_updated',
        targetUserId: user.id,
        metadata: req.body,
      },
    })

    res.json({ user })
  } catch (err) {
    console.error('Update user error:', err)
    res.status(500).json({ error: 'Failed to update user' })
  }
})

// DELETE /api/admin/users/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (req.params.id === req.user!.userId) {
      res.status(400).json({ error: 'Cannot delete your own account' })
      return
    }

    await prisma.adminAction.create({
      data: {
        adminId: req.user!.userId,
        action: 'user_deleted',
        targetUserId: req.params.id,
        reason: req.body.reason || null,
      },
    })

    await prisma.user.delete({ where: { id: req.params.id } })

    res.json({ message: 'User deleted' })
  } catch (err) {
    console.error('Delete user error:', err)
    res.status(500).json({ error: 'Failed to delete user' })
  }
})

// POST /api/admin/users/:id/change-role
router.post('/:id/change-role', async (req: Request, res: Response) => {
  try {
    const { role } = req.body
    if (!['USER', 'ADMIN', 'SUPER_ADMIN'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' })
      return
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, email: true, role: true },
    })

    await prisma.adminAction.create({
      data: {
        adminId: req.user!.userId,
        action: 'role_changed',
        targetUserId: user.id,
        metadata: { newRole: role },
      },
    })

    res.json({ user })
  } catch (err) {
    console.error('Change role error:', err)
    res.status(500).json({ error: 'Failed to change role' })
  }
})

// GET /api/admin/users/:id/activity
router.get('/:id/activity', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50)

    const activities = await prisma.userActivity.findMany({
      where: { userId: req.params.id },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })

    res.json({ activities })
  } catch (err) {
    console.error('Get activity error:', err)
    res.status(500).json({ error: 'Failed to get activity' })
  }
})

// GET /api/admin/users/:id/sessions
router.get('/:id/sessions', async (req: Request, res: Response) => {
  try {
    const [elevateSessions, replaySessions] = await Promise.all([
      prisma.session.findMany({
        where: { userId: req.params.id },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          module: true,
          startedAt: true,
          endedAt: true,
          durationSec: true,
        },
      }),
      prisma.replaySession.findMany({
        where: { userId: req.params.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          meetingType: true,
          status: true,
          createdAt: true,
        },
      }),
    ])

    res.json({ elevateSessions, replaySessions })
  } catch (err) {
    console.error('Get sessions error:', err)
    res.status(500).json({ error: 'Failed to get sessions' })
  }
})

export default router
