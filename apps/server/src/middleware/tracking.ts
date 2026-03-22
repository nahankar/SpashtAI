import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'

export function trackFeatureUsage(feature: string, action: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now()

    const originalSend = res.send.bind(res)
    res.send = function (data: any) {
      const duration = Date.now() - startTime

      if (req.user) {
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
