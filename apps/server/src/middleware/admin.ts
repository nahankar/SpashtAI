import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.user?.role
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  next()
}

/** Individual-learner detail rechecks the current role, so a revoked admin token stops working immediately. */
export async function hasCurrentAdminRole(userId: string | undefined) {
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
}

export async function requireCurrentAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!(await hasCurrentAdminRole(req.user?.userId))) {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    next()
  } catch (error) {
    next(error)
  }
}

/** Shared publication and retirement are restricted to SUPER_ADMIN. */
export async function requireSuperAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId
    const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }) : null
    // JWT roles are a login-time snapshot; demotion/deletion must take effect now.
    if (user?.role !== 'SUPER_ADMIN') {
      res.status(403).json({ error: 'Super admin access required to publish or retire questions' })
      return
    }
    next()
  } catch (error) {
    // Fail closed if the current role cannot be read.
    next(error)
  }
}
