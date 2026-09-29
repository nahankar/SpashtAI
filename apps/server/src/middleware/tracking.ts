import { Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { isPrivilegedRole } from '../lib/userExportFlags'

function writeFeatureUsage(data: {
  userId: string
  feature: string
  action: string
  duration?: number
  sessionId: string | null
}) {
  try {
    Promise.resolve(prisma.featureUsage.create({ data }))
      .catch((err: unknown) => console.error('Tracking error:', err))
  } catch (err) {
    // Analytics must never turn a successful user action into a failed one.
    console.error('Tracking error:', err)
  }
}

export function trackFeatureUsage(
  feature: string,
  action: string,
  shouldTrack: (req: Request) => boolean = () => true,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now()

    const originalSend = res.send.bind(res)
    res.send = function (data: any) {
      const duration = Date.now() - startTime

      // Only count real end-user activity in analytics — never admin views/actions.
      if (res.statusCode < 400 && req.user && !isPrivilegedRole(req.user.role) && shouldTrack(req)) {
        writeFeatureUsage({
          userId: req.user.userId,
          feature,
          action,
          duration,
          sessionId: req.params.sessionId || req.body?.sessionId || null,
        })
      }

      return originalSend(data)
    }

    next()
  }
}

/**
 * Records a successful action inside a handler when its durable ownership is
 * only known after the handler has loaded or created the resource.
 */
export function recordFeatureUsage(
  req: Request,
  feature: string,
  action: string,
  sessionId: string | null = null,
) {
  if (!req.user || isPrivilegedRole(req.user.role)) return

  writeFeatureUsage({ userId: req.user.userId, feature, action, sessionId })
}
