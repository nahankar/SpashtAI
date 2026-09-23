import type { Request, Response } from 'express'
import { inspectDeliveryMoments } from '../analytics/deliveryMoments'
import {
  exportDenied,
  getElevateSessionOwnerId,
  resolveRequestExportFlags,
} from '../lib/userExportFlags'

/** P3.1a read API: exact, playable pause evidence or an explicit suppression reason. */
export async function getDeliveryMoments(req: Request, res: Response) {
  try {
    const { sessionId } = req.params
    const ownerId = await getElevateSessionOwnerId(sessionId)
    const { accessDenied } = await resolveRequestExportFlags(req, ownerId)
    if (accessDenied) return exportDenied(res, 'Access denied')
    if (!ownerId) return res.status(404).json({ error: 'Session not found' })
    return res.json(await inspectDeliveryMoments(sessionId))
  } catch (error) {
    console.error('Error getting delivery moments:', error)
    return res.status(500).json({ error: 'Failed to get delivery moments' })
  }
}
