import type { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { verifyToken } from '../lib/jwt'

// Identity/account management and workspace control remain available without a product scope.
// Platform administration keeps its own current-role authorization.
const CONTROL = /^\/api\/(?:auth|workspaces|invitations|admin)(?:\/|$)/
const PUBLIC = /^(?:\/health|\/ready|\/personas(?:\/[^/]+)?|\/api\/(?:features|platform|tickers|pricing|legal)(?:\/.*)?)$/

/** Mount after bindWorkspaceRequest. Never trust a login-time flag: old tokens lose Personal access too. */
export async function enforceTenantOnlyAccess(req: Request, res: Response, next: NextFunction) {
  if (CONTROL.test(req.path) || PUBLIC.test(req.path) || req.dataScope) return next()
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7)
    : typeof req.query.access_token === 'string' ? req.query.access_token : ''
  if (!token) return next() // Existing route authentication still applies, including internal agent callbacks.
  let userId: string
  try { userId = verifyToken(token).userId } catch { return next() }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { tenantOnly: true } })
    if (user?.tenantOnly) {
      res.status(403).json({ code: 'TENANT_ONLY_ACCOUNT', error: 'This email has organization access only. Open your workspaces to continue. Use a different email for Personal access.' })
      return
    }
    next()
  } catch (error) { next(error) } // Database failures must never reopen Personal access.
}
