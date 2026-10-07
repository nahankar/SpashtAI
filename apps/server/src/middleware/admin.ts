import { Request, Response, NextFunction } from 'express'

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.user?.role
  if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Admin access required' })
    return
  }
  next()
}

/** Shared publication and retirement are restricted to SUPER_ADMIN. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Super admin access required to publish or retire questions' })
    return
  }
  next()
}
