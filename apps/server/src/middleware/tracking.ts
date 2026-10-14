import { Request, Response, NextFunction } from 'express'
import { recordProductEvent, type RecordProductEventInput } from '../analytics/recordProductEvent'
import { isPrivilegedRole } from '../lib/userExportFlags'

type EventExtra = Partial<Pick<RecordProductEventInput, 'outcome' | 'metadata' | 'path' | 'engagementMs'>>

function writeFeatureUsage(data: {
  userId: string
  role?: string | null
  feature: string
  action: string
  duration?: number
  sessionId: string | null
  extra?: EventExtra
}) {
  void recordProductEvent({
    userId: data.userId,
    role: data.role,
    feature: data.feature,
    action: data.action,
    duration: data.duration,
    sessionId: data.sessionId,
    source: 'server',
    ...data.extra,
  })
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

      // duration here is request latency. Active time is recorded separately.
      if (res.statusCode < 400 && req.user && !isPrivilegedRole(req.user.role) && shouldTrack(req)) {
        writeFeatureUsage({
          userId: req.user.userId,
          role: req.user.role,
          feature,
          action,
          duration,
          sessionId: req.params.sessionId || req.params.id || req.body?.sessionId || null,
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
  extra?: EventExtra,
) {
  if (!req.user || isPrivilegedRole(req.user.role)) return

  writeFeatureUsage({ userId: req.user.userId, role: req.user.role, feature, action, sessionId, extra })
}
