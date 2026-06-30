import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { isPrivilegedRole } from '../lib/userExportFlags'

export function trackFeatureUsage(feature: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now()

    const originalSend = res.send.bind(res)
    res.send = function (data: any) {
      const duration = Date.now() - startTime

      // Only count real end-user activity in analytics — never admin views/actions.
      if (req.user && !isPrivilegedRole(req.user.role)) {
        prisma.featureUsage.create({
          data: {
            userId: req.user.userId,
            feature,
            action,
            duration,
            sessionId: req.params.sessionId || req.body?.sessionId || null,
          },
        }).catch((err: unknown) => console.error('Tracking error:', err))
      }

      return originalSend(data)
    }

    next()
  }
}
