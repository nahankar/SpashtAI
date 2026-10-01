import type { Request } from 'express'
import { prisma } from './prisma'
import { isPrivilegedRole } from './userExportFlags'

export function ownerListWhere(userId: string, role?: string): { userId?: string } {
  return isPrivilegedRole(role) ? {} : { userId }
}

/**
 * Tokens carry the role at login time. Cross-user lists use the current
 * database role so promotions/demotions apply without re-login.
 */
export async function currentListRole(req: Request): Promise<string | undefined> {
  const userId = req.user?.userId
  if (!userId) return undefined
  // `?scope=mine` lets personal pickers (e.g. feedback) stay owner-scoped for admins.
  if (req.query?.scope === 'mine') return undefined
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role ?? undefined
}
